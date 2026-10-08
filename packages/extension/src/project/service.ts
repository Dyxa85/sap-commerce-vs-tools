import { isAbsolute, join } from 'node:path';
import * as vscode from 'vscode';
import { findHybrisDirs, loadPlatform, type PlatformProject } from '@sapcommerce-vstools/core';
import type { Logger } from '../util/log.js';

/**
 * Finds the SAP Commerce `hybris` directories of the workspace, loads their project model and keeps it up to date
 * when `localextensions.xml` or an `extensioninfo.xml` changes.
 */
export class ProjectService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private refreshing: Promise<void> | undefined;
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('sapcommerce-project');

  projects: PlatformProject[] = [];
  readonly onDidChange = this.emitter.event;

  constructor(private readonly log: Logger) {
    const schedule = (): void => this.scheduleRefresh();
    for (const pattern of ['**/localextensions.xml', '**/extensioninfo.xml']) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      this.disposables.push(
        watcher,
        watcher.onDidChange(schedule),
        watcher.onDidCreate(schedule),
        watcher.onDidDelete(schedule),
      );
    }
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(schedule),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('sapcommerce.project')) schedule();
      }),
      this.diagnostics,
      this.emitter,
    );
  }

  scheduleRefresh(delay = 600): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), delay);
  }

  /** (Re)loads all projects. Concurrent calls share one run. */
  refresh(): Promise<void> {
    this.refreshing ??= this.load().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async roots(): Promise<string[]> {
    const configured = vscode.workspace
      .getConfiguration('sapcommerce.project')
      .get<string[]>('roots', []);
    const folders = vscode.workspace.workspaceFolders ?? [];
    const dirs = new Set<string>();
    if (configured.length > 0) {
      for (const root of configured) {
        const base = folders[0]?.uri.fsPath ?? '';
        dirs.add(isAbsolute(root) ? root : join(base, root));
      }
    } else {
      for (const folder of folders)
        for (const dir of await findHybrisDirs(folder.uri.fsPath)) dirs.add(dir);
    }
    return [...dirs];
  }

  private async load(): Promise<void> {
    const started = Date.now();
    try {
      const roots = await this.roots();
      this.projects = await Promise.all(roots.map((root) => loadPlatform(root)));
      await vscode.commands.executeCommand(
        'setContext',
        'sapcommerce.hasProject',
        this.projects.length > 0,
      );
      await this.publishProblems();
      const extensions = this.projects.reduce((n, p) => n + p.loaded.length, 0);
      this.log.info(
        `Project model: ${this.projects.length} project(s), ${extensions} loaded extension(s) in ${Date.now() - started} ms`,
      );
    } catch (err) {
      this.log.error('Loading the project model failed', err);
      this.projects = [];
    }
    this.emitter.fire();
  }

  private async publishProblems(): Promise<void> {
    this.diagnostics.clear();
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const project of this.projects) {
      for (const problem of project.problems) {
        if (!problem.span) continue;
        let range: vscode.Range | undefined;
        try {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(problem.file));
          range = new vscode.Range(
            document.positionAt(problem.span.start),
            document.positionAt(problem.span.end),
          );
        } catch {
          continue;
        }
        const severity =
          problem.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : problem.severity === 'warning'
              ? vscode.DiagnosticSeverity.Warning
              : vscode.DiagnosticSeverity.Information;
        const diagnostic = new vscode.Diagnostic(range, problem.message, severity);
        diagnostic.source = 'sapcommerce-project';
        byFile.set(problem.file, [...(byFile.get(problem.file) ?? []), diagnostic]);
      }
    }
    for (const [file, list] of byFile) this.diagnostics.set(vscode.Uri.file(file), list);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
  }
}
