/**
 * A small layered ("Sugiyama style") graph layout: cycle removal, layering by longest path, crossing reduction by the
 * barycenter heuristic, and coordinate assignment. Deterministic and dependency free.
 */

export interface GraphNode {
  id: string;
  label: string;
  /** Free-form class used by the renderer for styling. */
  kind?: string;
  /** Extra line of text under the label. */
  detail?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  /** Free-form class used by the renderer (e.g. "extends", "reference"). */
  kind?: string;
}

export interface LayoutOptions {
  /** `LR`: layers run left to right, `TB`: top to bottom. */
  direction?: 'LR' | 'TB';
  nodeWidth?: (node: GraphNode) => number;
  nodeHeight?: number;
  layerGap?: number;
  nodeGap?: number;
  margin?: number;
}

export interface PositionedNode extends GraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
}

export interface PositionedEdge extends GraphEdge {
  /**
   * Anchor points from the border of `from` to the border of `to`. Edges that cross several layers pass through one
   * anchor per layer (the slot reserved for them between the nodes), so they do not run across other nodes. The
   * renderer joins the anchors with curves that leave and enter horizontally (LR) or vertically (TB).
   */
  points: { x: number; y: number }[];
  /** True when the edge points against the layering (it closes a cycle). */
  back: boolean;
}

export interface Layout {
  direction: 'LR' | 'TB';
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  width: number;
  height: number;
}

/** Prefix of the ids of virtual nodes; cannot clash with user ids because of the NUL character. */
const VIRTUAL = '\u0000v';
const VIRTUAL_CROSS = 8;

const defaultWidth = (n: GraphNode): number =>
  Math.max(90, Math.min(260, 24 + Math.max(n.label.length, (n.detail ?? '').length * 0.9) * 7.2));

export function layoutGraph(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  options: LayoutOptions = {},
): Layout {
  const direction = options.direction ?? 'LR';
  const nodeHeight = options.nodeHeight ?? 44;
  const layerGap = options.layerGap ?? 90;
  const nodeGap = options.nodeGap ?? 26;
  const margin = options.margin ?? 24;
  const widthOf = options.nodeWidth ?? defaultWidth;

  const known = new Set(nodes.map((n) => n.id));
  const valid = edges.filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to);

  // ---- 1. break cycles with a DFS: edges to a node on the current path are reversed for layering
  const out = new Map<string, string[]>();
  for (const n of nodes) out.set(n.id, []);
  for (const e of valid) out.get(e.from)?.push(e.to);
  const state = new Map<string, 1 | 2>();
  const reversed = new Set<string>();
  const key = (a: string, b: string): string => `${a}\u0000${b}`;
  const visit = (id: string): void => {
    state.set(id, 1);
    for (const next of out.get(id) ?? []) {
      if (state.get(next) === 1) reversed.add(key(id, next));
      else if (!state.has(next)) visit(next);
    }
    state.set(id, 2);
  };
  for (const n of nodes) if (!state.has(n.id)) visit(n.id);

  const forward = valid.map((e) =>
    reversed.has(key(e.from, e.to))
      ? { ...e, from: e.to, to: e.from, back: true }
      : { ...e, back: false },
  );

  // ---- 2. layer = longest path from a source
  const preds = new Map<string, string[]>();
  for (const n of nodes) preds.set(n.id, []);
  for (const e of forward) preds.get(e.to)?.push(e.from);
  const layerOf = new Map<string, number>();
  const compute = (id: string, trail: Set<string>): number => {
    const cached = layerOf.get(id);
    if (cached !== undefined) return cached;
    if (trail.has(id)) return 0;
    trail.add(id);
    const value = Math.max(-1, ...(preds.get(id) ?? []).map((p) => compute(p, trail))) + 1;
    trail.delete(id);
    layerOf.set(id, value);
    return value;
  };
  for (const n of nodes) compute(n.id, new Set());

  const layers: string[][] = [];
  for (const n of nodes) {
    const l = layerOf.get(n.id) ?? 0;
    (layers[l] ??= []).push(n.id);
  }
  for (let i = 0; i < layers.length; i++) layers[i] ??= [];

  // ---- 3. edges that span several layers get one virtual node per crossed layer, so they take part in the ordering
  const isVirtual = (id: string): boolean => id.startsWith(VIRTUAL);
  const chains = new Map<number, string[]>();
  const preds2 = new Map<string, string[]>();
  const succ = new Map<string, string[]>();
  for (const n of nodes) {
    preds2.set(n.id, []);
    succ.set(n.id, []);
  }
  const link = (a: string, b: string): void => {
    (succ.get(a) ?? succ.set(a, []).get(a))?.push(b);
    (preds2.get(b) ?? preds2.set(b, []).get(b))?.push(a);
  };
  forward.forEach((e, i) => {
    const from = layerOf.get(e.from) ?? 0;
    const span = (layerOf.get(e.to) ?? 0) - from;
    if (span <= 1) {
      link(e.from, e.to);
      return;
    }
    const ids: string[] = [];
    let previous = e.from;
    for (let k = 1; k < span; k++) {
      const id = `${VIRTUAL}${i}.${k}`;
      (layers[from + k] as string[]).push(id);
      ids.push(id);
      link(previous, id);
      previous = id;
    }
    link(previous, e.to);
    chains.set(i, ids);
  });

  // ---- 4. order nodes inside the layers (barycenter sweeps)
  const position = new Map<string, number>();
  const index = () => layers.forEach((layer) => layer.forEach((id, i) => position.set(id, i)));
  index();
  const sweep = (down: boolean): void => {
    const order = down ? layers.map((_, i) => i) : layers.map((_, i) => layers.length - 1 - i);
    for (const l of order) {
      const layer = layers[l] as string[];
      const scores = new Map<string, number>();
      for (const id of layer) {
        const neighbours = (down ? preds2.get(id) : succ.get(id)) ?? [];
        scores.set(
          id,
          neighbours.length > 0
            ? neighbours.reduce((s, n) => s + (position.get(n) ?? 0), 0) / neighbours.length
            : (position.get(id) ?? 0),
        );
      }
      layer.sort((a, b) => (scores.get(a) ?? 0) - (scores.get(b) ?? 0) || a.localeCompare(b));
      layer.forEach((id, i) => position.set(id, i));
    }
  };
  for (let i = 0; i < 4; i++) {
    sweep(true);
    sweep(false);
  }

  // ---- 5. coordinates
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sizes = new Map<string, { w: number; h: number }>();
  for (const n of nodes) sizes.set(n.id, { w: widthOf(n), h: nodeHeight });
  const placed = new Map<string, PositionedNode>();

  // virtual nodes only reserve room across the layer, they have no extent along it
  const crossOf = (id: string): number =>
    isVirtual(id)
      ? VIRTUAL_CROSS
      : direction === 'LR'
        ? nodeHeight
        : (sizes.get(id) as { w: number }).w;
  const gapAfter = (id: string): number => (isVirtual(id) ? nodeGap / 2 : nodeGap);
  const alongOf = (id: string): number =>
    isVirtual(id) ? 0 : direction === 'LR' ? (sizes.get(id) as { w: number }).w : nodeHeight;
  const layerExtent = layers.map((layer) => layer.reduce((m, id) => Math.max(m, alongOf(id)), 0));
  const crossLength = layers.map(
    (layer) => layer.reduce((sum, id) => sum + crossOf(id) + gapAfter(id), 0) - nodeGap,
  );
  const maxCross = Math.max(0, ...crossLength);
  const slots = new Map<string, { x: number; y: number }>();

  let offset = margin;
  layers.forEach((layer, l) => {
    let cross = margin + (maxCross - (crossLength[l] as number)) / 2;
    const extent = layerExtent[l] as number;
    for (const id of layer) {
      if (isVirtual(id)) {
        const c = cross + VIRTUAL_CROSS / 2;
        slots.set(
          id,
          direction === 'LR' ? { x: offset + extent / 2, y: c } : { x: c, y: offset + extent / 2 },
        );
        cross += VIRTUAL_CROSS + gapAfter(id);
        continue;
      }
      const node = byId.get(id) as GraphNode;
      const size = sizes.get(id) as { w: number; h: number };
      const x = direction === 'LR' ? offset + (extent - size.w) / 2 : cross;
      const y = direction === 'LR' ? cross : offset + (extent - size.h) / 2;
      placed.set(id, { ...node, x, y, width: size.w, height: size.h, layer: l });
      cross += crossOf(id) + gapAfter(id);
    }
    offset += extent + layerGap;
  });

  const positioned = nodes.map((n) => placed.get(n.id) as PositionedNode);
  const width =
    (direction === 'LR' ? offset - layerGap : maxCross) + margin * (direction === 'LR' ? 1 : 2);
  const height =
    (direction === 'LR' ? maxCross : offset - layerGap) + margin * (direction === 'LR' ? 2 : 1);

  // ---- 6. edges: anchors on the node borders, plus the reserved slot in every crossed layer
  const positionedEdges: PositionedEdge[] = valid.map((e, i) => {
    const a = placed.get(e.from) as PositionedNode;
    const b = placed.get(e.to) as PositionedNode;
    const back = (layerOf.get(e.from) ?? 0) >= (layerOf.get(e.to) ?? 0);
    const chain = chains.get(i);
    if (!chain) return { ...e, back, points: route(a, b, direction) };
    // the chain runs in layer order; for a reversed edge that is from `to` back to `from`
    const reversedEdge = reversed.has(key(e.from, e.to));
    const [src, dst] = reversedEdge ? [b, a] : [a, b];
    const inner = chain.map((id) => slots.get(id) as { x: number; y: number });
    const [start, end] = [route(src, dst, direction)[0], route(src, dst, direction).at(-1)] as [
      { x: number; y: number },
      { x: number; y: number },
    ];
    const anchors = [start, ...inner, end];
    return { ...e, back, points: reversedEdge ? anchors.reverse() : anchors };
  });

  return {
    direction,
    nodes: positioned,
    edges: positionedEdges,
    width: Math.ceil(width),
    height: Math.ceil(height),
  };
}

/** Start and end anchor of an edge between two nodes (border midpoints facing each other). */
function route(
  a: PositionedNode,
  b: PositionedNode,
  direction: 'LR' | 'TB',
): { x: number; y: number }[] {
  if (direction === 'LR') {
    const forward = a.x + a.width <= b.x;
    return [
      { x: forward ? a.x + a.width : a.x, y: a.y + a.height / 2 },
      { x: forward ? b.x : b.x + b.width, y: b.y + b.height / 2 },
    ];
  }
  const forward = a.y + a.height <= b.y;
  return [
    { x: a.x + a.width / 2, y: forward ? a.y + a.height : a.y },
    { x: b.x + b.width / 2, y: forward ? b.y : b.y + b.height },
  ];
}
