import { join } from 'node:path';
import * as vscode from 'vscode';
import {
  ANT_TARGETS,
  conflictingBuildFiles,
  debugPort,
  isValidArgument,
  javaProjectSettings,
  packClassFolders,
  type PlatformProject,
} from '@sapcommerce-vstools/core';
import { ANT_TASK, SERVER_TASK, type CommerceTaskProvider } from '../build/tasks.js';
import type { ProjectService } from '../project/service.js';
import type { Logger } from '../util/log.js';

const JAVA_KEYS = [
  'java.project.sourcePaths',
  'java.project.referencedLibraries',
  'java.project.outputPath',
] as const;
const LAST_WRITTEN = 'sapcommerce.java.lastWritten';

async function chooseProject(project: ProjectService): Promise<PlatformProject | undefined> {
  if (project.projects.length === 0) {
    void vscode.window.showWarningMessage('No SAP Commerce project was found in this workspace.');
    return undefined;
  }
  if (project.projects.length === 1) return project.projects[0];
  const picked = await vscode.window.showQuickPick(
    project.projects.map((p) => ({ label: vscode.workspace.asRelativePath(p.hybrisDir), p })),
    { title: 'Which SAP Commerce project?' },
  );
  return picked?.p;
}

function requireTrust(): boolean {
  if (vscode.workspace.isTrusted) return true;
  void vscode.window.showWarningMessage(
    'Build and server commands are disabled until you trust this workspace.',
  );
  return false;
}

export function registerBuildCommands(
  context: vscode.ExtensionContext,
  project: ProjectService,
  tasks: CommerceTaskProvider,
  log: Logger,
): void {
  const register = (id: string, fn: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  };
  const running = new Map<string, vscode.TaskExecution>();

  async function execute(task: vscode.Task, key: string): Promise<void> {
    running.get(key)?.terminate();
    const execution = await vscode.tasks.executeTask(task);
    running.set(key, execution);
  }
  context.subscriptions.push(
    vscode.tasks.onDidEndTask((e) => {
      for (const [key, value] of running) if (value === e.execution) running.delete(key);
    }),
  );

  register('sapcommerce.ant.run', async (target?: string) => {
    if (!requireTrust()) return;
    const p = await chooseProject(project);
    if (!p) return;
    let name = typeof target === 'string' ? target : undefined;
    let args: string[] = [];
    if (!name) {
      const choice = await vscode.window.showQuickPick(
        [
          ...ANT_TARGETS.map((t) => ({ label: t.name, description: t.description, custom: false })),
          { label: 'Other target…', description: 'type the name and arguments', custom: true },
        ],
        { title: 'Run Ant target', matchOnDescription: true },
      );
      if (!choice) return;
      name = choice.label;
      if (choice.custom) {
        const typed = await vscode.window.showInputBox({
          title: 'Ant target and arguments',
          prompt: 'e.g. unittests -Dtestclasses.extensions=acmecore',
          validateInput: (value) => {
            const words = value.trim().split(/\s+/);
            if (words[0] === '' || !/^[A-Za-z][\w.-]*$/.test(words[0] ?? ''))
              return 'Start with a target name.';
            const bad = words.slice(1).find((w) => !isValidArgument(w));
            return bad ? `Argument not allowed: ${bad}` : undefined;
          },
        });
        if (!typed) return;
        const [first, ...rest] = typed.trim().split(/\s+/);
        name = first;
        args = rest;
      }
    }
    if (name === 'initialize') {
      const answer = await vscode.window.showWarningMessage(
        'ant initialize drops all data of the configured database.',
        { modal: true },
        'Initialize',
      );
      if (answer !== 'Initialize') return;
    }
    const task = tasks.antTask(
      p,
      vscode.workspace.getWorkspaceFolder(vscode.Uri.file(p.hybrisDir)) ??
        vscode.TaskScope.Workspace,
      { type: ANT_TASK, target: name as string, args },
      `ant ${name}`,
    );
    await execute(task, 'ant');
  });

  register('sapcommerce.ant.build', () =>
    vscode.commands.executeCommand('sapcommerce.ant.run', 'build'),
  );
  register('sapcommerce.ant.clean', () =>
    vscode.commands.executeCommand('sapcommerce.ant.run', 'clean'),
  );

  async function startServer(mode: 'run' | 'debug'): Promise<void> {
    if (!requireTrust()) return;
    const p = await chooseProject(project);
    if (!p) return;
    const task = tasks.serverTask(
      p,
      vscode.workspace.getWorkspaceFolder(vscode.Uri.file(p.hybrisDir)) ??
        vscode.TaskScope.Workspace,
      { type: SERVER_TASK, mode },
      `server ${mode}`,
    );
    task.isBackground = true;
    await execute(task, 'server');
  }
  register('sapcommerce.server.start', () => startServer('run'));
  register('sapcommerce.server.startDebug', () => startServer('debug'));
  register('sapcommerce.server.stop', () => {
    const execution = running.get('server');
    if (!execution) {
      void vscode.window.showInformationMessage('No server was started from this window.');
      return;
    }
    execution.terminate();
  });

  register('sapcommerce.server.attachDebugger', async () => {
    const p = await chooseProject(project);
    if (!p) return;
    const port = await debugPort(p.platformDir, p.configDir);
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(p.hybrisDir));
    const ok = await vscode.debug.startDebugging(folder, {
      type: 'java',
      request: 'attach',
      name: 'SAP Commerce (attach)',
      hostName: 'localhost',
      port,
    });
    if (!ok) {
      void vscode.window.showWarningMessage(
        `Could not attach to localhost:${port}. Start the server in debug mode and make sure the "Debugger for Java" extension is installed.`,
      );
    }
  });

  // ---- Java project setup (ADR 0001, option C)
  const CLASS_JARS = '.sapcommerce/libs';
  const javaMode = (): string =>
    vscode.workspace.getConfiguration('sapcommerce.java').get<string>('mode', 'compiled');
  const workspaceJava = (): string =>
    JSON.stringify(
      JAVA_KEYS.map((k) => vscode.workspace.getConfiguration().inspect(k)?.workspaceValue ?? null),
    );

  /** The settings for this project, in the mode the user chose; packs the Ant build's classes for `compiled`. */
  async function javaSettingsFor(
    p: PlatformProject,
    folder: vscode.WorkspaceFolder,
  ): Promise<ReturnType<typeof javaProjectSettings>> {
    const config = vscode.workspace.getConfiguration('sapcommerce.java');
    const exclude = config.get<string[]>('excludeExtensions', []);
    const options = {
      base: folder.uri.fsPath,
      includeTests: config.get<boolean>('includeTests', true),
      exclude,
      maxExtensions: config.get<number>('maxExtensions') || undefined,
    };
    if (javaMode() === 'sources') return javaProjectSettings(p, options);
    const classJarsDir = join(folder.uri.fsPath, CLASS_JARS);
    const result = await packClassFolders(p, classJarsDir, { exclude });
    for (const f of result.failed)
      log.warn(`Could not pack the classes of ${f.extension}: ${f.reason}`);
    log.info(
      `Java: ${result.packed} jars made from the classes folders of the Ant build, ${result.upToDate} up to date, ${result.empty} extensions without classes.`,
    );
    return javaProjectSettings(p, { ...options, mode: 'compiled', classJarsDir });
  }

  async function writeJavaSettings(
    settings: ReturnType<typeof javaProjectSettings>,
  ): Promise<void> {
    const java = vscode.workspace.getConfiguration();
    for (const key of JAVA_KEYS)
      await java.update(key, settings[key], vscode.ConfigurationTarget.Workspace);
    await context.workspaceState.update(LAST_WRITTEN, workspaceJava());
  }

  register('sapcommerce.java.configure', async () => {
    const p = await chooseProject(project);
    if (!p) return;
    const folder =
      vscode.workspace.getWorkspaceFolder(vscode.Uri.file(p.hybrisDir)) ??
      vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    if (!vscode.extensions.getExtension('redhat.java')) {
      const open = await vscode.window.showWarningMessage(
        'Java navigation needs the "Language Support for Java™ by Red Hat" extension.',
        'Show extension',
      );
      if (open) await vscode.commands.executeCommand('workbench.extensions.search', 'redhat.java');
      return;
    }
    const conflicts = conflictingBuildFiles(folder.uri.fsPath);
    // The Java extension declares these settings for the whole window, so they cannot be written per folder.
    const current = workspaceJava();
    const lastWritten = context.workspaceState.get<string>(LAST_WRITTEN);
    const hasForeign =
      current !== JSON.stringify(JAVA_KEYS.map(() => null)) && current !== lastWritten;

    const lines = [
      javaMode() === 'sources'
        ? `The sources of all ${p.loaded.length} loaded extensions are compiled by the Java extension. This gives navigation into platform sources but needs several GB of memory.`
        : `Your own extensions are compiled by the Java extension, so you get live errors and completion. Platform and modules are taken from the result of your Ant build (bin/*.jar and the classes folders, packed to ${CLASS_JARS}), so what you see matches what Ant compiled. Run "ant build" first; extensions that are not built yet fall back to their sources.`,
      `The settings are written to the workspace settings (.vscode/settings.json of "${folder.name}").`,
    ];
    if (conflicts.length > 0)
      lines.push(
        `Found ${conflicts.join(', ')} in the workspace folder. The Java extension then ignores these settings; open the "hybris" folder itself or remove those files.`,
      );
    if (hasForeign)
      lines.push(
        'Existing java.project.* settings that were not written by this command will be replaced.',
      );
    const answer = await vscode.window.showInformationMessage(
      'Configure Java for this SAP Commerce project?',
      { modal: true, detail: lines.join('\n\n') },
      'Write settings',
    );
    if (answer !== 'Write settings') return;
    try {
      const settings = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Preparing the Java setup' },
        () => javaSettingsFor(p, folder),
      );
      await writeJavaSettings(settings);
    } catch (err) {
      log.error('Writing the Java settings failed', err);
      void vscode.window.showErrorMessage(
        'Could not write the Java settings. See the output channel.',
      );
      return;
    }
    // The Java extension picks the settings up by itself and builds the project in the background.
    vscode.window.setStatusBarMessage(
      '$(sync~spin) Java: building the SAP Commerce project – unresolved imports disappear in a few minutes',
      240_000,
    );
    void vscode.window.showInformationMessage(
      'Java settings written. The Java extension now imports the project; the first build takes a few minutes. Errors about unresolved imports disappear when it is done.',
    );
  });

  // After an Ant target finished the compiled classes changed: pack them again and, if the set of libraries changed
  // (a module was built or cleaned), update the settings this command wrote earlier. Settings of the user stay alone.
  context.subscriptions.push(
    vscode.tasks.onDidEndTaskProcess(async (e) => {
      if (e.exitCode !== 0 || e.execution.task.definition.type !== ANT_TASK) return;
      if (javaMode() === 'sources') return;
      const lastWritten = context.workspaceState.get<string>(LAST_WRITTEN);
      if (lastWritten === undefined || lastWritten !== workspaceJava()) return;
      try {
        for (const p of project.projects) {
          const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(p.hybrisDir));
          if (!folder) continue;
          const settings = await javaSettingsFor(p, folder);
          const config = vscode.workspace.getConfiguration();
          const same = JAVA_KEYS.every(
            (k) =>
              JSON.stringify(config.inspect(k)?.workspaceValue) === JSON.stringify(settings[k]),
          );
          if (!same) await writeJavaSettings(settings);
        }
      } catch (err) {
        log.error('Updating the Java setup after the build failed', err);
      }
    }),
  );

  register('sapcommerce.java.clear', async () => {
    if (!vscode.workspace.workspaceFolders?.[0]) return;
    const java = vscode.workspace.getConfiguration();
    try {
      for (const key of JAVA_KEYS)
        await java.update(key, undefined, vscode.ConfigurationTarget.Workspace);
      await context.workspaceState.update(LAST_WRITTEN, undefined);
    } catch (err) {
      log.error('Removing the Java settings failed', err);
    }
  });
}
