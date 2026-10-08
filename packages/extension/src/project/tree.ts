import { readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import * as vscode from 'vscode';
import {
  listExtensionFiles,
  type ExtensionCategory,
  type ExtensionFile,
  type ExtensionInfo,
  type FileKind,
  type PlatformProject,
} from '@sapcommerce-vstools/core';
import { listFolder, parseHidden, roleOf } from './folders.js';
import type { ProjectService } from './service.js';

export type Node =
  | { kind: 'project'; project: PlatformProject }
  | { kind: 'config'; project: PlatformProject }
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
  | { kind: 'requires'; project: PlatformProject; info: ExtensionInfo };

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
];

export class ProjectTree implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly subscription: vscode.Disposable;

  private watchers: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly service: ProjectService) {
    this.subscription = service.onDidChange(() => {
      this.emitter.fire(undefined);
      this.watch();
    });
    this.watch();
  }

  /** New and deleted files change what the folder tree shows (edits do not), so only those are watched. */
  private watch(): void {
    for (const w of this.watchers) w.dispose();
    this.watchers = [];
    const refresh = (): void => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.emitter.fire(undefined), 500);
    };
    for (const project of this.service.projects) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(project.hybrisDir, '**'),
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
    switch (node.kind) {
      case 'project': {
        const item = new vscode.TreeItem(
          projectLabel(node.project),
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.description = `${node.project.loaded.length} extensions loaded`;
        item.iconPath = new vscode.ThemeIcon('server-environment');
        item.tooltip = node.project.hybrisDir;
        item.contextValue = 'sapcommerce.project';
        const errors = node.project.problems.filter((p) => p.severity === 'error').length;
        if (errors > 0) item.description += ` · ${errors} problem${errors === 1 ? '' : 's'}`;
        return item;
      }
      case 'config': {
        const item = new vscode.TreeItem(
          'Configuration',
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.iconPath = new vscode.ThemeIcon('gear');
        item.tooltip = node.project.configDir;
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
        item.iconPath = new vscode.ThemeIcon(
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
        item.resourceUri = vscode.Uri.file(node.info.dir);
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
    if (!node) {
      return this.service.projects.map((project) => ({ kind: 'project' as const, project }));
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
        return [{ kind: 'config', project: node.project }, ...groups];
      }
      case 'config':
        return configFiles(node.project);
      case 'group':
        return node.extensions.map((info) => ({
          kind: 'extension' as const,
          project: node.project,
          info,
        }));
      case 'extension': {
        // the real folder structure first, as in an IDE; the commerce-specific views sit below it
        const entries = await listFolder(node.info.dir, node.info.dir, this.hiddenRules());
        return [
          ...entries.map((e) =>
            e.isDir
              ? { kind: 'dir' as const, path: e.path, label: e.label, root: node.info.dir }
              : { kind: 'file' as const, path: e.path, label: e.label },
          ),
          { kind: 'overview' as const, project: node.project, info: node.info },
        ];
      }
      case 'dir': {
        const entries = await listFolder(node.path, node.root, this.hiddenRules());
        return entries.map((e) =>
          e.isDir
            ? { kind: 'dir' as const, path: e.path, label: e.label, root: node.root }
            : { kind: 'file' as const, path: e.path, label: e.label },
        );
      }
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
        return [];
    }
  }

  getParent(node: Node): Node | undefined {
    if (node.kind === 'extension') {
      return {
        kind: 'group',
        project: node.project,
        category: node.info.category,
        extensions: this.visibleExtensions(node.project).filter(
          (e) => e.category === node.info.category,
        ),
      };
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

async function configFiles(project: PlatformProject): Promise<Node[]> {
  try {
    const entries = await readdir(project.configDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && /\.(xml|properties)$/.test(e.name))
      .sort((a, b) =>
        a.name === 'localextensions.xml'
          ? -1
          : b.name === 'localextensions.xml'
            ? 1
            : a.name.localeCompare(b.name),
      )
      .map((e) => ({
        kind: 'file' as const,
        path: join(project.configDir, e.name),
        label: e.name,
      }));
  } catch {
    return [];
  }
}

function projectLabel(project: PlatformProject): string {
  return `${basename(dirname(project.hybrisDir))}/${basename(project.hybrisDir)}`;
}

/** A folder of an extension; the file icon theme draws it, well-known folders get a short description. */
export function folderItem(path: string, label: string, root: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
  item.resourceUri = vscode.Uri.file(path);
  item.description = roleOf(root, path);
  item.tooltip = path;
  item.contextValue = 'sapcommerce.folder';
  return item;
}

export function fileItem(path: string, label: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.resourceUri = vscode.Uri.file(path);
  // jars and classes cannot be shown in an editor
  if (!/\.(jar|class|zip|gz|war|ear)$/i.test(path)) {
    item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(path)] };
  }
  item.contextValue = 'sapcommerce.file';
  return item;
}
