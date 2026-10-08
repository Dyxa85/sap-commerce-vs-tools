import type { Span } from '../languages/shared/line-index.js';

export interface BeanSource {
  file: string;
  extension: string;
  span: Span;
  nameSpan: Span;
}

export interface BeanProperty {
  name: string;
  /** As written, e.g. `java.util.List<de.hybris.Foo>`. */
  type: string;
  typeSpan: Span;
  equals?: boolean;
  deprecated?: string;
  description?: string;
  source: BeanSource;
}

export interface BeanDef {
  /** Fully qualified class name without type parameters. */
  className: string;
  /** Type parameters, e.g. `['DECISION', 'FIELD_ERROR']`. */
  typeParameters: string[];
  extends?: string;
  extendsSpan?: Span;
  abstract: boolean;
  template?: string;
  deprecated?: string;
  description?: string;
  properties: BeanProperty[];
  hints: string[];
  source: BeanSource;
}

export interface BeanEnumDef {
  className: string;
  values: { code: string; span: Span }[];
  deprecated?: string;
  description?: string;
  source: BeanSource;
}

export interface BeansFile {
  file: string;
  extension: string;
  text: string;
  beans: BeanDef[];
  enums: BeanEnumDef[];
  imports: { type: string; span: Span }[];
  problems: { span: Span; message: string }[];
}
