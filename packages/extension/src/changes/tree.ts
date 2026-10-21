import { basename, dirname, relative } from 'node:path';
import * as vscode from 'vscode';
import { treeIcon } from '../util/icons.js';
import { CHANGE_KINDS, type Change } from './model.js';
import { treeUri, type ChangesService, type RepositoryChanges } from './service.js';

export type ChangeNode =
  | { kind: 'repo'; repo: RepositoryChanges }
  | { kind: 'file'; repo: RepositoryChanges; change: Change };

/** What a repository holds, so that it gets the icon of its project. */
export type RepositoryKind = 'backend' | 'frontend' | undefined;

/** The changed files of every repository in the workspace, under the folder name of the project. */
export class ChangesTree implements vscode.TreeDataProvider<ChangeNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<ChangeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly subscription: vscode.Disposable;
  /** Set by the owner of the view: which kind of project is in a repository. */
  classify: (root: string) => RepositoryKind = () => undefined;

  constructor(private readonly service: ChangesService) {
    this.subscription = service.onDidChange(() => this.emitter.fire(undefined));
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  /** Repositories that have something to show. */
  private visible(): RepositoryChanges[] {
    return this.service.repositories.filter((r) => r.changes.length > 0);
  }

  count(): number {
    return this.service.index.size;
  }

  /** The text above the tree when there is nothing to list. */
  message(): string | undefined {
    if (this.service.unavailable) return this.service.unavailable;
    if (this.service.repositories.length === 0) return 'No Git repository in this workspace.';
    return this.visible().length === 0 ? 'No changes.' : undefined;
  }

  getTreeItem(node: ChangeNode): vscode.TreeItem {
    if (node.kind === 'repo') {
      const item = new vscode.TreeItem(node.repo.name, vscode.TreeItemCollapsibleState.Expanded);
      const n = node.repo.changes.length;
      item.description = `${n} change${n === 1 ? '' : 's'}`;
      const kind = this.classify(node.repo.root);
      item.iconPath =
        kind === 'backend'
          ? treeIcon('backend', 'server-environment')
          : kind === 'frontend'
            ? treeIcon('frontend', 'browser')
            : new vscode.ThemeIcon('repo');
      item.tooltip = node.repo.root;
      item.id = `repo:${node.repo.root}`;
      item.contextValue = 'sapcommerce.changes.repo';
      return item;
    }
    const { change, repo } = node;
    const item = new vscode.TreeItem(basename(change.path), vscode.TreeItemCollapsibleState.None);
    const folder = relative(repo.root, dirname(change.path));
    item.description = folder === '' ? undefined : folder;
    item.resourceUri = treeUri(change.path);
    item.tooltip = `${CHANGE_KINDS[change.letter].label}: ${change.path}`;
    item.id = `file:${change.path}`;
    item.contextValue = 'sapcommerce.changes.file';
    item.command = {
      command: 'sapcommerce.changes.open',
      title: 'Open',
      arguments: [change.path, change.letter],
    };
    return item;
  }

  getChildren(node?: ChangeNode): ChangeNode[] {
    if (!node) return this.visible().map((repo) => ({ kind: 'repo' as const, repo }));
    if (node.kind !== 'repo') return [];
    return [...node.repo.changes]
      .sort((a, b) => a.path.localeCompare(b.path))
      .filter((c, i, all) => all.findIndex((o) => o.path === c.path) === i)
      .map((change) => ({ kind: 'file' as const, repo: node.repo, change }));
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }
}
