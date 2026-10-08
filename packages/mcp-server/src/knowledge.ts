import {
  beans,
  buildTypeSystem,
  dependents,
  describeType,
  loadPlatform,
  moduleGraph,
  searchTypes,
  type ExtensionCategory,
  type ExtensionInfo,
  type ModuleScope,
  type PlatformProject,
  type TypeSystem,
} from '@sapcommerce-vstools/core';

/** File locations are paths of this machine; answers leave them out. */
function withoutLocation<T extends { location?: unknown }>(value: T): Omit<T, 'location'> {
  const copy = { ...value };
  delete copy.location;
  return copy;
}

interface Indexed {
  project: PlatformProject;
  types: TypeSystem;
  beans: beans.BeanSystem;
}

/** Plain-data view of one SAP Commerce checkout. Read-only; nothing here touches a running system. */
export class ProjectKnowledge {
  private projects: Indexed[] = [];

  constructor(private readonly hybrisDirs: readonly string[]) {}

  async load(): Promise<void> {
    const next: Indexed[] = [];
    for (const dir of this.hybrisDirs) {
      const project = await loadPlatform(dir);
      next.push({
        project,
        types: await buildTypeSystem(project),
        beans: await beans.buildBeanSystem(project),
      });
    }
    this.projects = next;
  }

  get loaded(): boolean {
    return this.projects.length > 0;
  }

  private primary(): Indexed {
    const first = this.projects[0];
    if (!first)
      throw new Error(
        'No SAP Commerce project is loaded. Start the server with --project <hybris dir>.',
      );
    return first;
  }

  private extensionInfo(e: ExtensionInfo) {
    return {
      name: e.name,
      category: e.category,
      version: e.version,
      requires: e.requires,
    };
  }

  listExtensions(filter: { category?: ExtensionCategory; query?: string } = {}) {
    const q = filter.query?.toLowerCase();
    return this.primary()
      .project.loaded.filter((e) => !filter.category || e.category === filter.category)
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .map((e) => ({ name: e.name, category: e.category, version: e.version }));
  }

  getExtension(name: string) {
    const { project } = this.primary();
    const e = project.loaded.find((x) => x.name === name);
    if (!e) return undefined;
    return {
      ...this.extensionInfo(e),
      requiredBy: dependents(project.loaded, name).sort(),
      meta: e.meta,
    };
  }

  extensionGraph(scope: ModuleScope) {
    const g = moduleGraph(this.primary().project, scope);
    return {
      extensions: g.nodes.map((n) => ({ name: n.id, category: n.kind, version: n.detail })),
      dependencies: g.edges.map((e) => ({ from: e.from, requires: e.to })),
      notShown: g.hidden,
    };
  }

  findTypes(query: string, limit = 25) {
    const { types, beans: bs } = this.primary();
    const typeHits = searchTypes(types, query, limit).map((h) => ({
      kind: h.kind,
      name: h.name,
      owner: h.owner,
      detail: h.detail,
    }));
    const beanHits = bs.search(query, Math.max(limit - typeHits.length, 5)).map((h) => ({
      kind: h.kind,
      name: h.name,
      owner: h.owner,
      detail: h.detail,
    }));
    return [...typeHits, ...beanHits].slice(0, limit);
  }

  /** Item type, enum, relation or bean, shaped alike. Locations are dropped; they are file paths of this machine. */
  describe(name: string) {
    const { types, beans: bs } = this.primary();
    const t = describeType(types, name);
    if (t) return { ...withoutLocation(t), attributes: t.attributes.map(withoutLocation) };
    const b = beans.describeBean(bs, name);
    if (!b) return undefined;
    return { ...withoutLocation(b), properties: b.properties.map(withoutLocation) };
  }
}
