import type { SchemaLocation } from '../languages/shared/schema.js';
import type { BeanSystem } from './system.js';

export interface BeanDescription {
  name: string;
  kind: 'bean' | 'bean-enum';
  extends?: string;
  abstract?: boolean;
  deprecated?: string;
  description?: string;
  typeParameters: string[];
  ancestors: string[];
  subtypes: string[];
  properties: {
    name: string;
    type: string;
    declaredIn: string;
    own: boolean;
    description?: string;
    deprecated?: string;
    location?: SchemaLocation;
  }[];
  enumValues?: string[];
  extensions: string[];
  location?: SchemaLocation;
}

/** Accepts fully qualified or unambiguous short names. */
export function describeBean(system: BeanSystem, name: string): BeanDescription | undefined {
  const resolved = system.resolve(name);
  if (!resolved) return undefined;
  const location = system.locate(resolved);
  const bean = system.beans.get(resolved);
  if (bean) {
    return {
      name: resolved,
      kind: 'bean',
      extends: bean.extends,
      abstract: bean.abstract,
      deprecated: bean.deprecated,
      description: bean.description,
      typeParameters: bean.typeParameters,
      ancestors: system
        .chain(resolved)
        .slice(1)
        .map((b) => b.className),
      subtypes: system.directSubtypes(resolved),
      extensions: [...new Set(bean.definitions.map((d) => d.source.extension))],
      location,
      properties: system.properties(resolved).map((p) => ({
        name: p.name,
        type: p.def.type,
        declaredIn: p.declaredIn,
        own: p.own,
        description: p.def.description,
        deprecated: p.def.deprecated,
        location: system.locationOf(p.def.source),
      })),
    };
  }
  const defs = system.enums.get(resolved) ?? [];
  return {
    name: resolved,
    kind: 'bean-enum',
    typeParameters: [],
    ancestors: [],
    subtypes: [],
    properties: [],
    enumValues: system.enumValues(resolved),
    description: defs.find((d) => d.description)?.description,
    deprecated: defs.find((d) => d.deprecated)?.deprecated,
    extensions: [...new Set(defs.map((d) => d.source.extension))],
    location,
  };
}
