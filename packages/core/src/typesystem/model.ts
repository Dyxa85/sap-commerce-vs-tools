import type { Span } from '../languages/shared/line-index.js';

/** Where a definition comes from; used for navigation. */
export interface SourceRef {
  file: string;
  extension: string;
  /** The whole element. */
  span: Span;
  /** The identifying name (code / qualifier / class). */
  nameSpan: Span;
}

export interface AttributeDef {
  qualifier: string;
  /** As written, e.g. `localized:java.lang.String`. */
  type: string;
  typeSpan: Span;
  localized: boolean;
  /** Type without `localized:`. */
  baseType: string;
  redeclare: boolean;
  persistence?: string;
  attributeHandler?: string;
  read?: boolean;
  write?: boolean;
  search?: boolean;
  optional?: boolean;
  unique?: boolean;
  initial?: boolean;
  partOf?: boolean;
  encrypted?: boolean;
  defaultValue?: string;
  description?: string;
  /** Set for attributes that exist because of a relation. */
  relation?: string;
  source: SourceRef;
}

export interface DeploymentDef {
  table?: string;
  typecode?: number;
  span: Span;
}

export interface IndexDef {
  name: string;
  unique: boolean;
  keys: string[];
}

export interface ItemTypeDef {
  code: string;
  extends?: string;
  extendsSpan?: Span;
  abstract: boolean;
  autocreate: boolean;
  generate: boolean;
  jaloclass?: string;
  deployment?: DeploymentDef;
  description?: string;
  attributes: AttributeDef[];
  indexes: IndexDef[];
  source: SourceRef;
}

export interface EnumValueDef {
  code: string;
  description?: string;
  source: SourceRef;
}

export interface EnumTypeDef {
  code: string;
  dynamic: boolean;
  values: EnumValueDef[];
  description?: string;
  source: SourceRef;
}

export interface CollectionTypeDef {
  code: string;
  elementType: string;
  elementTypeSpan: Span;
  kind: 'collection' | 'list' | 'set';
  source: SourceRef;
}

export interface MapTypeDef {
  code: string;
  argumentType: string;
  returnType: string;
  source: SourceRef;
}

export interface AtomicTypeDef {
  className: string;
  extends?: string;
  source: SourceRef;
}

export interface RelationEndDef {
  type: string;
  typeSpan: Span;
  qualifier?: string;
  qualifierSpan?: Span;
  cardinality: 'one' | 'many';
  collectionType?: 'collection' | 'list' | 'set';
  ordered: boolean;
  navigable: boolean;
  optional?: boolean;
  partOf?: boolean;
}

export interface RelationDef {
  code: string;
  localized: boolean;
  sourceElement: RelationEndDef;
  targetElement: RelationEndDef;
  source: SourceRef;
}

export interface ItemsProblem {
  span: Span;
  message: string;
}

/** The parsed content of one `*-items.xml`. */
export interface ItemsFile {
  file: string;
  extension: string;
  text: string;
  itemTypes: ItemTypeDef[];
  enumTypes: EnumTypeDef[];
  collectionTypes: CollectionTypeDef[];
  mapTypes: MapTypeDef[];
  atomicTypes: AtomicTypeDef[];
  relations: RelationDef[];
  /** XML-level problems. */
  problems: ItemsProblem[];
}
