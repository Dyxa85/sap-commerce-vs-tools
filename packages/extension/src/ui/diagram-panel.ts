import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { renderDiagramPage, type DiagramPage } from './diagram-html.js';

export interface DiagramHandlers {
  /** A node was clicked. */
  onNode?: (id: string) => void | Promise<void>;
  /** A toolbar button was clicked. */
  onAction?: (id: string) => void | Promise<void>;
}

/** One reusable panel for all diagrams of the extension. */
export class DiagramPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private handlers: DiagramHandlers = {};
  private page: DiagramPage | undefined;

  /** The page currently shown (used by tests). */
  get current(): DiagramPage | undefined {
    return this.page;
  }

  show(page: DiagramPage, handlers: DiagramHandlers = {}): void {
    this.handlers = handlers;
    this.page = page;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'sapcommerceDiagram',
        page.title,
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.page = undefined;
      });
      this.panel.webview.onDidReceiveMessage((m: unknown) => void this.onMessage(m));
    }
    this.panel.title = page.title;
    this.panel.webview.html = renderDiagramPage(page, {
      nonce: randomBytes(16).toString('base64'),
      cspSource: this.panel.webview.cspSource,
    });
    this.panel.reveal(undefined, true);
  }

  /** Re-renders the page that is open, e.g. after the underlying file changed. */
  update(page: DiagramPage): void {
    if (this.panel) this.show(page, this.handlers);
  }

  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) return;
    const m = message as { type?: unknown; id?: unknown };
    if (typeof m.id !== 'string') return;
    if (m.type === 'node') await this.handlers.onNode?.(m.id);
    else if (m.type === 'action') await this.handlers.onAction?.(m.id);
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
