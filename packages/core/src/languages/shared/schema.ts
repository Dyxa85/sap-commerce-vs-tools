/**
 * What the language features (ImpEx, FlexibleSearch) need to know about the item type system. Implemented by the type-system index
 * (WP7); until then no schema is available and type-aware features stay silent.
 */
export interface SchemaAttribute {
  name: string;
  /** Java or item type of the attribute, e.g. `java.lang.String`, `Catalog`. */
  type?: string;
  doc?: string;
  unique?: boolean;
  mandatory?: boolean;
  localized?: boolean;
  /** Declared by this type (false: inherited). */
  own?: boolean;
}

/** A place in a file (0-based line / UTF-16 character), e.g. the definition of a type in an items.xml. */
export interface SchemaLocation {
  file: string;
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface TypeSchema {
  typeNames(): readonly string[];
  hasType(name: string): boolean;
  /** All attributes including inherited ones; undefined for unknown types. */
  attributes(typeName: string): readonly SchemaAttribute[] | undefined;
  /** Allowed values for enum-typed attributes. */
  enumValues?(typeName: string, attribute: string): readonly string[] | undefined;
  typeDoc?(typeName: string): string | undefined;
  /**
   * True when the type's declaration (or a parent's) is not part of the loaded files, e.g. a type added to by an
   * extension whose base lives in a packaged module. Attribute lists are then incomplete, so "unknown attribute"
   * must not be reported.
   */
  isIncomplete?(typeName: string): boolean;
  /** Where a type (or one of its attributes) is defined. Used for go-to-definition. */
  locate?(typeName: string, attribute?: string): SchemaLocation | undefined;
  /** True for abstract item types (cannot be instantiated). */
  isAbstract?(typeName: string): boolean;
  /** The item/enum type an attribute value refers to (unwraps collections and localisation). */
  referencedType?(typeString: string): string | undefined;
}
