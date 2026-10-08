import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { LanguageServerController } from '../language/client.js';
import { renderType, type WireLocation, type WireType } from './type-html.js';

/** One reusable panel that shows the description of an item type, enum, relation or collection. */
export class TypePanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private current: string | undefined;
  private readonly refreshOnIndex: vscode.Disposable;

  constructor(private readonly languages: LanguageServerController) {
    this.refreshOnIndex = languages.onIndexUpdated(() => {
      if (this.panel && this.current) void this.show(this.current, false);
    });
  }

  /** Name of the type currently shown (used by tests). */
  get currentName(): string | undefined {
    return this.current;
  }

  async show(name: string, reveal = true): Promise<boolean> {
    const uri = vscode.window.activeTextEditor?.document.uri.toString();
    const type = await this.languages.request<WireType | null>('sapcommerce/types/describe', {
      name,
      uri,
    });
    if (!type) {
      void vscode.window.showInformationMessage(`Type "${name}" was not found in the type system.`);
      return false;
    }
    const known = await this.knownTypes(type);
    this.current = type.name;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'sapcommerceType',
        type.name,
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.current = undefined;
      });
      this.panel.webview.onDidReceiveMessage((m: unknown) => void this.onMessage(m));
    }
    this.panel.title = type.name;
    this.panel.webview.html = renderType(type, known, {
      nonce: randomBytes(16).toString('base64'),
      cspSource: this.panel.webview.cspSource,
    });
    if (reveal) this.panel.reveal(undefined, true);
    return true;
  }

  /** Names that exist, so that only real types become links. */
  private async knownTypes(type: WireType): Promise<Set<string>> {
    const candidates = new Set<string>([
      type.name,
      ...type.ancestors,
      ...type.subtypes,
      ...type.attributes.flatMap((a) => [
        a.declaredIn,
        ...(a.type.match(/[A-Za-z_$][\w$.]*/g) ?? []),
      ]),
    ]);
    if (type.extends) candidates.add(type.extends);
    if (type.elementType) candidates.add(type.elementType);
    if (type.relation) {
      candidates.add(type.relation.source);
      candidates.add(type.relation.target);
    }
    const known = new Set<string>();
    await Promise.all(
      [...candidates]
        .filter((c) => !c.startsWith('java.') && c !== 'localized')
        .map(async (name) => {
          const hits = await this.languages.request<{ name: string; kind: string }[]>(
            'sapcommerce/types/search',
            { query: name, limit: 5 },
          );
          if (
            hits.some(
              (h) =>
                h.name === name &&
                (h.kind === 'type' ||
                  h.kind === 'enum' ||
                  h.kind === 'relation' ||
                  h.kind === 'bean' ||
                  h.kind === 'bean-enum'),
            )
          )
            known.add(name);
        }),
    );
    return known;
  }

  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) return;
    const m = message as { type?: unknown; name?: unknown; location?: unknown };
    if (m.type === 'show' && typeof m.name === 'string') await this.show(m.name);
    else if (m.type === 'open' && isLocation(m.location)) await openLocation(m.location);
  }

  dispose(): void {
    this.refreshOnIndex.dispose();
    this.panel?.dispose();
  }
}

export function isLocation(value: unknown): value is WireLocation {
  const v = value as WireLocation | undefined;
  return (
    typeof v?.uri === 'string' &&
    typeof v.start?.line === 'number' &&
    typeof v.end?.line === 'number'
  );
}

export async function openLocation(location: WireLocation): Promise<void> {
  const uri = vscode.Uri.parse(location.uri);
  // only files inside the workspace or project are opened (the data comes from files, but never trust it blindly)
  if (uri.scheme !== 'file') return;
  const range = new vscode.Range(
    location.start.line,
    location.start.character,
    location.end.line,
    location.end.character,
  );
  await vscode.window.showTextDocument(uri, { selection: range, preview: true });
}
