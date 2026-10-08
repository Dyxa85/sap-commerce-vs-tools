import {
  analyzeItems,
  completeItems,
  definitionItems,
  fixesForItems,
  foldingXml,
  hoverItems,
  openItemsDocument,
  outlineItems,
  parseItemsXml,
  typeReferenceAt,
  usagesOfType,
  xml,
  type ItemsSymbol,
  type TypeSystem,
  type ExtensionCategory,
} from '@sapcommerce-vstools/core';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { Location } from 'vscode-languageserver-types';
import {
  CodeActionKind,
  FoldingRangeKind,
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
import { basename } from 'node:path';
import { uriToPath } from './project-index.js';

export const ITEMS_SOURCE = 'sapcommerce-items';

const KIND: Record<ItemsSymbol['kind'], SymbolKind> = {
  itemtype: SymbolKind.Class,
  enum: SymbolKind.Enum,
  relation: SymbolKind.Interface,
  collection: SymbolKind.Array,
  map: SymbolKind.Object,
  attribute: SymbolKind.Property,
  value: SymbolKind.EnumMember,
  group: SymbolKind.Namespace,
};

/** Language features for `*-items.xml` (type system definitions). */
export class ItemsXmlService implements LanguageService {
  readonly languageId = 'xml:items';
  readonly section = 'sapcommerce.items';
  private readonly cache = new Map<string, { version: number; xml: xml.XmlDocument }>();

  constructor(
    private readonly typeSystem: (uri: string) => TypeSystem | undefined,
    private readonly category: (uri: string) => ExtensionCategory | undefined = () => undefined,
  ) {}

  private parse(document: TextDocument): xml.XmlDocument {
    const cached = this.cache.get(document.uri);
    if (cached && cached.version === document.version) return cached.xml;
    const parsed = xml.parseXml(document.getText());
    this.cache.set(document.uri, { version: document.version, xml: parsed });
    return parsed;
  }

  forget(uri: string): void {
    this.cache.delete(uri);
  }

  private items(document: TextDocument) {
    const ts = this.typeSystem(document.uri);
    return ts ? openItemsDocument(document.getText(), ts) : undefined;
  }

  diagnostics(document: TextDocument, settings: LanguageSettings): DiagnosticType[] {
    const ts = this.typeSystem(document.uri);
    const parsed = this.parse(document);
    if (!ts) {
      // without a type system only the XML syntax can be checked
      return parsed.problems.map((p) =>
        toDiagnostic(
          parsed.lines,
          { span: p.span, severity: 'error', code: 'items.xml.syntax', message: p.message },
          ITEMS_SOURCE,
        ),
      );
    }
    const path = uriToPath(document.uri) ?? document.uri;
    const file = parseItemsXml(
      document.getText(),
      path,
      basename(path).replace(/-items\.xml$/, ''),
    );
    return analyzeItems(file, ts, {
      severities: settings.severities,
      category: this.category(document.uri),
    }).map((p) => toDiagnostic(parsed.lines, p, ITEMS_SOURCE));
  }

  completion(document: TextDocument, line: number, character: number) {
    const doc = this.items(document);
    if (!doc) return [];
    const lines = doc.xml.lines;
    return completeItems(doc, lines.offsetAt({ line, character })).map((e) =>
      toCompletionItem(lines, e),
    );
  }

  hover(document: TextDocument, line: number, character: number): Hover | null {
    const doc = this.items(document);
    if (!doc) return null;
    const info = hoverItems(doc, doc.xml.lines.offsetAt({ line, character }));
    return info
      ? {
          contents: { kind: MarkupKind.Markdown, value: info.markdown },
          range: toRange(doc.xml.lines, info.span),
        }
      : null;
  }

  definition(document: TextDocument, line: number, character: number): Location | null {
    const doc = this.items(document);
    const location = doc
      ? definitionItems(doc, doc.xml.lines.offsetAt({ line, character }))
      : undefined;
    return location ? toLocation(location) : null;
  }

  references(document: TextDocument, line: number, character: number): Location[] {
    const doc = this.items(document);
    if (!doc) return [];
    const reference = typeReferenceAt(doc, doc.xml.lines.offsetAt({ line, character }));
    if (!reference) return [];
    return usagesOfType(doc.ts, reference.name).map(toLocation);
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
    const parsed = this.parse(document);
    const convert = (s: ItemsSymbol): DocumentSymbol => ({
      name: s.name,
      detail: s.detail,
      kind: KIND[s.kind],
      range: toRange(parsed.lines, s.span),
      selectionRange: toRange(parsed.lines, s.selection),
      children: s.children.map(convert),
    });
    return outlineItems(parsed).map(convert);
  }

  folding(document: TextDocument): FoldingRange[] {
    const parsed = this.parse(document);
    return foldingXml(parsed).map((span) => {
      const r = toRange(parsed.lines, span);
      return {
        startLine: r.start.line,
        endLine: r.end.line,
        kind: parsed.text.startsWith('<!--', span.start)
          ? FoldingRangeKind.Comment
          : FoldingRangeKind.Region,
      };
    });
  }

  semanticTokens(): { data: number[] } {
    return { data: [] };
  }

  format(): TextEdit[] {
    return []; // XML formatting is left to the editor / other XML extensions
  }

  codeActions(
    document: TextDocument,
    _range: Range,
    diagnostics: readonly DiagnosticType[],
    settings: LanguageSettings,
  ): CodeAction[] {
    const ts = this.typeSystem(document.uri);
    if (!ts) return [];
    const parsed = this.parse(document);
    const path = uriToPath(document.uri) ?? document.uri;
    const file = parseItemsXml(
      document.getText(),
      path,
      basename(path).replace(/-items\.xml$/, ''),
    );
    const problems = analyzeItems(file, ts, {
      severities: settings.severities,
      category: this.category(document.uri),
    });
    const actions: CodeAction[] = [];
    for (const diagnostic of diagnostics) {
      if (diagnostic.source !== ITEMS_SOURCE || typeof diagnostic.code !== 'string') continue;
      const problem = problems.find(
        (p) =>
          p.code === diagnostic.code &&
          p.span.start === parsed.lines.offsetAt(diagnostic.range.start) &&
          p.span.end === parsed.lines.offsetAt(diagnostic.range.end),
      );
      if (!problem) continue;
      for (const fix of fixesForItems(document.getText(), problem)) {
        actions.push({
          title: fix.title,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: fix.preferred,
          edit: {
            changes: {
              [document.uri]: fix.edits.map((e) =>
                TextEdit.replace(toRange(parsed.lines, e.span), e.newText),
              ),
            },
          },
        });
      }
    }
    return actions;
  }
}
