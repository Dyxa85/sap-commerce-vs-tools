import * as vscode from 'vscode';
import type { LanguageServerController } from '../language/client.js';
import { isLocation, openLocation, type TypePanel } from '../ui/type-panel.js';
import type { WireLocation } from '../ui/type-html.js';

interface Hit {
  kind:
    | 'type'
    | 'enum'
    | 'attribute'
    | 'enum-value'
    | 'relation'
    | 'bean'
    | 'bean-enum'
    | 'bean-property';
  name: string;
  owner?: string;
  detail?: string;
  location?: WireLocation;
}

const ICONS: Record<Hit['kind'], string> = {
  type: 'symbol-class',
  enum: 'symbol-enum',
  attribute: 'symbol-property',
  'enum-value': 'symbol-enum-member',
  relation: 'link',
  bean: 'symbol-structure',
  'bean-enum': 'symbol-enum',
  'bean-property': 'symbol-field',
};

function wordAtCursor(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const selected = editor.selection.isEmpty
    ? undefined
    : editor.document.getText(editor.selection).trim();
  if (selected && /^[A-Za-z_$][\w$]*$/.test(selected)) return selected;
  const range = editor.document.getWordRangeAtPosition(editor.selection.active, /[A-Za-z_$][\w$]*/);
  return range ? editor.document.getText(range) : undefined;
}

export function registerTypeCommands(
  context: vscode.ExtensionContext,
  languages: LanguageServerController,
  panel: TypePanel,
): void {
  const register = (id: string, fn: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  };

  /** Quick pick backed by the server's type search. Resolves with the chosen hit. */
  async function pick(
    title: string,
    kinds: readonly Hit['kind'][] | undefined,
    initial?: string,
  ): Promise<Hit | undefined> {
    const uri = vscode.window.activeTextEditor?.document.uri.toString();
    const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { hit: Hit }>();
    quickPick.title = title;
    quickPick.placeholder = 'Type a name, e.g. "product code" or "badge"';
    quickPick.matchOnDescription = true;
    quickPick.value = initial ?? '';
    let sequence = 0;
    const search = async (query: string): Promise<void> => {
      const mine = ++sequence;
      if (query.trim() === '') {
        quickPick.items = [];
        return;
      }
      quickPick.busy = true;
      try {
        const hits = await languages.request<Hit[]>('sapcommerce/types/search', {
          query,
          limit: 100,
          uri,
        });
        if (mine !== sequence) return;
        quickPick.items = hits
          .filter((h) => !kinds || kinds.includes(h.kind))
          .map((hit) => ({
            label: `$(${ICONS[hit.kind]}) ${hit.name}`,
            description: hit.owner
              ? `${hit.owner}${hit.detail ? ` · ${hit.detail}` : ''}`
              : hit.detail,
            hit,
          }));
      } catch (err) {
        quickPick.items = [
          {
            label: '$(error) Language server not available',
            description: err instanceof Error ? err.message : String(err),
            hit: { kind: 'type', name: '' },
          },
        ];
      } finally {
        if (mine === sequence) quickPick.busy = false;
      }
    };
    let timer: NodeJS.Timeout | undefined;
    quickPick.onDidChangeValue((value) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void search(value), 120);
    });
    if (initial) void search(initial);

    return new Promise((resolve) => {
      quickPick.onDidAccept(() => {
        const picked = quickPick.selectedItems[0]?.hit;
        resolve(picked && picked.name !== '' ? picked : undefined);
        quickPick.hide();
      });
      quickPick.onDidHide(() => {
        resolve(undefined);
        quickPick.dispose();
      });
      quickPick.show();
    });
  }

  register('sapcommerce.types.search', async () => {
    const hit = await pick('Go to type, bean, attribute or enum value', undefined, wordAtCursor());
    if (hit?.location && isLocation(hit.location)) await openLocation(hit.location);
  });

  register('sapcommerce.types.show', async (name?: string) => {
    let target = typeof name === 'string' ? name : wordAtCursor();
    if (target) {
      // the word under the cursor is only used when it really is a type
      const ok = await panel.show(target).catch(() => false);
      if (ok) return;
    }
    const hit = await pick(
      'Show type or bean',
      ['type', 'enum', 'relation', 'bean', 'bean-enum'],
      undefined,
    );
    target = hit?.name;
    if (target) await panel.show(target);
  });

  register('sapcommerce.index.info', async () => {
    const info = await languages.request<
      {
        hybrisDir: string;
        extensions: number;
        itemTypes: number;
        enumTypes: number;
        relations: number;
      }[]
    >('sapcommerce/index/info', {});
    if (info.length === 0) {
      void vscode.window.showInformationMessage(
        'No SAP Commerce project is indexed (looked for bin/platform/extensions.xml in the workspace).',
      );
      return;
    }
    void vscode.window.showInformationMessage(
      info
        .map(
          (p) =>
            `${p.hybrisDir}: ${p.extensions} extensions, ${p.itemTypes} item types, ${p.enumTypes} enums, ${p.relations} relations`,
        )
        .join('\n'),
    );
  });
}
