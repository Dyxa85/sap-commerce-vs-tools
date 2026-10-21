import { basename, dirname, relative, sep } from 'node:path';
import * as vscode from 'vscode';
import {
  listExtensionFiles,
  type ExtensionCategory,
  type ExtensionFile,
  type ExtensionInfo,
  type FileKind,
  type FrontendProject,
  type PlatformProject,
  type ccv2,
} from '@sapcommerce-vstools/core';
import { treeUri } from '../changes/service.js';
import { treeIcon } from '../util/icons.js';
import { listFolder, parseHidden, roleOf } from './folders.js';
import type { ProjectService } from './service.js';

type Link = { id?: string; parent?: Node };

export type Node = Link &
  (
    | { kind: 'javaHint' }
    | { kind: 'project'; project: PlatformProject }
    | { kind: 'frontend'; project: FrontendProject }
    | { kind: 'config'; project: PlatformProject }
    | { kind: 'repoRoot'; root: ccv2.Ccv2Root }
    | {
        kind: 'group';
        project: PlatformProject;
        category: ExtensionCategory;
        extensions: ExtensionInfo[];
      }
    | { kind: 'extension'; project: PlatformProject; info: ExtensionInfo }
    | { kind: 'fileGroup'; info: ExtensionInfo; fileKind: FileKind; files: ExtensionFile[] }
    | { kind: 'dir'; path: string; label: string; root: string }
    | { kind: 'overview'; project: PlatformProject; info: ExtensionInfo }
    | { kind: 'file'; path: string; label: string }
    | { kind: 'requires'; project: PlatformProject; info: ExtensionInfo }
  );

/** Identifies a node among its siblings; with the ids of its ancestors it is unique in the whole tree. */
function keyOf(node: Node): string {
  switch (node.kind) {
    case 'javaHint':
    case 'config':
    case 'repoRoot':
    case 'overview':
    case 'requires':
      return node.kind;
    case 'project':
      return `project:${node.project.hybrisDir}`;
    case 'frontend':
      return `frontend:${node.project.dir}`;
    case 'group':
      return `group:${node.category}`;
    case 'extension':
      return `ext:${node.info.name}`;
    case 'fileGroup':
      return `kind:${node.fileKind}`;
    case 'dir':
      return `dir:${node.path}`;
    case 'file':
      return `file:${node.path}|${node.label}`;
  }
}

const within = (base: string, path: string): boolean =>
  path === base || path.startsWith(base + sep);

const GROUP_LABELS: Record<ExtensionCategory, string> = {
  custom: 'Custom',
  modules: 'Modules',
  platform: 'Platform',
  other: 'Other',
};
const GROUP_ORDER: ExtensionCategory[] = ['custom', 'modules', 'platform', 'other'];

const FILE_GROUP_LABELS: Record<FileKind, string> = {
  items: 'Type system (items.xml)',
  beans: 'Beans (beans.xml)',
  spring: 'Spring',
  process: 'Business processes',
  impex: 'ImpEx',
  flexsearch: 'FlexibleSearch',
  backoffice: 'Backoffice',
  properties: 'Properties',
  other: 'Other',
};
const FILE_GROUP_ICONS: Record<FileKind, string> = {
  items: 'symbol-class',
  beans: 'symbol-structure',
  spring: 'symbol-interface',
  process: 'git-merge',
  impex: 'database',
  flexsearch: 'search',
  backoffice: 'window',
  properties: 'settings-gear',
  other: 'file',
};

/** Build output and tool folders that only clutter the tree. `/bin` is the top-level folder holding built jars. */
export const DEFAULT_HIDDEN = [
  '.git',
  '.idea',
  '.settings',
  'node_modules',
  'classes',
  'eclipsebin',
  '.DS_Store',
  '/bin',
  // build output of JavaScript projects
  '.angular',
  'dist',
  'coverage',
];

export class ProjectTree implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly subscription: vscode.Disposable;

  private view: vscode.TreeView<Node> | undefined;
  private watchers: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;

  /**
   * @param repositoryOf the CCv2 repository a project lives in, if it is one (its root is shown next to the extensions)
   */
  constructor(
    private readonly service: ProjectService,
    private readonly repositoryOf: (project: PlatformProject) => ccv2.Ccv2Root | undefined = () =>
      undefined,
  ) {
    this.subscription = service.onDidChange(() => {
      this.emitter.fire(undefined);
      this.watch();
    });
    this.watch();
  }

  /** The view this tree belongs to, so a message can be shown above it. */
  attach(view: vscode.TreeView<Node>): void {
    this.view = view;
  }

  /** Called when the CCv2 repositories were (re)detected. */
  refresh(): void {
    this.emitter.fire(undefined);
  }

  /** Shows or hides the entry at the top that leads to the Java setup. */
  setJavaHint(visible: boolean): void {
    if (this.javaHint === visible) return;
    this.javaHint = visible;
    this.emitter.fire(undefined);
  }

  javaHint = false;

  /** New and deleted files change what the folder tree shows (edits do not), so only those are watched. */
  private watch(): void {
    for (const w of this.watchers) w.dispose();
    this.watchers = [];
    const refresh = (): void => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.emitter.fire(undefined), 500);
    };
    const dirs = [
      ...this.service.projects.map((p) => p.hybrisDir),
      ...this.service.frontends.map((f) => f.dir),
    ];
    for (const dir of dirs) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(dir, '**'),
        false,
        true,
        false,
      );
      this.watchers.push(watcher, watcher.onDidCreate(refresh), watcher.onDidDelete(refresh));
    }
  }

  private showUnloaded(): boolean {
    return vscode.workspace
      .getConfiguration('sapcommerce.project')
      .get<boolean>('showUnloadedExtensions', false);
  }

  private hiddenRules() {
    return parseHidden(
      vscode.workspace
        .getConfiguration('sapcommerce.project')
        .get<string[]>('hiddenEntries', DEFAULT_HIDDEN),
    );
  }

  /** Extensions of one project that are shown (loaded ones, or all when configured). */
  visibleExtensions(project: PlatformProject): ExtensionInfo[] {
    return this.showUnloaded() ? [...project.available.values()] : project.loaded;
  }

  // ------------------------------------------------------------ TreeDataProvider

  getTreeItem(node: Node): vscode.TreeItem {
    const item = this.itemOf(node);
    item.id = node.id;
    return item;
  }

  private itemOf(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'javaHint': {
        const item = new vscode.TreeItem(
          'Java is not set up – click to configure',
          vscode.TreeItemCollapsibleState.None,
        );
        item.iconPath = new vscode.ThemeIcon(
          'warning',
          new vscode.ThemeColor('list.warningForeground'),
        );
        item.description = 'imports show as unresolved';
        item.tooltip = new vscode.MarkdownString(
          'The Java extension does not know the classes of the platform and your extensions yet.\n\nClick to set it up. The first build takes a few minutes.',
        );
        item.command = { command: 'sapcommerce.java.configure', title: 'Set up Java' };
        return item;
      }
      case 'project': {
        const repository = this.repositoryOf(node.project);
        const item = new vscode.TreeItem(
          repository && repository.dir !== repository.coreCustomize
            ? basename(repository.dir)
            : projectLabel(node.project),
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.description = [
          repository && repository.dir !== repository.coreCustomize
            ? posixRelative(repository.dir, node.project.hybrisDir)
            : undefined,
          `${node.project.loaded.length} extensions loaded`,
        ]
          .filter(Boolean)
          .join(' · ');
        item.iconPath = treeIcon('backend', 'server-environment');
        item.tooltip = node.project.hybrisDir;
        item.contextValue = 'sapcommerce.project';
        const errors = node.project.problems.filter((p) => p.severity === 'error').length;
        if (errors > 0) item.description += ` · ${errors} problem${errors === 1 ? '' : 's'}`;
        return item;
      }
      case 'frontend': {
        const item = new vscode.TreeItem(
          node.project.name,
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.description = node.project.framework;
        item.iconPath = treeIcon('frontend', 'browser');
        item.tooltip = node.project.dir;
        item.contextValue = 'sapcommerce.folder';
        item.resourceUri = treeUri(node.project.dir);
        return item;
      }
      case 'config': {
        const item = new vscode.TreeItem(
          'Configuration',
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.description = 'hybris/config';
        item.iconPath = treeIcon('config', 'gear');
        item.tooltip = node.project.configDir;
        item.resourceUri = treeUri(node.project.configDir);
        item.contextValue = 'sapcommerce.folder';
        return item;
      }
      case 'repoRoot': {
        const item = new vscode.TreeItem('Root', vscode.TreeItemCollapsibleState.Collapsed);
        item.description = `${basename(node.root.dir)}, without core-customize`;
        item.iconPath = treeIcon('root', 'root-folder');
        item.tooltip = node.root.dir;
        item.resourceUri = treeUri(node.root.dir);
        item.contextValue = 'sapcommerce.folder';
        return item;
      }
      case 'group': {
        const item = new vscode.TreeItem(
          GROUP_LABELS[node.category],
          node.category === 'custom'
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.description = String(node.extensions.length);
        item.iconPath = treeIcon(
          node.category === 'other' ? 'modules' : node.category,
          node.category === 'custom' ? 'folder-active' : 'folder',
        );
        return item;
      }
      case 'extension': {
        const loaded = node.project.loaded.includes(node.info);
        const item = new vscode.TreeItem(node.info.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.description = [
          node.info.version,
          node.info.webModule ? 'web' : '',
          loaded ? '' : 'not loaded',
        ]
          .filter(Boolean)
          .join(' · ');
        item.iconPath = new vscode.ThemeIcon(
          node.info.webModule ? 'globe' : 'package',
          loaded ? undefined : new vscode.ThemeColor('disabledForeground'),
        );
        item.tooltip = new vscode.MarkdownString(
          `**${node.info.name}**${node.info.version ? ` ${node.info.version}` : ''}\n\n${node.info.dir}` +
            (node.info.requires.length > 0 ? `\n\nRequires: ${node.info.requires.join(', ')}` : ''),
        );
        item.contextValue = 'sapcommerce.extension';
        // Git changes colour the item; the problem markers of the files below it do not (they made every extension yellow)
        item.resourceUri = treeUri(node.info.dir);
        return item;
      }
      case 'fileGroup': {
        const item = new vscode.TreeItem(
          FILE_GROUP_LABELS[node.fileKind],
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.description = String(node.files.length);
        item.iconPath = new vscode.ThemeIcon(FILE_GROUP_ICONS[node.fileKind]);
        return item;
      }
      case 'dir':
        return folderItem(node.path, node.label, node.root);
      case 'overview': {
        const item = new vscode.TreeItem(
          'Commerce overview',
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.description = 'type system, beans, Spring, processes, ImpEx, dependencies';
        item.iconPath = new vscode.ThemeIcon('list-tree');
        return item;
      }
      case 'file':
        return fileItem(node.path, node.label);
      case 'requires': {
        const item = new vscode.TreeItem('Requires', vscode.TreeItemCollapsibleState.Collapsed);
        item.description = String(node.info.requires.length);
        item.iconPath = new vscode.ThemeIcon('references');
        return item;
      }
    }
  }

  async getChildren(node?: Node): Promise<Node[]> {
    const children = await this.childrenOf(node);
    // every node knows its parent (for `reveal`) and has an id that is unique in the whole tree
    for (const child of children) {
      child.parent = node;
      child.id = `${node?.id ?? ''}/${keyOf(child)}`;
    }
    return children;
  }

  private async childrenOf(node?: Node): Promise<Node[]> {
    if (!node) {
      const top: Node[] = [
        ...this.service.projects.map((project) => ({ kind: 'project' as const, project })),
        ...this.service.frontends.map((project) => ({ kind: 'frontend' as const, project })),
      ];
      return this.javaHint ? [{ kind: 'javaHint' as const }, ...top] : top;
    }
    switch (node.kind) {
      case 'project': {
        const extensions = this.visibleExtensions(node.project);
        const groups = GROUP_ORDER.map((category) => ({
          kind: 'group' as const,
          project: node.project,
          category,
          extensions: extensions
            .filter((e) => e.category === category)
            .sort((a, b) => a.name.localeCompare(b.name)),
        })).filter((g) => g.extensions.length > 0);
        const repository = this.repositoryOf(node.project);
        const root: Node[] =
          repository && repository.dir !== repository.coreCustomize
            ? [{ kind: 'repoRoot', root: repository }]
            : [];
        return [{ kind: 'config', project: node.project }, ...groups, ...root];
      }
      case 'config':
        return this.folderNodes(node.project.configDir, node.project.configDir);
      case 'frontend':
        return this.folderNodes(node.project.dir, node.project.dir);
      case 'repoRoot':
        return (await this.folderNodes(node.root.dir, node.root.dir)).filter(
          (n) => !(n.kind === 'dir' && within(node.root.coreCustomize, n.path)),
        );
      case 'group':
        return node.extensions.map((info) => ({
          kind: 'extension' as const,
          project: node.project,
          info,
        }));
      case 'extension': {
        // the real folder structure first, as in an IDE; the commerce-specific views sit below it
        return [
          ...(await this.folderNodes(node.info.dir, node.info.dir)),
          { kind: 'overview' as const, project: node.project, info: node.info },
        ];
      }
      case 'dir':
        return this.folderNodes(node.path, node.root);
      case 'overview': {
        const files = await listExtensionFiles(node.info);
        const kinds: FileKind[] = [
          'items',
          'beans',
          'spring',
          'process',
          'backoffice',
          'impex',
          'flexsearch',
        ];
        const children: Node[] = [];
        for (const fileKind of kinds) {
          const list = files.filter((f) => f.kind === fileKind);
          if (list.length > 0)
            children.push({ kind: 'fileGroup', info: node.info, fileKind, files: list });
        }
        if (node.info.requires.length > 0)
          children.push({ kind: 'requires', project: node.project, info: node.info });
        return children;
      }
      case 'fileGroup':
        return node.files.map((f) => ({
          kind: 'file' as const,
          path: f.path,
          label: basename(f.path),
        }));
      case 'requires':
        return node.info.requires.map((name) => {
          const target = node.project.available.get(name);
          return target
            ? { kind: 'extension' as const, project: node.project, info: target }
            : { kind: 'file' as const, path: node.info.infoFile, label: `${name} (missing)` };
        });
      case 'file':
      case 'javaHint':
        return [];
    }
  }

  private async folderNodes(dir: string, root: string): Promise<Node[]> {
    const entries = await listFolder(dir, root, this.hiddenRules());
    return entries.map((e) =>
      e.isDir
        ? { kind: 'dir' as const, path: e.path, label: e.label, root }
        : { kind: 'file' as const, path: e.path, label: e.label },
    );
  }

  getParent(node: Node): Node | undefined {
    return node.parent;
  }

  /** Does the subtree of this node contain the file? Only nodes that stand for folders on disk can say yes. */
  private covers(node: Node, path: string): boolean {
    switch (node.kind) {
      case 'project': {
        const repository = this.repositoryOf(node.project);
        return (
          within(node.project.hybrisDir, path) ||
          (repository !== undefined && within(repository.dir, path))
        );
      }
      case 'frontend':
        return within(node.project.dir, path);
      case 'config':
        return within(node.project.configDir, path);
      case 'repoRoot':
        return within(node.root.dir, path) && !within(node.root.coreCustomize, path);
      case 'group':
        return node.extensions.some((e) => within(e.dir, path));
      case 'extension':
        return within(node.info.dir, path);
      case 'dir':
        return within(node.path, path);
      case 'file':
        return node.path === path;
      default:
        return false;
    }
  }

  /** The node that shows this file, found by walking down from the top; undefined if the tree does not show it. */
  async nodeFor(path: string): Promise<Node | undefined> {
    let level = await this.getChildren(undefined);
    for (let depth = 0; depth < 64; depth++) {
      const next = level.find((n) => this.covers(n, path));
      if (!next) return undefined;
      if (next.kind === 'file') return next;
      level = await this.getChildren(next);
    }
    return undefined;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const w of this.watchers) w.dispose();
    this.subscription.dispose();
    this.emitter.dispose();
  }
}

function posixRelative(from: string, to: string): string {
  return relative(from, to).split(sep).join('/');
}

function projectLabel(project: PlatformProject): string {
  return `${basename(dirname(project.hybrisDir))}/${basename(project.hybrisDir)}`;
}

/** A folder of an extension; the file icon theme draws it, well-known folders get a short description. */
export function folderItem(path: string, label: string, root: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
  item.resourceUri = treeUri(path);
  item.description = roleOf(root, path);
  item.tooltip = path;
  item.contextValue = 'sapcommerce.folder';
  return item;
}

export function fileItem(path: string, label: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.resourceUri = treeUri(path);
  // jars and classes cannot be shown in an editor
  if (!/\.(jar|class|zip|gz|war|ear)$/i.test(path)) {
    item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(path)] };
  }
  item.contextValue = 'sapcommerce.file';
  return item;
}
