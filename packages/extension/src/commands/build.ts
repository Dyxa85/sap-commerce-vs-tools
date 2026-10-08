import * as vscode from 'vscode';
import {
  ANT_TARGETS,
  conflictingBuildFiles,
  debugPort,
  isValidArgument,
  javaProjectSettings,
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
    const config = vscode.workspace.getConfiguration('sapcommerce.java');
    const settings = javaProjectSettings(p, {
      base: folder.uri.fsPath,
      includeTests: config.get<boolean>('includeTests', true),
      exclude: config.get<string[]>('excludeExtensions', []),
      maxExtensions: config.get<number>('maxExtensions') || undefined,
    });
    const conflicts = conflictingBuildFiles(folder.uri.fsPath);
    const java = vscode.workspace.getConfiguration(undefined, folder.uri);
    const current = JSON.stringify(
      JAVA_KEYS.map((k) => java.inspect(k)?.workspaceFolderValue ?? null),
    );
    const lastWritten = context.workspaceState.get<string>(LAST_WRITTEN);
    const hasForeign =
      current !== JSON.stringify(JAVA_KEYS.map(() => null)) && current !== lastWritten;

    const lines = [
      `${settings['java.project.sourcePaths'].length} source folders and ${settings['java.project.referencedLibraries'].include.length} library folders of ${p.loaded.length} extensions will be written to the settings of "${folder.name}".`,
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
      for (const key of JAVA_KEYS)
        await java.update(key, settings[key], vscode.ConfigurationTarget.WorkspaceFolder);
    } catch (err) {
      log.error('Writing the Java settings failed', err);
      void vscode.window.showErrorMessage(
        'Could not write the Java settings. See the output channel.',
      );
      return;
    }
    await context.workspaceState.update(
      LAST_WRITTEN,
      JSON.stringify(
        JAVA_KEYS.map(
          (k) =>
            vscode.workspace.getConfiguration(undefined, folder.uri).inspect(k)
              ?.workspaceFolderValue ?? null,
        ),
      ),
    );
    const reload = await vscode.window.showInformationMessage(
      'Java settings written. Reload the Java project to apply them.',
      'Reload project',
    );
    if (reload)
      await vscode.commands
        .executeCommand('java.projectConfiguration.update', folder.uri)
        .then(undefined, () => vscode.commands.executeCommand('java.clean.workspace'));
  });

  register('sapcommerce.java.clear', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    const java = vscode.workspace.getConfiguration(undefined, folder.uri);
    try {
      for (const key of JAVA_KEYS)
        await java.update(key, undefined, vscode.ConfigurationTarget.WorkspaceFolder);
      await context.workspaceState.update(LAST_WRITTEN, undefined);
    } catch (err) {
      log.error('Removing the Java settings failed', err);
    }
  });
}
