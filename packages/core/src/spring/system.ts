import { LineIndex, type Span } from '../languages/shared/line-index.js';
import type { SchemaLocation } from '../languages/shared/schema.js';
import type { SpringAlias, SpringBean, SpringFile, SpringRef } from './model.js';

export interface SpringUsage {
  ref: SpringRef;
  bean?: SpringBean;
  alias?: SpringAlias;
  file: string;
}

/**
 * The beans of all loaded Spring files. As in Hybris, a bean id that is defined by several extensions is
 * *overridden*: the definition of the extension loaded last wins.
 */
export class SpringSystem {
  /** All definitions per id in load order. */
  readonly byId = new Map<string, SpringBean[]>();
  /** alias → definitions (several extensions may add the same alias; the last one wins). */
  readonly aliases = new Map<string, SpringAlias[]>();
  private usageIndex: Map<string, SpringUsage[]> | undefined;
  private readonly lineIndexes = new Map<string, LineIndex>();

  /** `files` must be in extension load order. */
  constructor(readonly files: readonly SpringFile[]) {
    for (const file of files) {
      for (const bean of file.beans) {
        for (const id of [bean.id, ...bean.names].filter((x): x is string => !!x))
          this.byId.set(id, [...(this.byId.get(id) ?? []), bean]);
      }
      for (const alias of file.aliases)
        this.aliases.set(alias.alias, [...(this.aliases.get(alias.alias) ?? []), alias]);
    }
  }

  /** Follows aliases to the bean id they finally point to (cycle safe). */
  canonicalId(idOrAlias: string): string {
    let current = idOrAlias;
    const seen = new Set<string>();
    while (!seen.has(current)) {
      seen.add(current);
      const alias = this.aliases.get(current);
      if (!alias || this.byId.has(current)) break;
      current = (alias[alias.length - 1] as SpringAlias).name;
    }
    return current;
  }

  has(idOrAlias: string): boolean {
    return this.byId.has(this.canonicalId(idOrAlias));
  }

  /** The definition that is in effect (last loaded). */
  effective(idOrAlias: string): SpringBean | undefined {
    const defs = this.byId.get(this.canonicalId(idOrAlias));
    return defs?.[defs.length - 1];
  }

  /** All definitions of the bean, base first. */
  definitions(idOrAlias: string): SpringBean[] {
    return [...(this.byId.get(this.canonicalId(idOrAlias)) ?? [])];
  }

  /** Bean class, following `parent` chains for beans that only name a parent. */
  classOf(idOrAlias: string): string | undefined {
    const seen = new Set<string>();
    let current: SpringBean | undefined = this.effective(idOrAlias);
    while (current && !seen.has(current.id ?? '')) {
      if (current.className) return current.className;
      seen.add(current.id ?? '');
      current = current.parent ? this.effective(current.parent) : undefined;
    }
    return undefined;
  }

  private usages(): Map<string, SpringUsage[]> {
    if (this.usageIndex) return this.usageIndex;
    const index = new Map<string, SpringUsage[]>();
    const add = (target: string, usage: SpringUsage): void => {
      index.set(target, [...(index.get(target) ?? []), usage]);
    };
    for (const file of this.files) {
      for (const bean of file.beans)
        for (const ref of bean.refs)
          add(this.canonicalId(ref.target), { ref, bean, file: file.file });
      for (const alias of file.aliases)
        add(this.canonicalId(alias.name), {
          ref: { target: alias.name, span: alias.nameSpan, kind: 'alias-target' },
          alias,
          file: file.file,
        });
    }
    this.usageIndex = index;
    return index;
  }

  /** Everything that refers to this bean (refs, parents, depends-on, aliases). */
  usagesOf(idOrAlias: string): SpringUsage[] {
    return [...(this.usages().get(this.canonicalId(idOrAlias)) ?? [])];
  }

  locationOf(file: string, span: Span): SchemaLocation | undefined {
    const parsed = this.files.find((f) => f.file === file);
    if (!parsed) return undefined;
    let index = this.lineIndexes.get(file);
    if (!index) {
      index = new LineIndex(parsed.text);
      this.lineIndexes.set(file, index);
    }
    const range = index.rangeOf(span);
    return { file, start: range.start, end: range.end };
  }

  /** Where a bean (or alias) is defined: all definitions, base first. */
  locate(idOrAlias: string): SchemaLocation[] {
    return this.definitions(idOrAlias)
      .map((b) => this.locationOf(b.file, b.idSpan ?? b.span))
      .filter((l): l is SchemaLocation => !!l);
  }

  allIds(): string[] {
    return [...new Set([...this.byId.keys(), ...this.aliases.keys()])].sort();
  }

  search(
    query: string,
    limit = 100,
  ): { id: string; className?: string; extension: string; overrides: number }[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const hits: { id: string; className?: string; extension: string; overrides: number }[] = [];
    for (const id of this.byId.keys()) {
      const defs = this.byId.get(id) as SpringBean[];
      const last = defs[defs.length - 1] as SpringBean;
      const hay = `${id} ${this.classOf(id) ?? ''}`.toLowerCase();
      if (words.every((w) => hay.includes(w)))
        hits.push({
          id,
          className: this.classOf(id),
          extension: last.extension,
          overrides: defs.length - 1,
        });
      if (hits.length >= limit) break;
    }
    return hits;
  }
}
