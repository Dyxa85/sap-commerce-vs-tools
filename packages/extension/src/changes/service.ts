import { basename } from 'node:path';
import * as vscode from 'vscode';
import type { Logger } from '../util/log.js';
import { CHANGE_KINDS, ChangeIndex, letterOf, type Change } from './model.js';

/** The part of the Git extension's API that is used (its types are not published as a package). */
interface GitChange {
  uri: vscode.Uri;
  status: number;
}
interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    workingTreeChanges: GitChange[];
    indexChanges: GitChange[];
    mergeChanges: GitChange[];
    untrackedChanges?: GitChange[];
    onDidChange: vscode.Event<void>;
  };
}
interface GitApi {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}

/** Scheme of the tree items of this extension; Git and the problem markers do not decorate it, our provider does. */
export const TREE_SCHEME = 'sapcommerce-tree';

/** The URI a tree item carries so that it can be decorated by this extension only. */
export function treeUri(path: string): vscode.Uri {
  return vscode.Uri.file(path).with({ scheme: TREE_SCHEME });
}

export interface RepositoryChanges {
  /** Absolute path of the repository. */
  root: string;
  /** Its folder name, which is what the team calls the project. */
  name: string;
  changes: Change[];
}

/**
 * The files that Git reports as changed, per repository, and the decorations that follow from them: changed files and
 * the folders that contain them are coloured like in the Explorer, everything else is left alone.
 */
export class ChangesService implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly decorations = new vscode.EventEmitter<vscode.Uri[]>();
  private readonly disposables: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private api: GitApi | undefined;
  private watched = new Set<GitRepository>();

  repositories: RepositoryChanges[] = [];
  index = new ChangeIndex([]);
  /** Why there is nothing to show, when that is not "no changes". */
  unavailable: string | undefined;
  readonly onDidChange = this.emitter.event;
  readonly onDidChangeFileDecorations = this.decorations.event;

  constructor(private readonly log: Logger) {
    this.disposables.push(this.emitter, this.decorations);
  }

  async start(): Promise<void> {
    const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
    if (!extension) {
      this.unavailable = 'The Git extension is disabled.';
      this.emitter.fire();
      return;
    }
    try {
      const exports = extension.isActive ? extension.exports : await extension.activate();
      this.api = exports.getAPI(1);
    } catch (err) {
      this.log.error('The Git extension could not be reached', err);
      this.unavailable = 'The Git extension is not available.';
      this.emitter.fire();
      return;
    }
    const api = this.api;
    this.disposables.push(
      api.onDidOpenRepository(() => this.watch()),
      api.onDidCloseRepository(() => this.watch()),
    );
    this.watch();
  }

  private watch(): void {
    if (!this.api) return;
    for (const repository of this.api.repositories) {
      if (this.watched.has(repository)) continue;
      this.watched.add(repository);
      this.disposables.push(repository.state.onDidChange(() => this.schedule()));
    }
    this.schedule(0);
  }

  private schedule(delay = 400): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.collect(), delay);
  }

  private collect(): void {
    const before = this.index.paths();
    const repositories: RepositoryChanges[] = [];
    for (const repository of this.api?.repositories ?? []) {
      const root = repository.rootUri.fsPath;
      const state = repository.state;
      const all = [
        ...state.indexChanges,
        ...state.workingTreeChanges,
        ...state.mergeChanges,
        ...(state.untrackedChanges ?? []),
      ];
      repositories.push({
        root,
        name: basename(root),
        changes: all
          .filter((c) => c.status !== 8) // ignored
          .map((c) => ({ path: c.uri.fsPath, letter: letterOf(c.status) })),
      });
    }
    this.repositories = repositories;
    this.index = new ChangeIndex(
      repositories.flatMap((r) => r.changes),
      repositories.map((r) => r.root),
    );
    const touched = new Set([...before, ...this.index.paths()]);
    this.decorations.fire([...touched].map(treeUri));
    this.emitter.fire();
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== TREE_SCHEME) return undefined;
    const letter = this.index.fileLetter(uri.fsPath);
    if (letter) {
      const kind = CHANGE_KINDS[letter];
      return new vscode.FileDecoration(letter, kind.label, new vscode.ThemeColor(kind.color));
    }
    const inside = this.index.insideFolder(uri.fsPath);
    if (inside > 0) {
      return new vscode.FileDecoration(
        undefined,
        `${inside} changed file${inside === 1 ? '' : 's'}`,
        new vscode.ThemeColor(CHANGE_KINDS.M.color),
      );
    }
    return undefined;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
  }
}
