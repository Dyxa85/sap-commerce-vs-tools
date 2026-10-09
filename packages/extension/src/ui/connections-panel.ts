import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { checkConnection } from '../connections/check.js';
import { validateConnectionForm, type ConnectionForm } from '../connections/form.js';
import type { ConnectionManager } from '../connections/manager.js';
import type { Logger } from '../util/log.js';
import { renderConnectionsPage } from './connections-html.js';

/** The page where connections are added, edited, tested and removed (instead of a chain of input boxes). */
export class ConnectionsPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly subscription: vscode.Disposable;
  private readonly sent: unknown[] = [];

  constructor(
    private readonly manager: ConnectionManager,
    private readonly log: Logger,
  ) {
    this.subscription = manager.onDidChange(() => void this.pushState());
  }

  /** Messages posted to the page, newest last (used by extension-host tests). */
  get sentMessages(): readonly unknown[] {
    return this.sent;
  }

  get isOpen(): boolean {
    return this.panel !== undefined;
  }

  /** Shows the page. `target` is a connection id, `'new'` for an empty form, or nothing for the active one. */
  show(target?: string): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'sapcommerceConnections',
        'SAP Commerce Connections',
        vscode.ViewColumn.Active,
        { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((m: unknown) => void this.handle(m));
      this.panel.webview.html = renderConnectionsPage({
        nonce: randomBytes(16).toString('base64'),
        cspSource: this.panel.webview.cspSource,
      });
      this.pendingTarget = target;
    } else {
      this.panel.reveal(vscode.ViewColumn.Active);
      this.post({
        type: 'selected',
        id: target === 'new' ? null : (target ?? this.manager.active()?.id ?? null),
      });
    }
  }

  private pendingTarget: string | undefined;

  private post(message: unknown): void {
    this.sent.push(message);
    if (this.sent.length > 50) this.sent.shift();
    void this.panel?.webview.postMessage(message);
  }

  private async pushState(selectedId?: string | null): Promise<void> {
    const connections = await Promise.all(
      this.manager
        .list()
        .map(async (c) => ({ ...c, hasPassword: await this.manager.hasPassword(c) })),
    );
    this.post({
      type: 'state',
      connections,
      activeId: this.manager.active()?.id,
      ...(selectedId !== undefined ? { selectedId } : {}),
    });
  }

  /** Handles one message from the page. Public for the extension-host tests; the page itself is untrusted input. */
  async handle(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) return;
    const m = message as Record<string, unknown>;
    const id = typeof m.id === 'string' ? m.id : undefined;
    const connection = id ? this.manager.list().find((c) => c.id === id) : undefined;
    try {
      switch (m.type) {
        case 'ready': {
          const target = this.pendingTarget;
          this.pendingTarget = undefined;
          await this.pushState(target === 'new' ? null : target);
          return;
        }
        case 'save':
          return await this.save(m as ConnectionForm);
        case 'select':
          if (connection) await this.manager.setActive(connection.id);
          return;
        case 'test': {
          if (!connection) {
            this.post({
              type: 'result',
              ok: false,
              message: 'That connection is not known any more. Save it first.',
            });
            return;
          }
          const result = await checkConnection(this.manager, connection, this.log);
          if (!result.cancelled)
            this.post({ type: 'result', ok: result.ok, message: result.message });
          else this.post({ type: 'result', ok: false, message: 'Cancelled.' });
          await this.pushState();
          return;
        }
        case 'openHac':
          if (connection) await vscode.env.openExternal(vscode.Uri.parse(connection.url));
          return;
        case 'forgetPassword':
          if (connection) {
            await this.manager.forgetPassword(connection);
            this.post({ type: 'result', ok: true, message: 'Stored password removed.' });
            await this.pushState();
          }
          return;
        case 'remove': {
          if (!connection) return;
          const sure = await vscode.window.showWarningMessage(
            `Remove connection "${connection.name}" and its stored password?`,
            { modal: true },
            'Remove',
          );
          if (sure) {
            await this.manager.remove(connection.id);
            this.post({ type: 'result', ok: true, message: `Removed "${connection.name}".` });
            await this.pushState(null);
          }
          return;
        }
      }
    } catch (err) {
      this.log.error('Connections page', err);
      this.post({
        type: 'result',
        ok: false,
        message: 'That did not work – see the output channel.',
      });
    }
  }

  private async save(form: ConnectionForm): Promise<void> {
    const result = validateConnectionForm(form, this.manager.list());
    if (!result.ok) {
      this.post({ type: 'result', ok: false, field: result.field, message: result.message });
      return;
    }
    const { connection, password, originalId } = result;
    const existing = originalId ? this.manager.list().find((c) => c.id === originalId) : undefined;
    const wasActive = existing !== undefined && this.manager.active()?.id === existing.id;
    // a stored password belongs to url + user; when those change it no longer applies
    if (
      existing &&
      (existing.url !== connection.url || existing.username !== connection.username)
    ) {
      await this.manager.forgetPassword(existing);
    }
    await this.manager.upsert(connection, existing?.id);
    if (password !== undefined) await this.manager.storePassword(connection, password);
    if (!existing || wasActive || !this.manager.active())
      await this.manager.setActive(connection.id);
    this.post({ type: 'selected', id: connection.id });
    await this.pushState(connection.id);
    this.post({
      type: 'result',
      ok: true,
      message:
        password !== undefined || (await this.manager.hasPassword(connection))
          ? 'Saved.'
          : 'Saved. The password is asked for when you first use the connection.',
    });
  }

  dispose(): void {
    this.subscription.dispose();
    this.panel?.dispose();
  }
}
