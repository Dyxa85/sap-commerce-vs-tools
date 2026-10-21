import * as vscode from 'vscode';

let iconBase: vscode.Uri | undefined;

/** Where the extension's own tree icons are (`images/tree`). */
export function setIconBase(extensionUri: vscode.Uri): void {
  iconBase = vscode.Uri.joinPath(extensionUri, 'images', 'tree');
}

/** One of the extension's own icons, or the built-in `fallback` when they are not available. */
export function treeIcon(name: string, fallback: string): vscode.Uri | vscode.ThemeIcon {
  return iconBase ? vscode.Uri.joinPath(iconBase, `${name}.svg`) : new vscode.ThemeIcon(fallback);
}
