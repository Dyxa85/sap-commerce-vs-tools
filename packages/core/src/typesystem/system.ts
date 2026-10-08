import { LineIndex, type Span } from '../languages/shared/line-index.js';
import type { SchemaAttribute, SchemaLocation, TypeSchema } from '../languages/shared/schema.js';
import type {
  AtomicTypeDef,
  AttributeDef,
  CollectionTypeDef,
  EnumTypeDef,
  ItemsFile,
  ItemTypeDef,
  MapTypeDef,
  RelationDef,
  SourceRef,
} from './model.js';

/** Default supertype of an item type that does not say `extends`. */
export const IMPLICIT_SUPERTYPE = 'GenericItem';

const PRIMITIVES = new Set(['boolean', 'byte', 'char', 'short', 'int', 'long', 'float', 'double']);

export type TypeKind = 'item' | 'enum' | 'collection' | 'map' | 'atomic';

/** All definitions of one item type across extensions, merged. */
export interface MergedItemType {
  code: string;
  extends?: string;
  abstract: boolean;
  jaloclass?: string;
  deployment?: { table?: string; typecode?: number };
  description?: string;
  /** All definitions in load order. */
  definitions: ItemTypeDef[];
  /** The definition that creates the type (first with `autocreate`); undefined if the type is only extended. */
  declaration?: ItemTypeDef;
  /** Set when the type exists because of a relation (`source`, `target` and `language` are its attributes). */
  relation?: RelationDef;
  /** Own attributes (including those added by relations), keyed by lower-case qualifier. */
  attributes: Map<string, AttributeDef[]>;
}

export interface AttributeInfo {
  qualifier: string;
  /** The effective definition (the most specific one). */
  def: AttributeDef;
  /** All definitions in this hierarchy, base first. */
  definitions: AttributeDef[];
  /** Type that declares/redeclares the attribute closest to the queried type. */
  declaredIn: string;
  /** True when declared on the queried type itself. */
  own: boolean;
}

export interface TypeSearchHit {
  kind: 'type' | 'enum' | 'attribute' | 'enum-value' | 'relation';
  /** Type the hit belongs to (for attributes / values). */
  owner?: string;
  name: string;
  detail?: string;
  source: SourceRef;
}

/** The merged item type system of all loaded extensions. */
export class TypeSystem implements TypeSchema {
  readonly items = new Map<string, MergedItemType>();
  readonly enums = new Map<string, EnumTypeDef[]>();
  readonly collections = new Map<string, CollectionTypeDef>();
  readonly maps = new Map<string, MapTypeDef>();
  readonly atomics = new Map<string, AtomicTypeDef>();
  readonly relations = new Map<string, RelationDef>();
  private readonly subtypeIndex = new Map<string, string[]>();
  private readonly attributeCache = new Map<string, AttributeInfo[]>();
  private readonly lowerNames = new Map<string, string>();
  /** Item codes by lower-case name: the platform resolves type codes in `items.xml` without regard to case. */
  private readonly lowerItems = new Map<string, string>();

  /** `files` must be in extension load order (dependencies first). */
  constructor(readonly files: readonly ItemsFile[]) {
    for (const file of files) {
      for (const a of file.atomicTypes)
        if (!this.atomics.has(a.className)) this.atomics.set(a.className, a);
      for (const c of file.collectionTypes)
        if (!this.collections.has(c.code)) this.collections.set(c.code, c);
      for (const m of file.mapTypes) if (!this.maps.has(m.code)) this.maps.set(m.code, m);
      for (const e of file.enumTypes)
        this.enums.set(e.code, [...(this.enums.get(e.code) ?? []), e]);
      for (const r of file.relations)
        if (!this.relations.has(r.code)) this.relations.set(r.code, r);
      for (const t of file.itemTypes) this.addItemType(t);
    }
    this.finalizeItemTypes();
    for (const code of this.items.keys()) this.lowerItems.set(code.toLowerCase(), code);
    this.addRelationTypes();
    this.addRelationAttributes();
    for (const t of this.items.values()) {
      if (t.extends)
        this.subtypeIndex.set(t.extends, [...(this.subtypeIndex.get(t.extends) ?? []), t.code]);
    }
    for (const name of [
      ...this.items.keys(),
      ...this.enums.keys(),
      ...this.collections.keys(),
      ...this.maps.keys(),
      ...this.atomics.keys(),
    ]) {
      this.lowerNames.set(name.toLowerCase(), name);
    }
  }

  private addItemType(def: ItemTypeDef): void {
    let merged = this.items.get(def.code);
    if (!merged) {
      merged = { code: def.code, abstract: false, definitions: [], attributes: new Map() };
      this.items.set(def.code, merged);
    }
    merged.definitions.push(def);
    for (const a of def.attributes) {
      const key = a.qualifier.toLowerCase();
      merged.attributes.set(key, [...(merged.attributes.get(key) ?? []), a]);
    }
  }

  /**
   * Derives the type-level properties once all definitions are known. The *declaring* definition is the first one
   * with `autocreate` (extensions that only add attributes to a foreign type say `autocreate="false"` and may be
   * loaded earlier than the declaration).
   */
  private finalizeItemTypes(): void {
    for (const merged of this.items.values()) {
      const declaring = merged.definitions.find((d) => d.autocreate);
      const first = merged.definitions[0] as ItemTypeDef;
      merged.declaration = declaring;
      merged.extends =
        merged.definitions.find((d) => d.extends)?.extends ??
        (declaring && merged.code !== 'Item' ? IMPLICIT_SUPERTYPE : undefined);
      merged.abstract = (declaring ?? first).abstract;
      merged.jaloclass =
        declaring?.jaloclass ?? merged.definitions.find((d) => d.jaloclass)?.jaloclass;
      const deployment = merged.definitions.find((d) => d.deployment)?.deployment;
      merged.deployment = deployment
        ? { table: deployment.table, typecode: deployment.typecode }
        : undefined;
      merged.description = merged.definitions.find((d) => d.description)?.description;
    }
  }

  /**
   * A many-to-many relation is also an item type (a `Link`) whose rows can be imported:
   * `INSERT_UPDATE ProductCategoryRelation;source(code);target(code)`.
   * One-to-many relations have no link rows: the platform lists them as plain `Item` types without `source`/`target`
   * (checked against the 480 relation types of a running 2211 system, no exceptions).
   */
  private addRelationTypes(): void {
    for (const relation of this.relations.values()) {
      const link = isManyToMany(relation);
      let type = this.items.get(relation.code);
      if (!type) {
        type = {
          code: relation.code,
          extends: link ? 'Link' : 'Item',
          abstract: false,
          definitions: [],
          attributes: new Map(),
        };
        this.items.set(relation.code, type);
        this.lowerItems.set(relation.code.toLowerCase(), relation.code);
      }
      type.relation = relation;
      type.extends ??= link ? 'Link' : 'Item';
      const add = (qualifier: string, valueType: string): void => {
        if (type.attributes.has(qualifier)) return;
        type.attributes.set(qualifier, [
          {
            qualifier,
            type: valueType,
            typeSpan: relation.source.nameSpan,
            localized: false,
            baseType: valueType,
            redeclare: false,
            persistence: 'property',
            read: true,
            write: true,
            search: true,
            optional: false,
            relation: relation.code,
            description: `${qualifier === 'source' ? 'Source' : qualifier === 'target' ? 'Target' : 'Language'} side of relation ${relation.code}`,
            source: relation.source,
          },
        ]);
      };
      if (link) {
        add('source', relation.sourceElement.type);
        add('target', relation.targetElement.type);
        if (relation.localized) add('language', 'Language');
      }
    }
  }

  /**
   * `qualifier` of a relation end is an attribute of the *opposite* type. An ordered one-to-many relation also gives the
   * "many" type a position attribute named after the "one" end (`User2ContactInfos` → `AbstractContactInfo.userPOS`).
   */
  private addRelationAttributes(): void {
    for (const relation of this.relations.values()) {
      const { sourceElement: src, targetElement: tgt } = relation;
      if (src.cardinality !== tgt.cardinality) {
        const [one, many] = src.cardinality === 'one' ? [src, tgt] : [tgt, src];
        if (many.ordered && one.qualifier)
          this.addPositionAttribute(relation, `${one.qualifier}POS`, many);
      }
      this.addRelationAttribute(
        relation,
        src.qualifier,
        tgt.type,
        src.type,
        src.cardinality,
        src.collectionType,
        src.ordered,
        src.optional,
        src.partOf,
        src.qualifierSpan,
      );
      this.addRelationAttribute(
        relation,
        tgt.qualifier,
        src.type,
        tgt.type,
        tgt.cardinality,
        tgt.collectionType,
        tgt.ordered,
        tgt.optional,
        tgt.partOf,
        tgt.qualifierSpan,
      );
    }
  }

  private itemByAnyCase(code: string): MergedItemType | undefined {
    return this.items.get(code) ?? this.items.get(this.lowerItems.get(code.toLowerCase()) ?? '');
  }

  private addPositionAttribute(
    relation: RelationDef,
    qualifier: string,
    many: RelationDef['targetElement'],
  ): void {
    const owner = this.itemByAnyCase(many.type);
    if (!owner) return;
    const key = qualifier.toLowerCase();
    if (owner.attributes.has(key)) return;
    owner.attributes.set(key, [
      {
        qualifier,
        type: 'java.lang.Integer',
        typeSpan: relation.source.nameSpan,
        localized: false,
        baseType: 'java.lang.Integer',
        redeclare: false,
        persistence: 'property',
        read: true,
        write: true,
        search: true,
        optional: true,
        relation: relation.code,
        description: `Position of the item in the ordered relation ${relation.code}`,
        source: relation.source,
      },
    ]);
  }

  private addRelationAttribute(
    relation: RelationDef,
    qualifier: string | undefined,
    ownerType: string,
    valueType: string,
    cardinality: 'one' | 'many',
    collectionType: 'collection' | 'list' | 'set' | undefined,
    ordered: boolean,
    optional: boolean | undefined,
    partOf: boolean | undefined,
    qualifierSpan: { start: number; end: number } | undefined,
  ): void {
    if (!qualifier) return;
    const owner = this.itemByAnyCase(ownerType);
    if (!owner) return;
    const kind = collectionType ?? (ordered ? 'list' : 'collection');
    const type =
      cardinality === 'many'
        ? `${kind === 'list' ? 'List' : kind === 'set' ? 'Set' : 'Collection'}<${valueType}>`
        : valueType;
    const def: AttributeDef = {
      qualifier,
      type,
      typeSpan: relation.source.nameSpan,
      localized: relation.localized,
      baseType: type,
      redeclare: false,
      persistence: 'property',
      read: true,
      write: true,
      search: true,
      optional,
      partOf,
      relation: relation.code,
      description: `Relation ${relation.code}`,
      source: { ...relation.source, nameSpan: qualifierSpan ?? relation.source.nameSpan },
    };
    const key = qualifier.toLowerCase();
    owner.attributes.set(key, [...(owner.attributes.get(key) ?? []), def]);
  }

  // ------------------------------------------------------------------ lookups

  /** Case-insensitive type lookup, returns the canonical name. */
  canonicalName(name: string): string | undefined {
    return this.lowerNames.get(name.toLowerCase());
  }

  kindOf(name: string): TypeKind | undefined {
    if (PRIMITIVES.has(name)) return 'atomic';
    const canonical = this.canonicalName(name);
    if (!canonical) return undefined;
    if (this.items.has(canonical)) return 'item';
    if (this.enums.has(canonical)) return 'enum';
    if (this.collections.has(canonical)) return 'collection';
    if (this.maps.has(canonical)) return 'map';
    return 'atomic';
  }

  /** Names that are valid without an explicit definition: Java primitives. */
  isPrimitive(name: string): boolean {
    return PRIMITIVES.has(name);
  }

  item(name: string): MergedItemType | undefined {
    const canonical = this.canonicalName(name);
    return canonical ? this.items.get(canonical) : undefined;
  }

  /** The type itself, then its parents up to the root. Cycle-safe. */
  supertypeChain(name: string): MergedItemType[] {
    const chain: MergedItemType[] = [];
    const seen = new Set<string>();
    let current = this.item(name);
    while (current && !seen.has(current.code)) {
      seen.add(current.code);
      chain.push(current);
      current = current.extends ? this.item(current.extends) : undefined;
    }
    return chain;
  }

  isSubtypeOf(name: string, ancestor: string): boolean {
    const target = this.canonicalName(ancestor);
    return !!target && this.supertypeChain(name).some((t) => t.code === target);
  }

  directSubtypes(name: string): string[] {
    const canonical = this.canonicalName(name);
    return canonical ? [...(this.subtypeIndex.get(canonical) ?? [])].sort() : [];
  }

  allSubtypes(name: string): string[] {
    const out: string[] = [];
    const stack = [...this.directSubtypes(name)];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const next = stack.pop() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      out.push(next);
      stack.push(...this.directSubtypes(next));
    }
    return out.sort();
  }

  /** All attributes of an item type including inherited ones; the most specific definition wins. */
  attributeInfos(name: string): AttributeInfo[] {
    const canonical = this.canonicalName(name);
    if (!canonical || !this.items.has(canonical)) return [];
    const cached = this.attributeCache.get(canonical);
    if (cached) return cached;

    const chain = this.supertypeChain(canonical);
    const byQualifier = new Map<string, AttributeInfo>();
    // base first, so more specific types override
    for (const type of [...chain].reverse()) {
      for (const [key, defs] of type.attributes) {
        const previous = byQualifier.get(key);
        const last = defs[defs.length - 1] as AttributeDef;
        const effective = defs.find((d) => !d.redeclare) ?? last;
        byQualifier.set(key, {
          qualifier: effective.qualifier,
          def: mergeRedeclared(previous?.def, effective, defs),
          definitions: [...(previous?.definitions ?? []), ...defs],
          declaredIn: type.code,
          own: type.code === canonical,
        });
      }
    }
    const result = [...byQualifier.values()].sort((a, b) => a.qualifier.localeCompare(b.qualifier));
    this.attributeCache.set(canonical, result);
    return result;
  }

  attribute(typeName: string, qualifier: string): AttributeInfo | undefined {
    const key = qualifier.toLowerCase();
    return this.attributeInfos(typeName).find((a) => a.qualifier.toLowerCase() === key);
  }

  /**
   * The type an attribute value refers to: unwraps `localized:`, named collection types, `Collection<X>` and maps.
   * Returns undefined for plain Java types.
   */
  referencedType(typeString: string): string | undefined {
    let current = typeString.replace(/^localized:/i, '').trim();
    for (let depth = 0; depth < 5; depth++) {
      const generic = /^(?:Collection|List|Set)<(.+)>$/.exec(current);
      if (generic) {
        current = (generic[1] as string).trim();
        continue;
      }
      const collection = this.collections.get(this.canonicalName(current) ?? '');
      if (collection) {
        current = collection.elementType;
        continue;
      }
      break;
    }
    const kind = this.kindOf(current);
    return kind === 'item' || kind === 'enum' ? this.canonicalName(current) : undefined;
  }

  /** Values of the enumeration type `enumName`. */
  valuesOfEnum(enumName: string): string[] {
    const canonical = this.canonicalName(enumName);
    const defs = canonical ? this.enums.get(canonical) : undefined;
    if (!defs) return [];
    const seen = new Set<string>();
    for (const def of defs) for (const v of def.values) seen.add(v.code);
    return [...seen];
  }

  // ------------------------------------------------------------------ TypeSchema

  typeNames(): readonly string[] {
    return [...this.items.keys(), ...this.enums.keys()].sort();
  }

  hasType(name: string): boolean {
    const kind = this.kindOf(name);
    return kind === 'item' || kind === 'enum';
  }

  attributes(typeName: string): readonly SchemaAttribute[] | undefined {
    if (this.kindOf(typeName) !== 'item') return undefined;
    return this.attributeInfos(typeName).map((info) => ({
      name: info.qualifier,
      type: info.def.type,
      doc: info.def.description,
      unique: info.def.unique,
      mandatory: info.def.optional === false,
      localized: info.def.localized,
      own: info.own,
    }));
  }

  /** Allowed values of an enum-typed attribute (TypeSchema). */
  enumValues(typeName: string, attribute: string): readonly string[] | undefined {
    const info = this.attribute(typeName, attribute);
    const referenced = info ? this.referencedType(info.def.type) : undefined;
    return referenced && this.kindOf(referenced) === 'enum'
      ? this.valuesOfEnum(referenced)
      : undefined;
  }

  private readonly lineIndexes = new Map<string, LineIndex>();

  /** Converts a span in one of the parsed files into a line/character location. */
  locationOfSpan(source: SourceRef, span: Span = source.nameSpan): SchemaLocation | undefined {
    const file = this.files.find((f) => f.file === source.file);
    if (!file) return undefined;
    let index = this.lineIndexes.get(file.file);
    if (!index) {
      index = new LineIndex(file.text);
      this.lineIndexes.set(file.file, index);
    }
    const range = index.rangeOf(span);
    return { file: file.file, start: range.start, end: range.end };
  }

  /** Where a type, enum, relation or one of its attributes is defined. */
  locate(typeName: string, attribute?: string): SchemaLocation | undefined {
    const canonical = this.canonicalName(typeName);
    if (!canonical) return undefined;
    if (attribute) {
      const info = this.attribute(canonical, attribute);
      return info ? this.locationOfSpan(info.def.source) : undefined;
    }
    const item = this.items.get(canonical);
    if (item) {
      const source =
        item.declaration?.source ?? item.definitions[0]?.source ?? item.relation?.source;
      return source ? this.locationOfSpan(source) : undefined;
    }
    const enumDef = this.enums.get(canonical)?.[0];
    if (enumDef) return this.locationOfSpan(enumDef.source);
    const other =
      this.collections.get(canonical)?.source ??
      this.maps.get(canonical)?.source ??
      this.atomics.get(canonical)?.source;
    return other ? this.locationOfSpan(other) : undefined;
  }

  isIncomplete(typeName: string): boolean {
    const chain = this.supertypeChain(typeName);
    if (chain.length === 0) return false;
    if (chain.some((t) => !t.declaration && !t.relation)) return true;
    const root = chain[chain.length - 1] as MergedItemType;
    return !!root.extends && !this.item(root.extends); // chain ends at a type that does not exist
  }

  isAbstract(typeName: string): boolean {
    return this.item(typeName)?.abstract ?? false;
  }

  typeDoc(typeName: string): string | undefined {
    const item = this.item(typeName);
    if (item) {
      const parts = [
        `Item type${item.abstract ? ' (abstract)' : ''}${item.extends ? `, extends \`${item.extends}\`` : ''}`,
      ];
      if (item.deployment?.table)
        parts.push(
          `Table \`${item.deployment.table}\`${item.deployment.typecode !== undefined ? `, typecode ${item.deployment.typecode}` : ''}`,
        );
      if (item.description) parts.push(item.description);
      return parts.join('\n\n');
    }
    const defs = this.enums.get(this.canonicalName(typeName) ?? '');
    return defs ? `Enumeration with ${this.valuesOfEnum(typeName).length} values` : undefined;
  }

  // ------------------------------------------------------------------ search

  /** Types, enums, attributes and enum values whose name contains every word of `query` (case-insensitive). */
  search(query: string, limit = 200): TypeSearchHit[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const matches = (text: string): boolean => words.every((w) => text.toLowerCase().includes(w));
    const hits: TypeSearchHit[] = [];
    const push = (hit: TypeSearchHit): boolean => {
      hits.push(hit);
      return hits.length >= limit;
    };

    for (const t of this.items.values()) {
      const primary = t.declaration?.source ?? t.definitions[0]?.source ?? t.relation?.source;
      if (
        primary &&
        matches(t.code) &&
        push({
          kind: 'type',
          name: t.code,
          detail: t.extends ? `extends ${t.extends}` : undefined,
          source: primary,
        })
      )
        return hits;
    }
    for (const [code, defs] of this.enums) {
      if (
        matches(code) &&
        push({
          kind: 'enum',
          name: code,
          detail: `${this.valuesOfEnum(code).length} values`,
          source: (defs[0] as EnumTypeDef).source,
        })
      )
        return hits;
    }
    for (const t of this.items.values()) {
      for (const defs of t.attributes.values()) {
        const first = defs[0] as AttributeDef;
        if (
          matches(`${t.code} ${first.qualifier}`) &&
          push({
            kind: 'attribute',
            owner: t.code,
            name: first.qualifier,
            detail: first.type,
            source: first.source,
          })
        )
          return hits;
      }
    }
    for (const [code, defs] of this.enums) {
      for (const def of defs) {
        for (const v of def.values) {
          if (
            matches(`${code} ${v.code}`) &&
            push({ kind: 'enum-value', owner: code, name: v.code, source: v.source })
          )
            return hits;
        }
      }
    }
    for (const r of this.relations.values()) {
      if (
        matches(r.code) &&
        push({
          kind: 'relation',
          name: r.code,
          detail: `${r.sourceElement.type} ↔ ${r.targetElement.type}`,
          source: r.source,
        })
      )
        return hits;
    }
    return hits;
  }
}

/** A redeclaration usually only changes a few modifiers; keep the declared type unless the redeclaration gives one. */
function mergeRedeclared(
  base: AttributeDef | undefined,
  effective: AttributeDef,
  defs: readonly AttributeDef[],
): AttributeDef {
  if (!base) return effective;
  const redeclaration = [...defs].reverse().find((d) => d.redeclare) ?? effective;
  return {
    ...base,
    ...stripUndefined(redeclaration),
    type: redeclaration.type || base.type,
    baseType: redeclaration.type ? redeclaration.baseType : base.baseType,
    localized: redeclaration.type ? redeclaration.localized : base.localized,
    source: effective.source,
  };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function isManyToMany(relation: RelationDef): boolean {
  return (
    relation.sourceElement.cardinality === 'many' && relation.targetElement.cardinality === 'many'
  );
}
