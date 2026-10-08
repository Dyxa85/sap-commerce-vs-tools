import * as vscode from 'vscode';
import { ccv2 } from '@sapcommerce-vstools/core';
import type { Logger } from '../util/log.js';

/** Finds the CCv2 projects (`core-customize` with `manifest.json`) of the opened folders. */
export class Ccv2Service implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  roots: ccv2.Ccv2Root[] = [];
  readonly onDidChange = this.emitter.event;

  constructor(private readonly log: Logger) {
    const schedule = (): void => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.refresh(), 500);
    };
    const watcher = vscode.workspace.createFileSystemWatcher('**/manifest.json');
    this.disposables.push(
      watcher,
      watcher.onDidCreate(schedule),
      watcher.onDidDelete(schedule),
      vscode.workspace.onDidChangeWorkspaceFolders(schedule),
      this.emitter,
    );
  }

  async refresh(): Promise<void> {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    try {
      this.roots = await ccv2.findCcv2Roots(folders);
    } catch (err) {
      this.log.error('Looking for CCv2 projects failed', err);
      this.roots = [];
    }
    await vscode.commands.executeCommand(
      'setContext',
      'sapcommerce.hasCcv2',
      this.roots.length > 0,
    );
    this.emitter.fire();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
  }
}
