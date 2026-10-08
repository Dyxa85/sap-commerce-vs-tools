import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { toCsv, toJson } from '../util/csv.js';
import { renderResult, type ResultModel } from './results-html.js';

/** One reusable panel for query results, script output, import reports and errors. */
export class ResultsPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private model: ResultModel | undefined;

  /** The model most recently shown (used by extension-host tests). */
  get lastModel(): ResultModel | undefined {
    return this.model;
  }

  show(model: ResultModel): void {
    this.model = model;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'sapcommerceResults',
        'SAP Commerce Results',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((message: unknown) => void this.onMessage(message));
    }
    this.panel.title = model.title;
    this.panel.webview.html = renderResult(model, {
      nonce: randomBytes(16).toString('base64'),
      cspSource: this.panel.webview.cspSource,
    });
    this.panel.reveal(undefined, true);
  }

  private async onMessage(message: unknown): Promise<void> {
    if (
      typeof message !== 'object' ||
      message === null ||
      (message as { type?: unknown }).type !== 'export' ||
      this.model?.kind !== 'query'
    ) {
      return;
    }
    const format = (message as { format?: unknown }).format === 'json' ? 'json' : 'csv';
    const { columns, rows } = this.model.result;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri.with({
        path: `${vscode.workspace.workspaceFolders[0].uri.path}/result.${format}`,
      }),
      filters: format === 'csv' ? { CSV: ['csv'] } : { JSON: ['json'] },
    });
    if (!uri) return;
    const content = format === 'csv' ? toCsv(columns, rows) : toJson(columns, rows);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    void vscode.window.showInformationMessage(`Exported ${rows.length} rows to ${uri.fsPath}`);
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
