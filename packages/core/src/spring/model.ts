import type { Span } from '../languages/shared/line-index.js';

export type RefKind = 'ref' | 'parent' | 'depends-on' | 'factory-bean' | 'alias-target' | 'lookup';

/** A reference to another bean by id or alias. */
export interface SpringRef {
  target: string;
  span: Span;
  kind: RefKind;
}

export interface SpringBean {
  /** Bean id; undefined for anonymous beans. */
  id?: string;
  idSpan?: Span;
  names: string[];
  className?: string;
  classSpan?: Span;
  parent?: string;
  scope?: string;
  abstract: boolean;
  /** Element name without namespace prefix (`bean`, `list`, `map`, …). */
  element: string;
  refs: SpringRef[];
  file: string;
  extension: string;
  span: Span;
}

export interface SpringAlias {
  /** The bean the alias points to. */
  name: string;
  nameSpan: Span;
  alias: string;
  aliasSpan: Span;
  file: string;
  extension: string;
}

export interface SpringFile {
  file: string;
  extension: string;
  text: string;
  beans: SpringBean[];
  aliases: SpringAlias[];
  imports: { resource: string; span: Span }[];
  componentScans: { basePackage: string; span: Span }[];
  problems: { span: Span; message: string }[];
}
