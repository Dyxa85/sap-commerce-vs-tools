import { flexsearch as fs, type SchemaLocation, type TypeSchema } from '@sapcommerce-vstools/core';
import { encodeSemanticTokens } from '@sapcommerce-vstools/core';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CodeActionKind,
  DocumentHighlight,
  DocumentHighlightKind,
  FoldingRangeKind,
  Location,
  MarkupKind,
  SymbolKind,
  TextEdit,
  type CodeAction,
  type Diagnostic as DiagnosticType,
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

export const FLEX_SOURCE = 'sapcommerce-flexsearch';

export class FlexSearchLanguageService implements LanguageService {
  readonly languageId = 'flexibleSearch';
  readonly section = 'sapcommerce.flexsearch';
  private readonly cache = new Map<string, { version: number; doc: fs.FlexDocument }>();

  constructor(private readonly schema: (uri: string) => TypeSchema | undefined = () => undefined) {}

  parse(document: TextDocument): fs.FlexDocument {
    const cached = this.cache.get(document.uri);
    if (cached && cached.version === document.version) return cached.doc;
    const doc = fs.parseFlexSearch(document.getText());
    this.cache.set(document.uri, { version: document.version, doc });
    return doc;
  }

  forget(uri: string): void {
    this.cache.delete(uri);
  }

  diagnostics(document: TextDocument, settings: LanguageSettings): DiagnosticType[] {
    const doc = this.parse(document);
    return fs
      .analyzeFlexSearch(doc, {
        severities: settings.severities,
        schema: this.schema(document.uri),
      })
      .map((p) => toDiagnostic(doc.lines, p, FLEX_SOURCE));
  }

  completion(document: TextDocument, line: number, character: number) {
    const doc = this.parse(document);
    return fs
      .completeFlex(doc, doc.lines.offsetAt({ line, character }), this.schema(document.uri))
      .map((e) => toCompletionItem(doc.lines, e));
  }

  hover(document: TextDocument, line: number, character: number): Hover | null {
    const doc = this.parse(document);
    const info = fs.hoverFlex(
      doc,
      doc.lines.offsetAt({ line, character }),
      this.schema(document.uri),
    );
    return info
      ? {
          contents: { kind: MarkupKind.Markdown, value: info.markdown },
          range: toRange(doc.lines, info.span),
        }
      : null;
  }

  definition(document: TextDocument, line: number, character: number): Location | null {
    const doc = this.parse(document);
    const offset = doc.lines.offsetAt({ line, character });
    const alias = fs.aliasRefAt(doc, offset);
    if (alias?.aliasSpan) return Location.create(document.uri, toRange(doc.lines, alias.aliasSpan));
    const schema = this.schema(document.uri);
    const target = fs.targetAt(doc, offset);
    if (!schema?.locate || !target) return null;
    let location: SchemaLocation | undefined;
    if (target.kind === 'type') location = schema.locate(target.ref.typeName);
    else if (target.kind === 'attribute' && target.ref)
      location = schema.locate(target.ref.typeName, target.field.attribute);
    return location ? toLocation(location) : null;
  }

  references(document: TextDocument, line: number, character: number): Location[] {
    const doc = this.parse(document);
    const ref = fs.aliasRefAt(doc, doc.lines.offsetAt({ line, character }));
    return ref
      ? fs
          .aliasOccurrences(doc, ref)
          .map((s) => Location.create(document.uri, toRange(doc.lines, s)))
      : [];
  }

  highlights(document: TextDocument, line: number, character: number): DocumentHighlight[] {
    const doc = this.parse(document);
    const ref = fs.aliasRefAt(doc, doc.lines.offsetAt({ line, character }));
    if (!ref) return [];
    return fs
      .aliasOccurrences(doc, ref)
      .map((s) =>
        DocumentHighlight.create(
          toRange(doc.lines, s),
          s === ref.aliasSpan ? DocumentHighlightKind.Write : DocumentHighlightKind.Read,
        ),
      );
  }

  prepareRename(
    document: TextDocument,
    line: number,
    character: number,
  ): { range: Range; placeholder: string } | null {
    const doc = this.parse(document);
    const offset = doc.lines.offsetAt({ line, character });
    const ref = fs.aliasRefAt(doc, offset);
    const hit = ref
      ? fs.aliasOccurrences(doc, ref).find((s) => offset >= s.start && offset <= s.end)
      : undefined;
    return ref?.alias && hit ? { range: toRange(doc.lines, hit), placeholder: ref.alias } : null;
  }

  rename(
    document: TextDocument,
    line: number,
    character: number,
    newName: string,
  ): WorkspaceEdit | null {
    if (!/^[A-Za-z_$][\w$]*$/.test(newName)) return null;
    const doc = this.parse(document);
    const ref = fs.aliasRefAt(doc, doc.lines.offsetAt({ line, character }));
    if (!ref) return null;
    return {
      changes: {
        [document.uri]: fs
          .aliasOccurrences(doc, ref)
          .map((s) => TextEdit.replace(toRange(doc.lines, s), newName)),
      },
    };
  }

  symbols(document: TextDocument): DocumentSymbol[] {
    const doc = this.parse(document);
    const convert = (s: fs.FlexSymbol): DocumentSymbol => ({
      name: s.name,
      detail: s.detail,
      kind: s.kind === 'query' ? SymbolKind.Class : SymbolKind.Variable,
      range: toRange(doc.lines, s.span),
      selectionRange: toRange(doc.lines, s.selection),
      children: s.children.map(convert),
    });
    return fs.outlineFlex(doc).map(convert);
  }

  folding(document: TextDocument): FoldingRange[] {
    const doc = this.parse(document);
    return fs.foldingFlex(doc).map((f) => {
      const r = toRange(doc.lines, f.span);
      return {
        startLine: r.start.line,
        endLine: r.end.line,
        kind: f.kind === 'comment' ? FoldingRangeKind.Comment : FoldingRangeKind.Region,
      };
    });
  }

  semanticTokens(document: TextDocument): { data: number[] } {
    return { data: encodeSemanticTokens(fs.flexSemanticTokens(this.parse(document))) };
  }

  format(document: TextDocument, settings: LanguageSettings): TextEdit[] {
    const doc = this.parse(document);
    const formatted = fs.formatFlexSearch(doc, {
      uppercaseKeywords:
        typeof settings.format.uppercaseKeywords === 'boolean'
          ? settings.format.uppercaseKeywords
          : undefined,
      breakLogicalOperators:
        typeof settings.format.breakLogicalOperators === 'boolean'
          ? settings.format.breakLogicalOperators
          : undefined,
    });
    if (formatted === undefined || formatted === doc.text) return [];
    return [TextEdit.replace(toRange(doc.lines, { start: 0, end: doc.text.length }), formatted)];
  }

  codeActions(
    document: TextDocument,
    _range: Range,
    diagnostics: readonly DiagnosticType[],
    settings: LanguageSettings,
  ): CodeAction[] {
    const doc = this.parse(document);
    const problems = fs.analyzeFlexSearch(doc, {
      severities: settings.severities,
      schema: this.schema(document.uri),
    });
    const actions: CodeAction[] = [];
    for (const diagnostic of diagnostics) {
      if (diagnostic.source !== FLEX_SOURCE || typeof diagnostic.code !== 'string') continue;
      const problem = problems.find(
        (p) =>
          p.code === diagnostic.code &&
          p.span.start === doc.lines.offsetAt(diagnostic.range.start) &&
          p.span.end === doc.lines.offsetAt(diagnostic.range.end),
      );
      if (!problem) continue;
      for (const fix of fs.flexFixesFor(doc, problem)) {
        actions.push({
          title: fix.title,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: fix.preferred,
          edit: {
            changes: {
              [document.uri]: fix.edits.map((e) =>
                TextEdit.replace(toRange(doc.lines, e.span), e.newText),
              ),
            },
          },
        });
      }
    }
    return actions;
  }
}
