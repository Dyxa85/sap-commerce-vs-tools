import * as vscode from 'vscode';
import type { ConnectionManager } from '../connections/manager.js';
import type { ConnectionConfig } from '../connections/model.js';

/** The connections as a list in the side bar: the active one is marked, a click makes a connection the active one. */
export class ConnectionsTree
  implements vscode.TreeDataProvider<ConnectionConfig>, vscode.Disposable
{
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly manager: ConnectionManager) {
    this.subscription = manager.onDidChange(() => this.emitter.fire());
  }

  getTreeItem(c: ConnectionConfig): vscode.TreeItem {
    const active = this.manager.active()?.id === c.id;
    const item = new vscode.TreeItem(c.name, vscode.TreeItemCollapsibleState.None);
    item.description = `${c.username} @ ${c.url}${c.protected ? '  🛡 protected' : ''}`;
    item.iconPath = active
      ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
      : new vscode.ThemeIcon('circle-large-outline');
    item.tooltip = new vscode.MarkdownString(
      `**${c.name}**${active ? ' – active' : ''}\n\n${c.url}\n\nUser: ${c.username}` +
        (c.protected ? '\n\nProtected: writes need confirmation' : '') +
        (c.ignoreTlsErrors ? '\n\n⚠ TLS certificate verification is OFF' : '') +
        '\n\nClick to use this connection for queries, scripts and imports.',
    );
    item.contextValue = 'sapcommerce.connectionItem';
    item.command = { command: 'sapcommerce.connection.activate', title: 'Use', arguments: [c] };
    return item;
  }

  getChildren(): ConnectionConfig[] {
    return this.manager.list();
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }
}
