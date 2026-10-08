import { fileURLToPath } from 'node:url';
import {
  beans,
  buildTypeSystem,
  spring,
  loadPlatform,
  readFromDisk,
  type ExtensionCategory,
  type PlatformProject,
  type TypeSchema,
  type TypeSystem,
} from '@sapcommerce-vstools/core';

export interface IndexedProject {
  project: PlatformProject;
  typeSystem: TypeSystem;
  beanSystem: beans.BeanSystem;
  springSystem: spring.SpringSystem;
  javaIndex: spring.JavaIndex;
}

export interface ProjectIndexDeps {
  /** `hybris` directories to index. */
  roots(): Promise<string[]>;
  /** Unsaved editor content for a file path, if the file is open. */
  overlay(path: string): string | undefined;
  /** Called after the index changed. */
  changed(): void;
  log(message: string): void;
}

/** Holds the project model and the merged type system of every SAP Commerce project in the workspace. */
export class ProjectIndex {
  projects: IndexedProject[] = [];
  private loading: Promise<void> | undefined;
  private queued = false;

  constructor(private readonly deps: ProjectIndexDeps) {}

  private read = async (path: string): Promise<string | undefined> =>
    this.deps.overlay(path) ?? readFromDisk(path);

  /** Reloads project model and type systems from disk. Concurrent calls are coalesced. */
  reload(): Promise<void> {
    if (this.loading) {
      this.queued = true;
      return this.loading;
    }
    this.loading = this.doReload().finally(() => {
      this.loading = undefined;
      if (this.queued) {
        this.queued = false;
        void this.reload();
      }
    });
    return this.loading;
  }

  private async doReload(): Promise<void> {
    const started = Date.now();
    try {
      const roots = await this.deps.roots();
      const projects: IndexedProject[] = [];
      for (const root of roots) {
        const project = await loadPlatform(root);
        projects.push({
          project,
          typeSystem: await buildTypeSystem(project, this.read),
          beanSystem: await beans.buildBeanSystem(project, this.read),
          springSystem: await spring.buildSpringSystem(project, this.read),
          javaIndex: await spring.buildJavaIndex(project),
        });
      }
      this.projects = projects;
      const types = projects.reduce((n, p) => n + p.typeSystem.items.size, 0);
      this.deps.log(
        `Indexed ${projects.length} project(s): ${types} item types in ${Date.now() - started} ms`,
      );
    } catch (err) {
      this.deps.log(`Indexing failed: ${err instanceof Error ? err.message : String(err)}`);
      this.projects = [];
    }
    this.deps.changed();
  }

  /** Re-parses only the items and beans files (cheap); used while the user types in one of them. */
  async rebuildSystems(): Promise<void> {
    this.projects = await Promise.all(
      this.projects.map(async ({ project, javaIndex }) => ({
        project,
        typeSystem: await buildTypeSystem(project, this.read),
        beanSystem: await beans.buildBeanSystem(project, this.read),
        springSystem: await spring.buildSpringSystem(project, this.read),
        javaIndex, // class files rarely change while typing; rebuilt on a full reload
      })),
    );
    this.deps.changed();
  }

  /** The project a file belongs to; falls back to the first project for files outside any (untitled ImpEx, …). */
  forPath(path: string | undefined): IndexedProject | undefined {
    if (path) {
      const inside = this.projects.find((p) => path.startsWith(p.project.hybrisDir));
      if (inside) return inside;
    }
    return this.projects[0];
  }

  forUri(uri: string | undefined): IndexedProject | undefined {
    return this.forPath(uri ? uriToPath(uri) : undefined);
  }

  schemaFor = (uri: string): TypeSchema | undefined => this.forUri(uri)?.typeSystem;

  typeSystemFor = (uri: string): TypeSystem | undefined => this.forUri(uri)?.typeSystem;

  beanSystemFor = (uri: string): beans.BeanSystem | undefined => this.forUri(uri)?.beanSystem;

  springFor = (
    uri: string,
  ): { system: spring.SpringSystem; java: spring.JavaIndex } | undefined => {
    const indexed = this.forUri(uri);
    return indexed ? { system: indexed.springSystem, java: indexed.javaIndex } : undefined;
  };

  /** Category (platform / modules / custom) of the extension a file belongs to. */
  categoryFor(uri: string): ExtensionCategory | undefined {
    const path = uriToPath(uri);
    const indexed = this.forPath(path);
    if (!path || !indexed) return undefined;
    let best: { dir: string; category: ExtensionCategory } | undefined;
    for (const extension of indexed.project.available.values()) {
      if (path.startsWith(extension.dir) && (!best || extension.dir.length > best.dir.length)) {
        best = { dir: extension.dir, category: extension.category };
      }
    }
    return best?.category;
  }
}

export function uriToPath(uri: string): string | undefined {
  try {
    return uri.startsWith('file:') ? fileURLToPath(uri) : undefined;
  } catch {
    return undefined;
  }
}
