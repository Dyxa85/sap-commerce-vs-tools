import {
  analyze,
  complete,
  encodeSemanticTokens,
  fixesFor,
  folding,
  formatImpex,
  hover,
  macroAt,
  macroOccurrences,
  outline,
  parseImpex,
  semanticTokens,
  type FormatOptions,
  type ImpexDocument,
  targetAt,
  type TypeSchema,
  type SchemaLocation,
  type OutlineSymbol,
} from '@sapcommerce-vstools/core';
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

export const SOURCE = 'sapcommerce-impex';

/**
 * Translates the pure ImpEx features of @sapcommerce-vstools/core into LSP types.
 * Stateless apart from a small parse cache keyed by document version.
 */
export class ImpexLanguageService implements LanguageService {
  readonly languageId = 'impex';
  readonly section = 'sapcommerce.impex';
  private readonly cache = new Map<string, { version: number; doc: ImpexDocument }>();

  constructor(private readonly schema: (uri: string) => TypeSchema | undefined = () => undefined) {}

  parse(document: TextDocument): ImpexDocument {
    const cached = this.cache.get(document.uri);
    if (cached && cached.version === document.version) return cached.doc;
    const doc = parseImpex(document.getText());
    this.cache.set(document.uri, { version: document.version, doc });
    return doc;
  }

  forget(uri: string): void {
    this.cache.delete(uri);
  }

  diagnostics(document: TextDocument, settings: LanguageSettings): DiagnosticType[] {
    const doc = this.parse(document);
    return analyze(doc, { severities: settings.severities, schema: this.schema(document.uri) }).map(
      (p) => toDiagnostic(doc.lines, p, SOURCE),
    );
  }

  completion(document: TextDocument, line: number, character: number) {
    const doc = this.parse(document);
    const offset = doc.lines.offsetAt({ line, character });
    return complete(doc, offset, this.schema(document.uri)).map((entry) =>
      toCompletionItem(doc.lines, entry),
    );
  }

  hover(document: TextDocument, line: number, character: number): Hover | null {
    const doc = this.parse(document);
    const info = hover(doc, doc.lines.offsetAt({ line, character }), this.schema(document.uri));
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
    const ref = macroAt(doc, offset);
    if (ref?.def) {
      return Location.create(
        document.uri,
        toRange(doc.lines, { start: ref.def.nameSpan.start - 1, end: ref.def.nameSpan.end }),
      );
    }
    // types and attributes: jump to their definition in an items.xml
    const schema = this.schema(document.uri);
    const target = targetAt(doc, offset);
    if (!schema?.locate || !target) return null;
    let location: SchemaLocation | undefined;
    if (target.kind === 'type') location = schema.locate(target.header.typeName);
    else if (target.kind === 'column')
      location = schema.locate(target.header.typeName, target.column.name);
    return location ? toLocation(location) : null;
  }

  references(document: TextDocument, line: number, character: number): Location[] {
    const doc = this.parse(document);
    const ref = macroAt(doc, doc.lines.offsetAt({ line, character }));
    if (!ref?.def) return [];
    return macroOccurrences(doc, ref.def).map((span) =>
      Location.create(document.uri, toRange(doc.lines, span)),
    );
  }

  highlights(document: TextDocument, line: number, character: number): DocumentHighlight[] {
    const doc = this.parse(document);
    const ref = macroAt(doc, doc.lines.offsetAt({ line, character }));
    if (!ref?.def) return [];
    const definition = ref.def.nameSpan.start - 1;
    return macroOccurrences(doc, ref.def).map((span) =>
      DocumentHighlight.create(
        toRange(doc.lines, span),
        span.start === definition ? DocumentHighlightKind.Write : DocumentHighlightKind.Read,
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
    const ref = macroAt(doc, offset);
    if (!ref?.def) return null;
    const hit = macroOccurrences(doc, ref.def).find((s) => offset >= s.start && offset <= s.end);
    if (!hit) return null;
    return {
      range: toRange(doc.lines, { start: hit.start + 1, end: hit.end }),
      placeholder: ref.def.name,
    };
  }

  rename(
    document: TextDocument,
    line: number,
    character: number,
    newName: string,
  ): WorkspaceEdit | null {
    if (!/^[A-Za-z_][\w.-]*$/.test(newName)) return null;
    const doc = this.parse(document);
    const ref = macroAt(doc, doc.lines.offsetAt({ line, character }));
    if (!ref?.def) return null;
    const edits = macroOccurrences(doc, ref.def).map((span) =>
      TextEdit.replace(toRange(doc.lines, { start: span.start + 1, end: span.end }), newName),
    );
    return { changes: { [document.uri]: edits } };
  }

  symbols(document: TextDocument): DocumentSymbol[] {
    const doc = this.parse(document);
    const convert = (s: OutlineSymbol): DocumentSymbol => ({
      name: s.name,
      detail: s.detail,
      kind:
        s.kind === 'header'
          ? SymbolKind.Class
          : s.kind === 'macro'
            ? SymbolKind.Variable
            : SymbolKind.Property,
      range: toRange(doc.lines, s.span),
      selectionRange: toRange(doc.lines, s.selection),
      children: s.children.map(convert),
    });
    return outline(doc).map(convert);
  }

  folding(document: TextDocument): FoldingRange[] {
    const doc = this.parse(document);
    const ranges: FoldingRange[] = [];
    for (const f of folding(doc)) {
      const r = toRange(doc.lines, f.span);
      if (r.end.line > r.start.line) {
        ranges.push({
          startLine: r.start.line,
          endLine: r.end.line,
          kind: f.kind === 'comment' ? FoldingRangeKind.Comment : FoldingRangeKind.Region,
        });
      }
    }
    return ranges;
  }

  semanticTokens(document: TextDocument): { data: number[] } {
    return { data: encodeSemanticTokens(semanticTokens(this.parse(document))) };
  }

  format(document: TextDocument, settings: LanguageSettings, range?: Range): TextEdit[] {
    const doc = this.parse(document);
    const span = range
      ? { start: doc.lines.offsetAt(range.start), end: doc.lines.offsetAt(range.end) }
      : undefined;
    const options: FormatOptions = {
      alignColumns: boolOrUndefined(settings.format.alignColumns),
      alignTypeColumn: boolOrUndefined(settings.format.alignTypeColumn),
      trimTrailingWhitespace: boolOrUndefined(settings.format.trimTrailingWhitespace),
    };
    return formatImpex(doc, options, span).map((e) =>
      TextEdit.replace(toRange(doc.lines, e.span), e.newText),
    );
  }

  codeActions(
    document: TextDocument,
    _range: Range,
    diagnostics: readonly DiagnosticType[],
    settings: LanguageSettings,
  ): CodeAction[] {
    const doc = this.parse(document);
    const problems = analyze(doc, {
      severities: settings.severities,
      schema: this.schema(document.uri),
    });
    const actions: CodeAction[] = [];
    for (const diagnostic of diagnostics) {
      if (diagnostic.source !== SOURCE || typeof diagnostic.code !== 'string') continue;
      const problem = problems.find(
        (p) =>
          p.code === diagnostic.code &&
          p.span.start === doc.lines.offsetAt(diagnostic.range.start) &&
          p.span.end === doc.lines.offsetAt(diagnostic.range.end),
      );
      if (!problem) continue;
      for (const fix of fixesFor(doc, problem)) {
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

function boolOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
