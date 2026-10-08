import type { spring } from '@sapcommerce-vstools/core';
import { foldingXml, processes, type ExtensionCategory } from '@sapcommerce-vstools/core';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CodeActionKind,
  FoldingRangeKind,
  Location,
  MarkupKind,
  SymbolKind,
  TextEdit,
  type CodeAction,
  type Diagnostic as DiagnosticType,
  type DocumentHighlight,
  type DocumentSymbol,
  type FoldingRange,
  type Hover,
  type Range,
  type WorkspaceEdit,
} from 'vscode-languageserver-types';
import {
  toCompletionItem,
  toDiagnostic,
  toLocation,
  toRange,
  type LanguageService,
  type LanguageSettings,
} from './lsp-util.js';

export const PROCESS_SOURCE = 'sapcommerce-process';

/** Whether a document URI is a business process definition by naming convention. */
export function isProcessUri(uri: string): boolean {
  return uri.endsWith('-process.xml') || /\/processes?\/[^/]+\.xml$/.test(uri);
}

/** Language features for business process definitions (`*-process.xml`). */
export class ProcessXmlService implements LanguageService {
  readonly languageId = 'xml:process';
  readonly section = 'sapcommerce.process';
  private readonly cache = new Map<
    string,
    { version: number; def: processes.ProcessDefinition | undefined }
  >();

  constructor(
    private readonly springSystem: (uri: string) => spring.SpringSystem | undefined,
    private readonly category: (uri: string) => ExtensionCategory | undefined = () => undefined,
  ) {}

  private parse(document: TextDocument): processes.ProcessDefinition | undefined {
    const cached = this.cache.get(document.uri);
    if (cached && cached.version === document.version) return cached.def;
    const def = processes.parseProcess(document.getText());
    this.cache.set(document.uri, { version: document.version, def });
    return def;
  }

  forget(uri: string): void {
    this.cache.delete(uri);
  }

  diagnostics(document: TextDocument, settings: LanguageSettings): DiagnosticType[] {
    const def = this.parse(document);
    if (!def) return []; // some other XML in a processes folder
    const system = this.springSystem(document.uri);
    const category = this.category(document.uri);
    const problems = processes.analyzeProcess(def, {
      severities: settings.severities,
      hasBean: system ? (id) => system.has(id) : undefined,
    });
    const sapOwned = category === 'platform' || category === 'modules';
    return problems.map((p) =>
      toDiagnostic(
        def.xml.lines,
        sapOwned && p.severity !== 'hint' && p.code !== 'process.xml.syntax'
          ? { ...p, severity: 'hint' }
          : p,
        PROCESS_SOURCE,
      ),
    );
  }

  completion(document: TextDocument, line: number, character: number) {
    const def = this.parse(document);
    if (!def) return [];
    const ids = this.springSystem(document.uri)?.allIds() ?? [];
    return processes
      .completeProcess(def, def.xml.lines.offsetAt({ line, character }), ids)
      .map((e) => toCompletionItem(def.xml.lines, e));
  }

  hover(document: TextDocument, line: number, character: number): Hover | null {
    const def = this.parse(document);
    if (!def) return null;
    const target = processes.processTargetAt(def, def.xml.lines.offsetAt({ line, character }));
    if (!target) return null;
    let text: string;
    if (target.kind === 'node') {
      const node = def.nodes.find((n) => n.id === target.id);
      text = node
        ? `**${node.id}** – ${node.kind}${node.bean ? `, bean \`${node.bean}\`` : ''}${node.state ? `, ends as ${node.state}` : ''}`
        : `**${target.id}** – no such node`;
    } else {
      const system = this.springSystem(document.uri);
      const cls = system?.classOf(target.id);
      text = cls ? `**${target.id}**\n\n\`${cls}\`` : `**${target.id}** – no Spring bean found`;
    }
    return {
      contents: { kind: MarkupKind.Markdown, value: text },
      range: toRange(def.xml.lines, target.span),
    };
  }

  definition(
    document: TextDocument,
    line: number,
    character: number,
  ): Location | Location[] | null {
    const def = this.parse(document);
    if (!def) return null;
    const target = processes.processTargetAt(def, def.xml.lines.offsetAt({ line, character }));
    if (!target) return null;
    if (target.kind === 'node') {
      const node = def.nodes.find((n) => n.id === target.id);
      return node ? Location.create(document.uri, toRange(def.xml.lines, node.idSpan)) : null;
    }
    const locations = (this.springSystem(document.uri)?.locate(target.id) ?? []).map(toLocation);
    return locations.length > 0 ? locations : null;
  }

  references(): Location[] {
    return [];
  }

  highlights(): DocumentHighlight[] {
    return [];
  }

  prepareRename(): { range: Range; placeholder: string } | null {
    return null;
  }

  rename(): WorkspaceEdit | null {
    return null;
  }

  symbols(document: TextDocument): DocumentSymbol[] {
    const def = this.parse(document);
    if (!def) return [];
    return def.nodes.map((n) => ({
      name: n.id,
      detail: n.bean ?? n.kind,
      kind:
        n.kind === 'end'
          ? SymbolKind.Event
          : n.kind === 'action'
            ? SymbolKind.Method
            : SymbolKind.Object,
      range: toRange(def.xml.lines, n.span),
      selectionRange: toRange(def.xml.lines, n.idSpan),
    }));
  }

  folding(document: TextDocument): FoldingRange[] {
    const def = this.parse(document);
    if (!def) return [];
    return foldingXml(def.xml).map((span) => {
      const r = toRange(def.xml.lines, span);
      return { startLine: r.start.line, endLine: r.end.line, kind: FoldingRangeKind.Region };
    });
  }

  semanticTokens(): { data: number[] } {
    return { data: [] };
  }

  format(): TextEdit[] {
    return [];
  }

  codeActions(
    document: TextDocument,
    _range: Range,
    diagnostics: readonly DiagnosticType[],
    settings: LanguageSettings,
  ): CodeAction[] {
    const def = this.parse(document);
    if (!def) return [];
    const problems = processes.analyzeProcess(def, { severities: settings.severities });
    const actions: CodeAction[] = [];
    for (const diagnostic of diagnostics) {
      if (diagnostic.source !== PROCESS_SOURCE) continue;
      const problem = problems.find(
        (p) =>
          p.code === diagnostic.code &&
          p.span.start === def.xml.lines.offsetAt(diagnostic.range.start) &&
          p.span.end === def.xml.lines.offsetAt(diagnostic.range.end),
      );
      for (const fix of problem ? processes.fixesForProcess(problem) : []) {
        actions.push({
          title: fix.title,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: true,
          edit: {
            changes: {
              [document.uri]: [TextEdit.replace(toRange(def.xml.lines, fix.span), fix.newText)],
            },
          },
        });
      }
    }
    return actions;
  }
}
