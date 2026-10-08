import { LineIndex, type Span } from '../languages/shared/line-index.js';
import type { SchemaLocation } from '../languages/shared/schema.js';
import type { BeanDef, BeanEnumDef, BeanProperty, BeanSource, BeansFile } from './model.js';

export interface MergedBean {
  className: string;
  typeParameters: string[];
  extends?: string;
  abstract: boolean;
  deprecated?: string;
  description?: string;
  definitions: BeanDef[];
  /** Own properties by name (later extensions can add properties to a bean). */
  properties: Map<string, BeanProperty[]>;
}

export interface BeanPropertyInfo {
  name: string;
  def: BeanProperty;
  declaredIn: string;
  own: boolean;
}

export interface BeanSearchHit {
  kind: 'bean' | 'bean-enum' | 'bean-property';
  name: string;
  owner?: string;
  detail?: string;
  source: BeanSource;
}

/** All beans and enums defined in the `*-beans.xml` files of the loaded extensions. */
export class BeanSystem {
  readonly beans = new Map<string, MergedBean>();
  readonly enums = new Map<string, BeanEnumDef[]>();
  private readonly subtypes = new Map<string, string[]>();
  private readonly lineIndexes = new Map<string, LineIndex>();
  private readonly shortNames = new Map<string, string[]>();

  constructor(readonly files: readonly BeansFile[]) {
    for (const file of files) {
      for (const bean of file.beans) this.addBean(bean);
      for (const e of file.enums)
        this.enums.set(e.className, [...(this.enums.get(e.className) ?? []), e]);
    }
    for (const bean of this.beans.values()) {
      if (bean.extends)
        this.subtypes.set(bean.extends, [
          ...(this.subtypes.get(bean.extends) ?? []),
          bean.className,
        ]);
    }
    for (const name of [...this.beans.keys(), ...this.enums.keys()]) {
      const short = name.slice(name.lastIndexOf('.') + 1);
      this.shortNames.set(short, [...(this.shortNames.get(short) ?? []), name]);
    }
  }

  private addBean(def: BeanDef): void {
    let merged = this.beans.get(def.className);
    if (!merged) {
      merged = {
        className: def.className,
        typeParameters: def.typeParameters,
        abstract: def.abstract,
        definitions: [],
        properties: new Map(),
      };
      this.beans.set(def.className, merged);
    }
    merged.definitions.push(def);
    merged.extends ??= def.extends;
    merged.abstract ||= def.abstract;
    merged.deprecated ??= def.deprecated;
    merged.description ??= def.description;
    if (merged.typeParameters.length === 0) merged.typeParameters = def.typeParameters;
    for (const p of def.properties)
      merged.properties.set(p.name, [...(merged.properties.get(p.name) ?? []), p]);
  }

  has(className: string): boolean {
    return this.beans.has(className) || this.enums.has(className);
  }

  /** Resolves a (possibly short) class name to a fully qualified one when it is unambiguous. */
  resolve(name: string): string | undefined {
    const bare = name.replace(/<.*$/s, '').trim();
    if (this.has(bare)) return bare;
    const candidates = this.shortNames.get(bare);
    return candidates?.length === 1 ? candidates[0] : undefined;
  }

  chain(className: string): MergedBean[] {
    const out: MergedBean[] = [];
    const seen = new Set<string>();
    let current = this.beans.get(className);
    while (current && !seen.has(current.className)) {
      seen.add(current.className);
      out.push(current);
      current = current.extends ? this.beans.get(current.extends) : undefined;
    }
    return out;
  }

  properties(className: string): BeanPropertyInfo[] {
    const byName = new Map<string, BeanPropertyInfo>();
    for (const bean of [...this.chain(className)].reverse()) {
      for (const [name, defs] of bean.properties) {
        byName.set(name, {
          name,
          def: defs[defs.length - 1] as BeanProperty,
          declaredIn: bean.className,
          own: bean.className === className,
        });
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  directSubtypes(className: string): string[] {
    return [...(this.subtypes.get(className) ?? [])].sort();
  }

  enumValues(className: string): string[] {
    return [
      ...new Set((this.enums.get(className) ?? []).flatMap((e) => e.values.map((v) => v.code))),
    ];
  }

  locationOf(source: BeanSource, span: Span = source.nameSpan): SchemaLocation | undefined {
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

  locate(className: string, property?: string): SchemaLocation | undefined {
    const name = this.resolve(className);
    if (!name) return undefined;
    if (property) {
      const info = this.properties(name).find((p) => p.name === property);
      return info ? this.locationOf(info.def.source) : undefined;
    }
    const bean = this.beans.get(name);
    const source = bean?.definitions[0]?.source ?? this.enums.get(name)?.[0]?.source;
    return source ? this.locationOf(source) : undefined;
  }

  search(query: string, limit = 100): BeanSearchHit[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const matches = (text: string): boolean => words.every((w) => text.toLowerCase().includes(w));
    const hits: BeanSearchHit[] = [];
    for (const bean of this.beans.values()) {
      if (matches(bean.className))
        hits.push({
          kind: 'bean',
          name: bean.className,
          detail: bean.extends
            ? `extends ${bean.extends.slice(bean.extends.lastIndexOf('.') + 1)}`
            : undefined,
          source: (bean.definitions[0] as BeanDef).source,
        });
      if (hits.length >= limit) return hits;
    }
    for (const [name, defs] of this.enums) {
      if (matches(name))
        hits.push({
          kind: 'bean-enum',
          name,
          detail: `${this.enumValues(name).length} values`,
          source: (defs[0] as BeanEnumDef).source,
        });
      if (hits.length >= limit) return hits;
    }
    for (const bean of this.beans.values()) {
      for (const [name, defs] of bean.properties) {
        const short = bean.className.slice(bean.className.lastIndexOf('.') + 1);
        if (matches(`${short} ${name}`))
          hits.push({
            kind: 'bean-property',
            name,
            owner: bean.className,
            detail: (defs[0] as BeanProperty).type,
            source: (defs[0] as BeanProperty).source,
          });
        if (hits.length >= limit) return hits;
      }
    }
    return hits;
  }
}
