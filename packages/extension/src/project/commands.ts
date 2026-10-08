import * as vscode from 'vscode';
import { dependents, type ExtensionInfo } from '@sapcommerce-vstools/core';
import type { ProjectService } from './service.js';
import { ProjectTree, type Node } from './tree.js';

export function registerProjectView(
  context: vscode.ExtensionContext,
  service: ProjectService,
): ProjectTree {
  const tree = new ProjectTree(service);
  const view = vscode.window.createTreeView<Node>('sapcommerce.project', {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  context.subscriptions.push(view, { dispose: () => tree.dispose() });

  const register = (id: string, fn: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  };

  register('sapcommerce.project.refresh', () => service.refresh());

  register('sapcommerce.project.goToExtension', async () => {
    const all = service.projects.flatMap((p) =>
      [...p.available.values()].map((info) => ({ info, loaded: p.loaded.includes(info) })),
    );
    if (all.length === 0) {
      void vscode.window.showInformationMessage(
        'No SAP Commerce project found in this workspace (looked for bin/platform/extensions.xml).',
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(
      all
        .sort((a, b) => a.info.name.localeCompare(b.info.name))
        .map(({ info, loaded }) => ({
          label: info.name,
          description: `${info.category}${loaded ? '' : ' · not loaded'}`,
          detail: info.dir,
          info,
        })),
      { title: 'Go to extension', matchOnDetail: true },
    );
    if (picked)
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(picked.info.infoFile));
  });

  const extensionOf = (node: Node | undefined): ExtensionInfo | undefined =>
    node?.kind === 'extension' ? node.info : undefined;

  register('sapcommerce.project.openExtensionInfo', async (node: Node) => {
    const info = extensionOf(node);
    if (info) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(info.infoFile));
  });

  register('sapcommerce.project.copyName', async (node: Node) => {
    const info = extensionOf(node);
    if (info) await vscode.env.clipboard.writeText(info.name);
  });

  register('sapcommerce.project.revealInExplorer', async (node: Node) => {
    const info = extensionOf(node);
    if (info) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(info.dir));
  });

  register('sapcommerce.project.showDependents', async (node: Node) => {
    const info = extensionOf(node);
    if (!info || node.kind !== 'extension') return;
    const names = dependents(node.project.loaded, info.name);
    if (names.length === 0) {
      void vscode.window.showInformationMessage(`No loaded extension depends on ${info.name}.`);
      return;
    }
    const picked = await vscode.window.showQuickPick(
      names.map((name) => ({
        label: name,
        description: node.project.available.get(name)?.category,
      })),
      { title: `${names.length} extension(s) depend on ${info.name}` },
    );
    const target = picked ? node.project.available.get(picked.label) : undefined;
    if (target)
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(target.infoFile));
  });

  register('sapcommerce.project.toggleUnloaded', async () => {
    const config = vscode.workspace.getConfiguration('sapcommerce.project');
    await config.update(
      'showUnloadedExtensions',
      !config.get<boolean>('showUnloadedExtensions', false),
      vscode.ConfigurationTarget.Workspace,
    );
  });

  return tree;
}
