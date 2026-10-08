import type { GraphEdge, GraphNode } from '../graph/layout.js';
import type { ExtensionInfo, PlatformProject } from './model.js';
import { dependents } from './load.js';

export type ModuleScope =
  | { kind: 'custom' }
  | { kind: 'all' }
  | { kind: 'dependencies'; extension: string; depth?: number }
  | { kind: 'dependents'; extension: string; depth?: number };

export interface ModuleGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Number of loaded extensions that did not fit the scope. */
  hidden: number;
}

/** Dependency graph of the loaded extensions for a scope (the full graph is rarely readable). */
export function moduleGraph(project: PlatformProject, scope: ModuleScope): ModuleGraph {
  const loaded = new Map(project.loaded.map((e) => [e.name, e]));
  const selected = new Set<string>();

  const closure = (start: string, next: (e: ExtensionInfo) => string[], depth: number): void => {
    let frontier = [start];
    selected.add(start);
    for (let level = 0; level < depth && frontier.length > 0; level++) {
      const following: string[] = [];
      for (const name of frontier) {
        const info = loaded.get(name);
        if (!info) continue;
        for (const n of next(info)) {
          if (loaded.has(n) && !selected.has(n)) {
            selected.add(n);
            following.push(n);
          }
        }
      }
      frontier = following;
    }
  };

  switch (scope.kind) {
    case 'all':
      for (const name of loaded.keys()) selected.add(name);
      break;
    case 'custom':
      for (const e of project.loaded) {
        if (e.category !== 'custom') continue;
        selected.add(e.name);
        for (const r of e.requires) if (loaded.has(r)) selected.add(r);
      }
      break;
    case 'dependencies':
      closure(scope.extension, (e) => e.requires, scope.depth ?? 99);
      break;
    case 'dependents': {
      selected.add(scope.extension);
      const all = project.loaded;
      for (const name of dependents(all, scope.extension)) {
        if (!scope.depth || scope.depth >= 99) selected.add(name);
      }
      if (scope.depth && scope.depth < 99)
        closure(
          scope.extension,
          (e) => all.filter((x) => x.requires.includes(e.name)).map((x) => x.name),
          scope.depth,
        );
      break;
    }
  }

  const nodes: GraphNode[] = [...selected]
    .map((name) => loaded.get(name))
    .filter((e): e is ExtensionInfo => !!e)
    .map((e) => ({ id: e.name, label: e.name, kind: e.category, detail: e.version }));
  const edges: GraphEdge[] = nodes.flatMap((n) =>
    (loaded.get(n.id)?.requires ?? [])
      .filter((r) => selected.has(r))
      .map((r) => ({ from: n.id, to: r, kind: 'requires' })),
  );
  return { nodes, edges, hidden: project.loaded.length - nodes.length };
}
