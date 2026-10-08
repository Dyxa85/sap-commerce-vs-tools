import type { GraphEdge, GraphNode } from '../graph/layout.js';
import type { TypeSystem } from './system.js';

export interface TypeGraphOptions {
  /** How many levels of subtypes to include (0 = none). Default 1. */
  subtypeDepth?: number;
  /** Include item types referenced by attributes of the focus type. Default true. */
  references?: boolean;
  /** Safety limit for the number of nodes. Default 80. */
  maxNodes?: number;
}

export interface TypeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focus: string;
  /** True when the node limit cut the graph. */
  truncated: boolean;
}

/** Inheritance and reference graph around one item type. */
export function typeGraph(
  ts: TypeSystem,
  name: string,
  options: TypeGraphOptions = {},
): TypeGraph | undefined {
  const focus = ts.item(name);
  if (!focus) return undefined;
  const maxNodes = options.maxNodes ?? 80;
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  let truncated = false;

  const add = (code: string, kind?: string): boolean => {
    if (nodes.has(code)) return true;
    if (nodes.size >= maxNodes) {
      truncated = true;
      return false;
    }
    const type = ts.item(code);
    nodes.set(code, {
      id: code,
      label: code,
      kind: kind ?? (type?.abstract ? 'abstract' : type?.relation ? 'relation' : 'item'),
      detail: type?.abstract ? 'abstract' : type?.deployment?.table,
    });
    return true;
  };

  add(focus.code, 'focus');

  // ancestors: child --extends--> parent
  let current = focus;
  for (const parent of ts.supertypeChain(focus.code).slice(1)) {
    if (!add(parent.code)) break;
    edges.push({ from: current.code, to: parent.code, kind: 'extends' });
    current = parent;
  }

  // subtypes, breadth first up to the requested depth
  let frontier = [focus.code];
  for (let depth = 0; depth < (options.subtypeDepth ?? 1); depth++) {
    const next: string[] = [];
    for (const parent of frontier) {
      for (const child of ts.directSubtypes(parent)) {
        if (!add(child)) continue;
        edges.push({ from: child, to: parent, kind: 'extends' });
        next.push(child);
      }
    }
    frontier = next;
  }

  // references from the focus type's own attributes
  if (options.references ?? true) {
    for (const info of ts.attributeInfos(focus.code)) {
      if (!info.own) continue;
      const target = ts.referencedType(info.def.type);
      if (!target || target === focus.code) continue;
      const kind = ts.kindOf(target);
      if (kind !== 'item' && kind !== 'enum') continue;
      if (!add(target, kind === 'enum' ? 'enum' : undefined)) continue;
      edges.push({ from: focus.code, to: target, label: info.qualifier, kind: 'reference' });
    }
  }
  return { nodes: [...nodes.values()], edges, focus: focus.code, truncated };
}
