import * as vscode from 'vscode';
import type { LanguageServerController } from '../language/client.js';
import type { ProjectService } from '../project/service.js';
import type { DiagramPage } from '../ui/diagram-html.js';
import type { DiagramPanel } from '../ui/diagram-panel.js';

/** Mirrors `DiagramResult` of the language server. */
interface Diagram {
  svg: string;
  nodeCount: number;
  truncated?: boolean;
  hidden?: number;
  targets: Record<
    string,
    { uri?: string; position?: { line: number; character: number }; start?: number; end?: number }
  >;
}

type ModuleScope =
  | { kind: 'custom' }
  | { kind: 'all' }
  | { kind: 'dependencies'; extension: string; depth?: number }
  | { kind: 'dependents'; extension: string; depth?: number };

const MODULE_LEGEND = [
  { kind: 'custom', label: 'custom' },
  { kind: 'platform', label: 'platform' },
  { kind: 'ext', label: 'extension' },
];

function isProcessDocument(document: vscode.TextDocument): boolean {
  return (
    document.languageId === 'xml' &&
    (/-process\.xml$/.test(document.fileName) ||
      /[\\/]processes[\\/][^\\/]+\.xml$/.test(document.fileName))
  );
}

export function registerDiagramCommands(
  context: vscode.ExtensionContext,
  languages: LanguageServerController,
  project: ProjectService,
  panel: DiagramPanel,
): void {
  const register = (id: string, fn: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  };

  const activeUri = (): string | undefined =>
    vscode.window.activeTextEditor?.document.uri.toString();

  async function openTarget(target: Diagram['targets'][string] | undefined): Promise<void> {
    if (!target?.uri) return;
    const uri = vscode.Uri.parse(target.uri);
    if (uri.scheme !== 'file') return;
    const p = target.position;
    const selection = p ? new vscode.Range(p.line, p.character, p.line, p.character) : undefined;
    await vscode.window.showTextDocument(uri, { selection, preview: true });
  }

  // ---- type diagram
  async function showType(name: string): Promise<boolean> {
    const result = await languages.request<Diagram | null>('sapcommerce/graph/type', {
      name,
      uri: activeUri(),
      subtypeDepth: 1,
      references: true,
    });
    if (!result) return false;
    const page: DiagramPage = {
      title: `Type diagram: ${name}`,
      subtitle: `${result.nodeCount} types${result.truncated ? ' (cut at the size limit)' : ''}`,
      svg: result.svg,
      legend: [
        { kind: 'focus', label: 'this type' },
        { kind: 'abstract', label: 'abstract' },
        { kind: 'enum', label: 'enum' },
        { kind: 'relation', label: 'relation' },
      ],
    };
    panel.show(page, {
      onNode: async (id) => {
        if (id === name) return openTarget(result.targets[id]);
        await showType(id);
      },
    });
    return true;
  }

  register('sapcommerce.diagram.type', async (name?: string) => {
    let target = typeof name === 'string' ? name : undefined;
    if (!target) {
      const editor = vscode.window.activeTextEditor;
      const range = editor?.document.getWordRangeAtPosition(
        editor.selection.active,
        /[A-Za-z_]\w*/,
      );
      target = await vscode.window.showInputBox({
        title: 'Type diagram',
        prompt: 'Item type code, e.g. Product',
        value: range ? editor?.document.getText(range) : '',
      });
    }
    if (!target) return;
    if (!(await showType(target.trim()).catch(() => false))) {
      void vscode.window.showWarningMessage(
        `"${target}" is not an item type of the indexed project.`,
      );
    }
  });

  // ---- module diagram
  async function showModules(scope: ModuleScope): Promise<void> {
    const result = await languages.request<Diagram | null>('sapcommerce/graph/modules', {
      scope,
      uri: activeUri(),
    });
    if (!result) {
      void vscode.window.showWarningMessage('No SAP Commerce project was found in this workspace.');
      return;
    }
    const what =
      scope.kind === 'custom'
        ? 'custom extensions and what they use'
        : scope.kind === 'all'
          ? 'all loaded extensions'
          : scope.kind === 'dependencies'
            ? `dependencies of ${scope.extension}`
            : `dependents of ${scope.extension}`;
    panel.show(
      {
        title: 'Extension dependencies',
        subtitle: `${what} · ${result.nodeCount} extensions${result.truncated ? ' (cut at the size limit)' : ''}`,
        svg: result.svg,
        legend: MODULE_LEGEND,
      },
      { onNode: (id) => openTarget(result.targets[id]) },
    );
  }

  register('sapcommerce.diagram.modules', async (scope?: ModuleScope) => {
    if (scope && typeof scope === 'object') return showModules(scope);
    const loaded = project.projects.flatMap((p) => p.loaded.map((e) => e.name)).sort();
    if (loaded.length === 0) {
      void vscode.window.showWarningMessage('No SAP Commerce project was found in this workspace.');
      return;
    }
    type ScopeKind = ModuleScope['kind'];
    const choice = await vscode.window.showQuickPick<vscode.QuickPickItem & { scope: ScopeKind }>(
      [
        {
          label: 'Custom extensions',
          description: 'and the extensions they require',
          scope: 'custom',
        },
        { label: 'Dependencies of an extension…', scope: 'dependencies' },
        { label: 'Dependents of an extension…', scope: 'dependents' },
        { label: 'All loaded extensions', description: 'large', scope: 'all' },
      ],
      { title: 'Extension dependency diagram' },
    );
    if (!choice) return;
    if (choice.scope === 'custom' || choice.scope === 'all')
      return showModules({ kind: choice.scope });
    const extension = await vscode.window.showQuickPick(loaded, { title: choice.label });
    if (!extension) return;
    return showModules({ kind: choice.scope, extension });
  });

  // ---- business process diagram
  let liveProcess: string | undefined;

  async function showProcess(document: vscode.TextDocument): Promise<void> {
    const result = await languages.request<Diagram | null>('sapcommerce/graph/process', {
      text: document.getText(),
    });
    if (!result) {
      void vscode.window.showWarningMessage('This file is not a business process definition.');
      return;
    }
    liveProcess = document.uri.toString();
    panel.show(
      {
        title: `Process: ${vscode.workspace.asRelativePath(document.uri)}`,
        subtitle: `${result.nodeCount} nodes`,
        svg: result.svg,
        legend: [
          { kind: 'start', label: 'start' },
          { kind: 'action', label: 'action' },
          { kind: 'wait', label: 'wait' },
          { kind: 'split', label: 'split / join' },
          { kind: 'end-succeeded', label: 'end' },
        ],
      },
      {
        onNode: async (id) => {
          const range = result.targets[id];
          if (range?.start === undefined) return;
          const shown = await vscode.window.showTextDocument(document, { preview: true });
          const from = document.positionAt(range.start);
          const to = document.positionAt(range.end ?? range.start);
          shown.selection = new vscode.Selection(from, to);
          shown.revealRange(
            new vscode.Range(from, to),
            vscode.TextEditorRevealType.InCenterIfOutsideViewport,
          );
        },
      },
    );
  }

  register('sapcommerce.diagram.process', async () => {
    const document = vscode.window.activeTextEditor?.document;
    if (!document || !isProcessDocument(document)) {
      void vscode.window.showInformationMessage(
        'Open a business process definition (*-process.xml) first.',
      );
      return;
    }
    await showProcess(document);
  });

  // keep an open process diagram in sync with the file
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (panel.current && liveProcess === document.uri.toString()) void showProcess(document);
    }),
  );
}
