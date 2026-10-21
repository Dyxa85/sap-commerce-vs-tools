import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import * as vscode from 'vscode';
import { ccv2 } from '@sapcommerce-vstools/core';
import { treeIcon } from '../util/icons.js';
import type { Ccv2Service } from './service.js';

export type Ccv2Node =
  | { kind: 'repo'; root: ccv2.Ccv2Root }
  | { kind: 'entry'; file: string; entry: ccv2.ManifestEntry }
  | { kind: 'problem'; file: string; message: string; offset: number };

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

/** What a CCv2 repository defines: the outline of its `manifest.json`. The files themselves are in the other views. */
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

  getTreeItem(node: Ccv2Node): vscode.TreeItem {
    switch (node.kind) {
      case 'repo': {
        const file = join(node.root.coreCustomize, 'manifest.json');
        const item = new vscode.TreeItem(
          basename(node.root.dir),
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.iconPath = treeIcon('ccv2', 'cloud');
        item.description = 'manifest.json';
        item.tooltip = file;
        item.id = `repo:${node.root.coreCustomize}`;
        item.contextValue = 'sapcommerce.ccv2.repo';
        item.command = {
          command: 'vscode.open',
          title: 'Open manifest.json',
          arguments: [vscode.Uri.file(file)],
        };
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
    }
  }

  async getChildren(node?: Ccv2Node): Promise<Ccv2Node[]> {
    if (!node) return this.service.roots.map((root) => ({ kind: 'repo' as const, root }));
    switch (node.kind) {
      case 'repo':
        return this.outline(join(node.root.coreCustomize, 'manifest.json'));
      case 'entry':
        return node.entry.children.map((entry) => ({
          kind: 'entry' as const,
          file: node.file,
          entry,
        }));
      default:
        return [];
    }
  }

  private async outline(file: string): Promise<Ccv2Node[]> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      return [{ kind: 'problem', file, message: 'manifest.json cannot be read', offset: 0 }];
    }
    const outline = ccv2.manifestOutline(text);
    if (outline.error) {
      return [
        {
          kind: 'problem',
          file,
          message: `Invalid JSON: ${outline.error.message}`,
          offset: outline.error.offset,
        },
      ];
    }
    return outline.entries.map((entry) => ({ kind: 'entry' as const, file, entry }));
  }

  dispose(): void {
    for (const w of this.manifestWatchers) w.dispose();
    this.subscription.dispose();
    this.emitter.dispose();
  }
}
