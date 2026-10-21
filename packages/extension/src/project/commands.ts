import * as vscode from 'vscode';
import { dependents, type ExtensionInfo, type PlatformProject } from '@sapcommerce-vstools/core';
import type { ProjectService } from './service.js';
import type { ccv2 } from '@sapcommerce-vstools/core';
import { setIconBase } from '../util/icons.js';
import { ProjectTree, type Node } from './tree.js';

export function registerProjectView(
  context: vscode.ExtensionContext,
  service: ProjectService,
  repositoryOf?: (project: PlatformProject) => ccv2.Ccv2Root | undefined,
): ProjectTree {
  setIconBase(context.extensionUri);
  const tree = new ProjectTree(service, repositoryOf);
  const view = vscode.window.createTreeView<Node>('sapcommerce.project', {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  context.subscriptions.push(view, { dispose: () => tree.dispose() });
  tree.attach(view);

  // The file in the editor is selected in the tree, like the Explorer does (setting `sapcommerce.project.autoReveal`).
  let revealTimer: NodeJS.Timeout | undefined;
  let lastRevealed: string | undefined;
  const reveal = (): void => {
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = setTimeout(async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri || uri.scheme !== 'file' || !view.visible) return;
      if (
        !vscode.workspace.getConfiguration('sapcommerce.project').get<boolean>('autoReveal', true)
      )
        return;
      if (uri.fsPath === lastRevealed) return;
      try {
        const node = await tree.nodeFor(uri.fsPath);
        if (!node) return;
        lastRevealed = uri.fsPath;
        await view.reveal(node, { select: true, focus: false, expand: false });
      } catch {
        // the tree changed while it was looked up: the next editor change tries again
      }
    }, 200);
  };
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(reveal),
    view.onDidChangeVisibility(() => {
      lastRevealed = undefined;
      reveal();
    }),
    { dispose: () => revealTimer && clearTimeout(revealTimer) },
  );

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
    const path =
      node?.kind === 'file' || node?.kind === 'dir'
        ? node.path
        : node?.kind === 'frontend'
          ? node.project.dir
          : node?.kind === 'config'
            ? node.project.configDir
            : node?.kind === 'repoRoot'
              ? node.root.dir
              : extensionOf(node)?.dir;
    if (path) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path));
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
