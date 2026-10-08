import * as vscode from 'vscode';
import { FEATURES, type FeatureNode } from './features.js';

/** The "Features" view: a table of contents for the whole extension. */
export class FeaturesTree implements vscode.TreeDataProvider<FeatureNode> {
  getTreeItem(node: FeatureNode): vscode.TreeItem {
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(
        node.label,
        node.expanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.description = node.description;
      return item;
    }
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.description = node.description;
    item.iconPath = new vscode.ThemeIcon(node.icon);
    item.tooltip = new vscode.MarkdownString(
      `**${node.label}**\n\n${node.tooltip}\n\n_Also: ${node.description}_`,
    );
    item.command = { command: node.command, title: node.label, arguments: node.args ?? [] };
    return item;
  }

  getChildren(node?: FeatureNode): FeatureNode[] {
    if (!node) return [...FEATURES];
    return node.kind === 'group' ? [...node.children] : [];
  }
}
