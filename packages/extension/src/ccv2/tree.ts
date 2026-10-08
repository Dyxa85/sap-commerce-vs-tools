import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import * as vscode from 'vscode';
import { ccv2 } from '@sapcommerce-vstools/core';
import { listFolder, parseHidden } from '../project/folders.js';
import { DEFAULT_HIDDEN, fileItem, folderItem } from '../project/tree.js';
import type { Ccv2Service } from './service.js';

export type Ccv2Node =
  | { kind: 'repo'; root: ccv2.Ccv2Root }
  | { kind: 'core'; root: ccv2.Ccv2Root; path: string; label: string }
  | { kind: 'manifest'; file: string }
  | { kind: 'entry'; file: string; entry: ccv2.ManifestEntry }
  | { kind: 'problem'; file: string; message: string; offset: number }
  | { kind: 'hybris'; root: ccv2.Ccv2Root }
  | { kind: 'dir'; path: string; label: string; root: string }
  | { kind: 'file'; path: string; label: string };

const SECTION_ICONS: Record<string, string> = {
  commerceSuiteVersion: 'tag',
  solrVersion: 'tag',
  extensionPacks: 'package',
  extensions: 'extensions',
  useConfig: 'gear',
  properties: 'symbol-key',
  aspects: 'server-process',
  storefrontAddons: 'plug',
  tests: 'beaker',
  webapps: 'globe',
};

export class Ccv2Tree implements vscode.TreeDataProvider<Ccv2Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<Ccv2Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly subscription: vscode.Disposable;
  private manifestWatchers: vscode.Disposable[] = [];

  constructor(private readonly service: Ccv2Service) {
    this.subscription = service.onDidChange(() => {
      this.emitter.fire(undefined);
      this.watchManifests();
    });
    this.watchManifests();
  }

  /** The outline follows edits of `manifest.json`. */
  private watchManifests(): void {
    for (const w of this.manifestWatchers) w.dispose();
    this.manifestWatchers = this.service.roots.map((root) => {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(root.coreCustomize, 'manifest.json'),
      );
      const refresh = (): void => this.emitter.fire(undefined);
      return vscode.Disposable.from(watcher, watcher.onDidChange(refresh));
    });
  }

  private hidden() {
    return parseHidden(
      vscode.workspace
        .getConfiguration('sapcommerce.project')
        .get<string[]>('hiddenEntries', DEFAULT_HIDDEN),
    );
  }

  getTreeItem(node: Ccv2Node): vscode.TreeItem {
    switch (node.kind) {
      case 'repo': {
        const item = new vscode.TreeItem(
          basename(node.root.dir),
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.iconPath = new vscode.ThemeIcon('cloud');
        item.description = 'CCv2 project';
        item.tooltip = node.root.dir;
        item.contextValue = 'sapcommerce.ccv2.repo';
        return item;
      }
      case 'core': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon('cloud');
        item.description = 'manifest.json and hybris';
        item.tooltip = node.path;
        item.contextValue = 'sapcommerce.folder';
        return item;
      }
      case 'manifest': {
        const item = new vscode.TreeItem(
          'manifest.json',
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.iconPath = new vscode.ThemeIcon('json');
        item.description = 'build and deployment definition';
        item.tooltip = node.file;
        item.command = {
          command: 'vscode.open',
          title: 'Open',
          arguments: [vscode.Uri.file(node.file)],
        };
        item.contextValue = 'sapcommerce.file';
        item.resourceUri = vscode.Uri.file(node.file);
        return item;
      }
      case 'entry': {
        const { entry } = node;
        const item = new vscode.TreeItem(
          entry.label,
          entry.children.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
        );
        item.description = entry.description;
        item.iconPath = new vscode.ThemeIcon(SECTION_ICONS[entry.section] ?? 'symbol-field');
        item.command = {
          command: 'sapcommerce.ccv2.reveal',
          title: 'Show in manifest.json',
          arguments: [node.file, entry.offset],
        };
        return item;
      }
      case 'problem': {
        const item = new vscode.TreeItem(node.message, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
        item.command = {
          command: 'sapcommerce.ccv2.reveal',
          title: 'Show in manifest.json',
          arguments: [node.file, node.offset],
        };
        return item;
      }
      case 'hybris': {
        const item = new vscode.TreeItem('hybris', vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon('server-environment');
        item.description =
          'configuration and custom code – platform and extensions are in "Commerce Project"';
        item.tooltip = join(node.root.coreCustomize, 'hybris');
        return item;
      }
      case 'dir':
        return folderItem(node.path, node.label, node.root);
      case 'file':
        return fileItem(node.path, node.label);
    }
  }

  async getChildren(node?: Ccv2Node): Promise<Ccv2Node[]> {
    if (!node) {
      return this.service.roots.map((root) =>
        root.dir === root.coreCustomize
          ? ({ kind: 'core', root, path: root.coreCustomize, label: basename(root.dir) } as const)
          : ({ kind: 'repo', root } as const),
      );
    }
    switch (node.kind) {
      case 'repo': {
        // the repository root: core-customize, js-storefront, scripts, … as they are on disk
        const entries = await listFolder(node.root.dir, node.root.dir, this.hidden());
        return entries.map((e) => {
          if (e.isDir && e.path === node.root.coreCustomize)
            return { kind: 'core' as const, root: node.root, path: e.path, label: e.label };
          return e.isDir
            ? { kind: 'dir' as const, path: e.path, label: e.label, root: node.root.dir }
            : { kind: 'file' as const, path: e.path, label: e.label };
        });
      }
      case 'core': {
        const entries = await listFolder(node.path, node.path, this.hidden());
        const children: Ccv2Node[] = [{ kind: 'manifest', file: join(node.path, 'manifest.json') }];
        for (const e of entries) {
          if (e.label === 'manifest.json') continue;
          if (e.isDir && e.label === 'hybris') children.push({ kind: 'hybris', root: node.root });
          else if (e.isDir)
            children.push({ kind: 'dir', path: e.path, label: e.label, root: node.path });
          else children.push({ kind: 'file', path: e.path, label: e.label });
        }
        return children;
      }
      case 'manifest': {
        let text: string;
        try {
          text = await readFile(node.file, 'utf8');
        } catch {
          return [
            {
              kind: 'problem',
              file: node.file,
              message: 'manifest.json cannot be read',
              offset: 0,
            },
          ];
        }
        const outline = ccv2.manifestOutline(text);
        if (outline.error) {
          return [
            {
              kind: 'problem',
              file: node.file,
              message: `Invalid JSON: ${outline.error.message}`,
              offset: outline.error.offset,
            },
          ];
        }
        return outline.entries.map((entry) => ({ kind: 'entry' as const, file: node.file, entry }));
      }
      case 'entry':
        return node.entry.children.map((entry) => ({
          kind: 'entry' as const,
          file: node.file,
          entry,
        }));
      case 'hybris': {
        // only what a project owns: its configuration and its custom extensions
        const base = join(node.root.coreCustomize, 'hybris');
        const wanted: [string, string][] = [
          [join(base, 'config'), 'config'],
          [join(base, 'bin', 'custom'), 'bin/custom'],
        ];
        const found: Ccv2Node[] = [];
        for (const [path, label] of wanted) {
          if (await exists(path))
            found.push({ kind: 'dir', path, label, root: node.root.coreCustomize });
        }
        return found;
      }
      case 'dir': {
        const entries = await listFolder(node.path, node.root, this.hidden());
        return entries.map((e) =>
          e.isDir
            ? { kind: 'dir' as const, path: e.path, label: e.label, root: node.root }
            : { kind: 'file' as const, path: e.path, label: e.label },
        );
      }
      default:
        return [];
    }
  }

  dispose(): void {
    for (const w of this.manifestWatchers) w.dispose();
    this.subscription.dispose();
    this.emitter.dispose();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(path));
    return true;
  } catch {
    return false;
  }
}
