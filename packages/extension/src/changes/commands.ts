import * as vscode from 'vscode';
import type { Logger } from '../util/log.js';
import { ChangesService } from './service.js';
import { ChangesTree, type ChangeNode } from './tree.js';

export interface ChangesParts {
  service: ChangesService;
  tree: ChangesTree;
  view: vscode.TreeView<ChangeNode>;
}

/** The view with the files Git reports as changed, and the colours in the other trees that follow from them. */
export function registerChangesView(context: vscode.ExtensionContext, log: Logger): ChangesParts {
  const service = new ChangesService(log);
  const tree = new ChangesTree(service);
  const view = vscode.window.createTreeView<ChangeNode>('sapcommerce.changes', {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  const update = (): void => {
    view.message = tree.message();
    const count = tree.count();
    view.badge =
      count > 0
        ? { value: count, tooltip: `${count} changed file${count === 1 ? '' : 's'}` }
        : undefined;
  };
  context.subscriptions.push(
    service,
    tree,
    view,
    vscode.window.registerFileDecorationProvider(service),
    service.onDidChange(update),
    vscode.commands.registerCommand('sapcommerce.changes.refresh', () => tree.refresh()),
    // a click shows the change itself; files Git does not know yet are simply opened
    vscode.commands.registerCommand(
      'sapcommerce.changes.open',
      async (path: string, letter: string) => {
        const uri = vscode.Uri.file(path);
        await vscode.commands.executeCommand(
          letter === 'U' ? 'vscode.open' : 'git.openChange',
          uri,
        );
      },
    ),
  );
  update();
  void service.start();
  return { service, tree, view };
}
