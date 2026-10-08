import { pathToFileURL } from 'node:url';
import {
  TOKEN_MODIFIERS,
  TOKEN_TYPES,
  type CompletionEntry,
  type CompletionKind,
  type LineIndex,
  type Problem,
  type SchemaLocation,
  type SeverityOverride,
  type Span,
} from '@sapcommerce-vstools/core';
import {
  CompletionItemKind,
  Location,
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticTag,
  InsertTextFormat,
  MarkupKind,
  Range,
  TextEdit,
  type CodeAction,
  type CompletionItem,
  type Diagnostic as DiagnosticType,
  type DocumentHighlight,
  type DocumentSymbol,
  type FoldingRange,
  type Hover,
  type WorkspaceEdit,
} from 'vscode-languageserver-types';
import type { TextDocument } from 'vscode-languageserver-textdocument';

/** Per-language settings, read from `sapcommerce.<language>.*`. */
export interface LanguageSettings {
  severities: Record<string, SeverityOverride | undefined>;
  format: Record<string, boolean | string | number | undefined>;
}

export const DEFAULT_SETTINGS: LanguageSettings = { severities: {}, format: {} };

export const SEMANTIC_LEGEND = {
  tokenTypes: [...TOKEN_TYPES],
  tokenModifiers: [...TOKEN_MODIFIERS],
};

/** What the server needs from a language implementation. */
export interface LanguageService {
  readonly languageId: string;
  /** Settings section, e.g. `sapcommerce.impex`. */
  readonly section: string;
  forget(uri: string): void;
  diagnostics(document: TextDocument, settings: LanguageSettings): DiagnosticType[];
  completion(document: TextDocument, line: number, character: number): CompletionItem[];
  hover(document: TextDocument, line: number, character: number): Hover | null;
  definition(document: TextDocument, line: number, character: number): Location | Location[] | null;
  references(document: TextDocument, line: number, character: number): Location[];
  highlights(document: TextDocument, line: number, character: number): DocumentHighlight[];
  prepareRename(
    document: TextDocument,
    line: number,
    character: number,
  ): { range: Range; placeholder: string } | null;
  rename(
    document: TextDocument,
    line: number,
    character: number,
    newName: string,
  ): WorkspaceEdit | null;
  symbols(document: TextDocument): DocumentSymbol[];
  folding(document: TextDocument): FoldingRange[];
  semanticTokens(document: TextDocument): { data: number[] };
  format(document: TextDocument, settings: LanguageSettings, range?: Range): TextEdit[];
  codeActions(
    document: TextDocument,
    range: Range,
    diagnostics: readonly DiagnosticType[],
    settings: LanguageSettings,
  ): CodeAction[];
}

export function toRange(lines: LineIndex, span: Span): Range {
  const r = lines.rangeOf(span);
  return Range.create(r.start.line, r.start.character, r.end.line, r.end.character);
}

const SEVERITY = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
} as const;

export function toDiagnostic(lines: LineIndex, problem: Problem, source: string): DiagnosticType {
  const diagnostic = Diagnostic.create(
    toRange(lines, problem.span),
    problem.message,
    SEVERITY[problem.severity],
    problem.code,
    source,
  );
  if (problem.unnecessary) diagnostic.tags = [DiagnosticTag.Unnecessary];
  return diagnostic;
}

const COMPLETION_KIND: Record<CompletionKind, CompletionItemKind> = {
  keyword: CompletionItemKind.Keyword,
  snippet: CompletionItemKind.Snippet,
  macro: CompletionItemKind.Variable,
  type: CompletionItemKind.Class,
  property: CompletionItemKind.Property,
  modifier: CompletionItemKind.Property,
  value: CompletionItemKind.Value,
  enumMember: CompletionItemKind.EnumMember,
};

export function toCompletionItem(lines: LineIndex, entry: CompletionEntry): CompletionItem {
  const item: CompletionItem = {
    label: entry.label,
    kind: COMPLETION_KIND[entry.kind],
    detail: entry.detail,
    sortText: entry.sortText,
    textEdit: TextEdit.replace(toRange(lines, entry.replace), entry.insertText ?? entry.label),
    filterText: entry.label,
  };
  if (entry.documentation)
    item.documentation = { kind: MarkupKind.Markdown, value: entry.documentation };
  if (entry.snippet) item.insertTextFormat = InsertTextFormat.Snippet;
  return item;
}

/** A location in some other file (e.g. an items.xml) as an LSP location. */
export function toLocation(location: SchemaLocation): Location {
  return Location.create(
    pathToFileURL(location.file).href,
    Range.create(
      location.start.line,
      location.start.character,
      location.end.line,
      location.end.character,
    ),
  );
}
