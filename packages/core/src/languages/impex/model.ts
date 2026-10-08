import type { LineIndex, Span } from '../shared/line-index.js';
import type { Problem } from '../shared/problem.js';

export type ImpexMode = 'INSERT' | 'UPDATE' | 'INSERT_UPDATE' | 'REMOVE';

export interface Modifier {
  name: string;
  nameSpan: Span;
  /** Value without surrounding quotes. */
  value?: string;
  valueSpan?: Span;
  span: Span;
}

/** One entry of a reference pattern, e.g. `catalog(id)` in `catalogVersion(catalog(id),version)`. */
export interface RefNode {
  name: string;
  span: Span;
  modifiers: Modifier[];
  children: RefNode[];
}

export type ColumnKind = 'attribute' | 'dynamic' | 'docid' | 'macro' | 'empty' | 'invalid';

export interface Column {
  /** Segment index in the header line; equals the index of the matching cell in value rows. */
  index: number;
  span: Span;
  kind: ColumnKind;
  /** Attribute qualifier (without the `@`/`&` prefix for dynamic/docid columns). */
  name: string;
  nameSpan: Span;
  refs: RefNode[];
  refsSpan?: Span;
  modifiers: Modifier[];
  modifiersSpan?: Span;
  /** Value of the `lang` modifier when it is a literal. */
  lang?: string;
}

export interface Header {
  kind: 'header';
  span: Span;
  /** Mode as written. */
  mode: string;
  modeSpan: Span;
  canonicalMode?: ImpexMode;
  typeName: string;
  typeSpan?: Span;
  typeModifiers: Modifier[];
  typeModifiersSpan?: Span;
  columns: Column[];
  /** False for headers the importer would not recognise (unknown mode, missing type). */
  valid: boolean;
  rows: DataRow[];
}

export interface Cell {
  index: number;
  /** Including surrounding whitespace. */
  span: Span;
  raw: string;
  /** Trimmed, unquoted, `""` unescaped. */
  value: string;
  valueSpan: Span;
  quoted: boolean;
}

export interface DataRow {
  kind: 'row';
  span: Span;
  cells: Cell[];
  header?: Header;
  userRights: boolean;
  multiline: boolean;
}

export interface MacroDef {
  kind: 'macro';
  span: Span;
  name: string;
  nameSpan: Span;
  value: string;
  valueSpan: Span;
}

export interface MacroUse {
  /** Name as written, without the `$`. */
  name: string;
  span: Span;
}

export interface CommentStatement {
  kind: 'comment';
  span: Span;
}

export interface ScriptStatement {
  kind: 'script';
  span: Span;
  text: string;
}

export interface UserRightsMarker {
  kind: 'userrights-start' | 'userrights-end';
  span: Span;
}

export type Statement =
  Header | DataRow | MacroDef | CommentStatement | ScriptStatement | UserRightsMarker;

export interface ImpexDocument {
  text: string;
  lines: LineIndex;
  statements: Statement[];
  headers: Header[];
  macros: MacroDef[];
  macroUses: MacroUse[];
  /** Syntax-level problems found while parsing. Semantic problems come from `analyze`. */
  problems: Problem[];
}
