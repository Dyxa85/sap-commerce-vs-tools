import type { LineIndex, Span } from '../shared/line-index.js';
import type { Problem } from '../shared/problem.js';

export type TokenKind =
  | 'keyword'
  | 'ident'
  | 'string'
  | 'number'
  | 'param'
  | 'comment'
  | 'line-comment'
  | 'punct'
  | 'lbrace'
  | 'rbrace';

export interface Token {
  kind: TokenKind;
  text: string;
  span: Span;
}

export interface Scope {
  id: number;
  kind: 'root' | 'subselect';
  parent?: Scope;
  span: Span;
  typeRefs: TypeRef[];
  /** First SELECT keyword of this scope. */
  selectSpan?: Span;
  hasFrom: boolean;
}

/** `Language AS l` inside a FROM brace. */
export interface TypeRef {
  typeName: string;
  typeSpan: Span;
  alias?: string;
  aliasSpan?: Span;
  excludeSubtypes: boolean;
  scope: Scope;
}

/** `{l:name[en]:o}` or `{pk}`. */
export interface FieldRef {
  /** Including the braces. */
  span: Span;
  alias?: string;
  aliasSpan?: Span;
  attribute: string;
  attributeSpan: Span;
  lang?: string;
  suffixes: string[];
  scope: Scope;
  /** False when the content did not look like a field expression. */
  valid: boolean;
}

export interface ParamUse {
  /** Name without the `?`; empty for a bare `?`. */
  name: string;
  span: Span;
}

export interface FlexDocument {
  text: string;
  lines: LineIndex;
  tokens: Token[];
  scopes: Scope[];
  typeRefs: TypeRef[];
  fieldRefs: FieldRef[];
  params: ParamUse[];
  /** Spans of FROM braces (including braces), for editor context detection. */
  fromBlocks: Span[];
  /** Spans of `{{ … }}` subselects. */
  subselects: Span[];
  problems: Problem[];
}
