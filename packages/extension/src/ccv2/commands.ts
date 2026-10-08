import * as vscode from 'vscode';
import type { Logger } from '../util/log.js';
import { Ccv2Service } from './service.js';
import { Ccv2Tree, type Ccv2Node } from './tree.js';

export interface Ccv2Parts {
  service: Ccv2Service;
  tree: Ccv2Tree;
}

/** The CCv2 view: structure of the repository and an outline of its `manifest.json`. */
export function registerCcv2View(context: vscode.ExtensionContext, log: Logger): Ccv2Parts {
  const service = new Ccv2Service(log);
  const tree = new Ccv2Tree(service);
  const view = vscode.window.createTreeView<Ccv2Node>('sapcommerce.ccv2', {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  context.subscriptions.push(service, tree, view);

  context.subscriptions.push(
    vscode.commands.registerCommand('sapcommerce.ccv2.refresh', () => service.refresh()),
    // opens manifest.json with the cursor on the entry that was clicked in the outline
    vscode.commands.registerCommand(
      'sapcommerce.ccv2.reveal',
      async (file: string, offset: number) => {
        if (typeof file !== 'string' || typeof offset !== 'number') return;
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        const position = document.positionAt(offset);
        await vscode.window.showTextDocument(document, {
          selection: new vscode.Range(position, position),
          preview: true,
        });
      },
    ),
  );
  void service.refresh();
  return { service, tree };
}
