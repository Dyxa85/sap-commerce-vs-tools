import type { SchemaLocation } from '../languages/shared/schema.js';
import type { TypeSystem } from './system.js';

/** Plain, JSON-serialisable description of a type for previews and tools (MCP, webviews). */
export interface TypeDescription {
  name: string;
  kind: 'item' | 'enum' | 'collection' | 'map' | 'atomic' | 'relation';
  extends?: string;
  abstract?: boolean;
  description?: string;
  jaloclass?: string;
  deployment?: { table?: string; typecode?: number };
  /** Parent chain, nearest first. */
  ancestors: string[];
  subtypes: string[];
  attributes: AttributeDescription[];
  enumValues?: { code: string; description?: string }[];
  relation?: {
    source: string;
    sourceQualifier?: string;
    target: string;
    targetQualifier?: string;
    localized: boolean;
  };
  elementType?: string;
  extensions: string[];
  location?: SchemaLocation;
  /** True when parts of the declaration are not available in the loaded files. */
  incomplete?: boolean;
}

export interface AttributeDescription {
  qualifier: string;
  type: string;
  declaredIn: string;
  own: boolean;
  localized: boolean;
  optional?: boolean;
  unique?: boolean;
  read?: boolean;
  write?: boolean;
  search?: boolean;
  initial?: boolean;
  partOf?: boolean;
  persistence?: string;
  defaultValue?: string;
  description?: string;
  relation?: string;
  location?: SchemaLocation;
}

export function describeType(ts: TypeSystem, name: string): TypeDescription | undefined {
  const canonical = ts.canonicalName(name);
  const kind = canonical ? ts.kindOf(canonical) : undefined;
  if (!canonical || !kind) return undefined;
  const base = {
    name: canonical,
    ancestors: [] as string[],
    subtypes: [] as string[],
    attributes: [] as AttributeDescription[],
    extensions: [] as string[],
    location: ts.locate(canonical),
  };

  if (kind === 'item') {
    const item = ts.item(canonical)!;
    const infos = ts.attributeInfos(canonical);
    return {
      ...base,
      kind: item.relation ? 'relation' : 'item',
      extends: item.extends,
      abstract: item.abstract,
      description: item.description,
      jaloclass: item.jaloclass,
      deployment: item.deployment,
      ancestors: ts
        .supertypeChain(canonical)
        .slice(1)
        .map((t) => t.code),
      subtypes: ts.directSubtypes(canonical),
      extensions: [...new Set(item.definitions.map((d) => d.source.extension))],
      incomplete: ts.isIncomplete(canonical) || undefined,
      relation: item.relation
        ? {
            source: item.relation.sourceElement.type,
            sourceQualifier: item.relation.sourceElement.qualifier,
            target: item.relation.targetElement.type,
            targetQualifier: item.relation.targetElement.qualifier,
            localized: item.relation.localized,
          }
        : undefined,
      attributes: infos.map((i) => ({
        qualifier: i.qualifier,
        type: i.def.type,
        declaredIn: i.declaredIn,
        own: i.own,
        localized: i.def.localized,
        optional: i.def.optional,
        unique: i.def.unique,
        read: i.def.read,
        write: i.def.write,
        search: i.def.search,
        initial: i.def.initial,
        partOf: i.def.partOf,
        persistence: i.def.persistence,
        defaultValue: i.def.defaultValue,
        description: i.def.description,
        relation: i.def.relation,
        location: ts.locationOfSpan(i.def.source),
      })),
    };
  }
  if (kind === 'enum') {
    const defs = ts.enums.get(canonical) ?? [];
    return {
      ...base,
      kind: 'enum',
      description: defs.find((d) => d.description)?.description,
      extensions: [...new Set(defs.map((d) => d.source.extension))],
      enumValues: defs
        .flatMap((d) => d.values.map((v) => ({ code: v.code, description: v.description })))
        .filter((v, i, all) => all.findIndex((x) => x.code === v.code) === i),
    };
  }
  if (kind === 'collection') {
    const c = ts.collections.get(canonical)!;
    return {
      ...base,
      kind: 'collection',
      elementType: c.elementType,
      extensions: [c.source.extension],
    };
  }
  if (kind === 'map') {
    const m = ts.maps.get(canonical)!;
    return {
      ...base,
      kind: 'map',
      description: `${m.argumentType} → ${m.returnType}`,
      extensions: [m.source.extension],
    };
  }
  const a = ts.atomics.get(canonical);
  return {
    ...base,
    kind: 'atomic',
    extends: a?.extends,
    extensions: a ? [a.source.extension] : [],
  };
}

/** A hit of the type search, with a ready-to-open location. */
export interface TypeSearchResult {
  kind: 'type' | 'enum' | 'attribute' | 'enum-value' | 'relation';
  name: string;
  owner?: string;
  detail?: string;
  location?: SchemaLocation;
}

export function searchTypes(ts: TypeSystem, query: string, limit = 100): TypeSearchResult[] {
  return ts.search(query, limit).map((hit) => ({
    kind: hit.kind,
    name: hit.name,
    owner: hit.owner,
    detail: hit.detail,
    location: ts.locationOfSpan(hit.source),
  }));
}
