import * as vscode from 'vscode';
import {
  ANT_TARGETS,
  antInvocation,
  isValidArgument,
  isValidTarget,
  serverInvocation,
  type Invocation,
  type PlatformProject,
  type ServerMode,
} from '@sapcommerce-vstools/core';
import type { ProjectService } from '../project/service.js';

export const ANT_TASK = 'sapcommerce.ant';
export const SERVER_TASK = 'sapcommerce.server';
export const PROBLEM_MATCHER = '$sapcommerce-javac';

interface AntDefinition extends vscode.TaskDefinition {
  target: string;
  args?: string[];
  /** `hybris` directory of the project when the workspace contains several. */
  project?: string;
}

interface ServerDefinition extends vscode.TaskDefinition {
  mode?: ServerMode;
  project?: string;
}

function toExecution(invocation: Invocation): vscode.ProcessExecution {
  return new vscode.ProcessExecution(invocation.executable, invocation.args, {
    cwd: invocation.cwd,
  });
}

/** Ant targets and the server as VS Code tasks, so they can be bound to keys, chained and run from `tasks.json`. */
export class CommerceTaskProvider implements vscode.TaskProvider, vscode.Disposable {
  private readonly registrations: vscode.Disposable[];

  constructor(private readonly project: ProjectService) {
    this.registrations = [
      vscode.tasks.registerTaskProvider(ANT_TASK, this),
      vscode.tasks.registerTaskProvider(SERVER_TASK, this),
    ];
  }

  provideTasks(): vscode.Task[] {
    const tasks: vscode.Task[] = [];
    const several = this.project.projects.length > 1;
    for (const p of this.project.projects) {
      const scope = this.scopeOf(p);
      const suffix = several ? ` (${vscode.workspace.asRelativePath(p.hybrisDir)})` : '';
      for (const target of ANT_TARGETS) {
        const definition: AntDefinition = {
          type: ANT_TASK,
          target: target.name,
          ...(several ? { project: p.hybrisDir } : {}),
        };
        const task = this.antTask(p, scope, definition, `ant ${target.name}${suffix}`);
        if (target.group === 'build') {
          task.group = target.name === 'build' ? vscode.TaskGroup.Build : undefined;
        } else if (target.group === 'test') {
          task.group = vscode.TaskGroup.Test;
        }
        task.detail = target.description;
        tasks.push(task);
      }
      for (const mode of ['run', 'debug'] as const) {
        const definition: ServerDefinition = {
          type: SERVER_TASK,
          mode,
          ...(several ? { project: p.hybrisDir } : {}),
        };
        const task = this.serverTask(p, scope, definition, `server ${mode}${suffix}`);
        task.isBackground = true;
        tasks.push(task);
      }
    }
    return tasks;
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    const definition = task.definition as AntDefinition & ServerDefinition;
    const project = this.projectFor(definition.project);
    if (!project) return undefined;
    const scope = this.scopeOf(project);
    try {
      if (definition.type === ANT_TASK)
        return this.antTask(project, scope, definition, `ant ${definition.target}`);
      if (definition.type === SERVER_TASK)
        return this.serverTask(project, scope, definition, `server ${definition.mode ?? 'run'}`);
    } catch {
      return undefined;
    }
    return undefined;
  }

  private projectFor(dir: string | undefined): PlatformProject | undefined {
    return dir ? this.project.projects.find((p) => p.hybrisDir === dir) : this.project.projects[0];
  }

  private scopeOf(project: PlatformProject): vscode.WorkspaceFolder | vscode.TaskScope {
    return (
      vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project.hybrisDir)) ??
      vscode.TaskScope.Workspace
    );
  }

  antTask(
    project: PlatformProject,
    scope: vscode.WorkspaceFolder | vscode.TaskScope,
    definition: AntDefinition,
    name: string,
  ): vscode.Task {
    if (!isValidTarget(definition.target)) throw new Error('invalid target');
    const args = definition.args ?? [];
    if (!args.every((a) => typeof a === 'string' && isValidArgument(a)))
      throw new Error('invalid args');
    const invocation = antInvocation(project.platformDir, definition.target, args);
    return new vscode.Task(definition, scope, name, 'SAP Commerce', toExecution(invocation), [
      PROBLEM_MATCHER,
    ]);
  }

  serverTask(
    project: PlatformProject,
    scope: vscode.WorkspaceFolder | vscode.TaskScope,
    definition: ServerDefinition,
    name: string,
  ): vscode.Task {
    const mode = definition.mode ?? 'run';
    if (mode !== 'run' && mode !== 'debug' && mode !== 'minimal') throw new Error('invalid mode');
    return new vscode.Task(
      definition,
      scope,
      name,
      'SAP Commerce',
      toExecution(serverInvocation(project.platformDir, mode)),
    );
  }

  dispose(): void {
    for (const r of this.registrations) r.dispose();
  }
}
