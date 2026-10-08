import * as vscode from 'vscode';
import type { ConnectionManager } from '../connections/manager.js';
import type { ConnectionConfig } from '../connections/model.js';
import { ConnectionsTree } from './connections-tree.js';
import { FeaturesTree } from './features-tree.js';
import type { ConnectionsPanel } from '../ui/connections-panel.js';

const WELCOMED = 'sapcommerce.welcomed';

const IMPEX_TEMPLATE = `# ImpEx: insert or update items.
# Cmd/Ctrl+Alt+V validates this file on the active connection, "SAP Commerce: Import ImpEx…" imports it.
INSERT_UPDATE Language;isocode[unique=true];active
;en;true
`;
const FLEXSEARCH_TEMPLATE = `SELECT {pk}, {isocode} FROM {Language}`;

export interface SideBar {
  connections: ConnectionsTree;
  features: FeaturesTree;
}

/** The "SAP Commerce" side bar: connections, a table of contents of all features, and the first-run welcome. */
export function registerSideBar(
  context: vscode.ExtensionContext,
  manager: ConnectionManager,
  panel: ConnectionsPanel,
): SideBar {
  const connections = new ConnectionsTree(manager);
  const features = new FeaturesTree();
  context.subscriptions.push(
    connections,
    vscode.window.createTreeView('sapcommerce.connections', { treeDataProvider: connections }),
    vscode.window.createTreeView('sapcommerce.actions', { treeDataProvider: features }),
  );

  const register = (id: string, fn: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  };

  register('sapcommerce.connections.open', (target?: string) =>
    panel.show(typeof target === 'string' ? target : undefined),
  );
  register('sapcommerce.connection.activate', (c?: ConnectionConfig) => {
    if (c?.id) return manager.setActive(c.id);
    return undefined;
  });
  register('sapcommerce.connection.editItem', (c?: ConnectionConfig) => panel.show(c?.id));

  const open = async (language: string, content: string): Promise<void> => {
    const document = await vscode.workspace.openTextDocument({ language, content });
    await vscode.window.showTextDocument(document);
  };
  register('sapcommerce.file.newImpex', () => open('impex', IMPEX_TEMPLATE));
  register('sapcommerce.file.newFlexSearch', () => open('flexibleSearch', FLEXSEARCH_TEMPLATE));

  const walkthrough = `${context.extension.id}#sapcommerce.start`;
  register('sapcommerce.getStarted', () =>
    vscode.commands.executeCommand('workbench.action.openWalkthrough', walkthrough, false),
  );

  // once, after the first start: where to begin
  if (
    context.extensionMode === vscode.ExtensionMode.Production &&
    !context.globalState.get<boolean>(WELCOMED)
  ) {
    void context.globalState.update(WELCOMED, true);
    void vscode.window
      .showInformationMessage(
        'SAP Commerce VS-Tools is ready. Its views are in the new "SAP Commerce" side bar icon.',
        'Get started',
        'Show features',
      )
      .then((choice) => {
        if (choice === 'Get started')
          return vscode.commands.executeCommand('sapcommerce.getStarted');
        if (choice === 'Show features')
          return vscode.commands.executeCommand('sapcommerce.actions.focus');
        return undefined;
      });
  }
  return { connections, features };
}
