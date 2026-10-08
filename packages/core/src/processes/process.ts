import type { CompletionEntry } from '../languages/shared/completion.js';
import type { Span } from '../languages/shared/line-index.js';
import {
  applySeverities,
  type Problem,
  type SeverityOverride,
} from '../languages/shared/problem.js';
import {
  attr,
  attrNode,
  parseXml,
  walk,
  xmlContextAt,
  type XmlDocument,
  type XmlElement,
} from '../xml/index.js';
import type { GraphEdge, GraphNode } from '../graph/layout.js';

/** One step of a business process definition. */
export interface ProcessNode {
  id: string;
  idSpan: Span;
  /** Element name: action, scriptAction, wait, split, join, notify, noop, end, … */
  kind: string;
  /** Spring bean of an `action`. */
  bean?: string;
  beanSpan?: Span;
  /** End state of an `end` node. */
  state?: string;
  span: Span;
}

export interface ProcessEdge {
  from: string;
  /** Target node id as written. */
  to: string;
  toSpan: Span;
  label?: string;
}

export interface ProcessDefinition {
  name?: string;
  start?: string;
  startSpan?: Span;
  onError?: string;
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  xml: XmlDocument;
}

/** Parses a business process definition (`<process …>`). Returns undefined for other XML. */
export function parseProcess(text: string): ProcessDefinition | undefined {
  const xml = parseXml(text);
  const root = xml.root;
  if (!root || root.name !== 'process') return undefined;

  const nodes: ProcessNode[] = [];
  const edges: ProcessEdge[] = [];
  const startNode = attrNode(root, 'start');

  for (const el of root.children) {
    const id = attrNode(el, 'id');
    if (!id) continue;
    nodes.push({
      id: id.value.trim(),
      idSpan: id.valueSpan,
      kind: el.name,
      bean: attr(el, 'bean')?.trim(),
      beanSpan: attrNode(el, 'bean')?.valueSpan,
      state: el.name === 'end' ? attr(el, 'state') : undefined,
      span: el.span,
    });
    collectEdges(el, id.value.trim(), edges);
  }
  return {
    name: attr(root, 'name'),
    start: startNode?.value.trim(),
    startSpan: startNode?.valueSpan,
    onError: attr(root, 'onError'),
    nodes,
    edges,
    xml,
  };
}

function collectEdges(el: XmlElement, from: string, edges: ProcessEdge[]): void {
  // `then="x"` on wait / join / notify / noop / choice, `to="x"` on transitions, `name="x"` on split targets
  const then = attrNode(el, 'then');
  if (then) edges.push({ from, to: then.value.trim(), toSpan: then.valueSpan });
  for (const child of el.children) {
    if (child.name === 'transition') {
      const to = attrNode(child, 'to');
      if (to)
        edges.push({ from, to: to.value.trim(), toSpan: to.valueSpan, label: attr(child, 'name') });
    } else if (child.name === 'targetNode') {
      const name = attrNode(child, 'name');
      if (name) edges.push({ from, to: name.value.trim(), toSpan: name.valueSpan });
    } else if (child.name === 'case') {
      for (const choice of child.children) {
        const choiceThen = attrNode(choice, 'then');
        if (choiceThen)
          edges.push({
            from,
            to: choiceThen.value.trim(),
            toSpan: choiceThen.valueSpan,
            label: attr(choice, 'id'),
          });
      }
    }
  }
}

export interface ProcessAnalyzeOptions {
  severities?: Record<string, SeverityOverride | undefined>;
  /** Checks that `bean` ids exist; omit to skip. */
  hasBean?: (id: string) => boolean;
}

export function analyzeProcess(
  def: ProcessDefinition,
  options: ProcessAnalyzeOptions = {},
): Problem[] {
  const problems: Problem[] = def.xml.problems.map((p) => ({
    span: p.span,
    severity: 'error',
    code: 'process.xml.syntax',
    message: p.message,
  }));
  const push = (p: Problem): void => void problems.push(p);
  const ids = new Map<string, ProcessNode>();

  for (const node of def.nodes) {
    if (ids.has(node.id))
      push({
        span: node.idSpan,
        severity: 'error',
        code: 'process.node.duplicate',
        message: `Node id "${node.id}" is used twice.`,
      });
    ids.set(node.id, node);
    if (node.kind === 'action' && !node.bean)
      push({
        span: node.idSpan,
        severity: 'error',
        code: 'process.action.no-bean',
        message: `Action "${node.id}" needs a bean="…" (the Spring bean that runs it).`,
      });
    if (node.bean && node.beanSpan && options.hasBean && !options.hasBean(node.bean)) {
      push({
        span: node.beanSpan,
        severity: 'info',
        code: 'process.bean.unknown',
        message: `No Spring bean "${node.bean}" in the loaded extensions (it may come from a packaged JAR).`,
      });
    }
  }

  if (!def.start) {
    push({
      span: def.xml.root?.nameSpan ?? { start: 0, end: 0 },
      severity: 'error',
      code: 'process.start.missing',
      message: 'The process has no start="…" node.',
    });
  } else if (!ids.has(def.start) && def.startSpan) {
    push({
      span: def.startSpan,
      severity: 'error',
      code: 'process.target.unknown',
      message: `Start node "${def.start}" does not exist.`,
    });
  }

  for (const edge of def.edges) {
    if (!ids.has(edge.to))
      push({
        span: edge.toSpan,
        severity: 'error',
        code: 'process.target.unknown',
        message: `No node "${edge.to}" in this process.`,
        data: { suggestion: closest(edge.to, [...ids.keys()]) },
      });
  }

  // reachability from the start node
  if (def.start && ids.has(def.start)) {
    const reachable = new Set<string>([def.start]);
    const queue = [def.start];
    while (queue.length > 0) {
      const current = queue.pop() as string;
      for (const e of def.edges) {
        if (e.from === current && ids.has(e.to) && !reachable.has(e.to)) {
          reachable.add(e.to);
          queue.push(e.to);
        }
      }
    }
    for (const node of def.nodes) {
      if (!reachable.has(node.id) && node.id !== def.onError) {
        push({
          span: node.idSpan,
          // an unreachable end node ("failed") is a common template leftover, other nodes are real dead code
          severity: node.kind === 'end' ? 'hint' : 'warning',
          code: 'process.node.unreachable',
          message: `"${node.id}" can never be reached from the start node.`,
          unnecessary: true,
        });
      }
    }
    if (!def.nodes.some((n) => n.kind === 'end' && reachable.has(n.id))) {
      push({
        span: def.startSpan ?? def.xml.root?.nameSpan ?? { start: 0, end: 0 },
        severity: 'warning',
        code: 'process.end.unreachable',
        message: 'No end node can be reached: the process would never finish.',
      });
    }
  }
  return applySeverities(problems, options.severities);
}

/** Nodes and edges for the diagram. */
export function processGraph(def: ProcessDefinition): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const known = new Set(def.nodes.map((n) => n.id));
  return {
    nodes: def.nodes.map((n) => ({
      id: n.id,
      label: n.id,
      kind:
        n.id === def.start
          ? 'start'
          : n.kind === 'end'
            ? `end-${(n.state ?? '').toLowerCase()}`
            : n.kind,
      detail: n.bean ?? (n.kind === 'end' ? n.state : n.kind === 'action' ? undefined : n.kind),
    })),
    edges: def.edges
      .filter((e) => known.has(e.to))
      .map((e) => ({ from: e.from, to: e.to, label: e.label })),
  };
}

function closest(word: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Math.min(3, Math.max(1, Math.floor(word.length / 3)));
  for (const c of candidates) {
    const d = distance(word.toLowerCase(), c.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best;
}

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j] as number;
      prev[j] = Math.min(
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = temp;
    }
  }
  return prev[b.length] as number;
}

// ------------------------------------------------------------------ editor features

const TARGET_ATTRIBUTES: Record<string, string[]> = {
  transition: ['to'],
  targetNode: ['name'],
  join: ['then'],
  wait: ['then'],
  notify: ['then'],
  noop: ['then'],
  choice: ['then'],
  process: ['start', 'onError'],
};

export function completeProcess(
  def: ProcessDefinition,
  offset: number,
  beanIds: readonly string[] = [],
): CompletionEntry[] {
  const context = xmlContextAt(def.xml, offset);
  if (context.kind === 'attribute-value') {
    const replace = { start: context.start, end: context.end };
    const element = context.element.name;
    const name = context.attribute.name;
    if (element === 'action' && name === 'bean')
      return beanIds.map((id) => ({ label: id, kind: 'value' as const, replace }));
    if (TARGET_ATTRIBUTES[element]?.includes(name)) {
      return def.nodes.map((n) => ({
        label: n.id,
        kind: 'value' as const,
        detail: n.kind,
        replace,
      }));
    }
    if (element === 'end' && name === 'state')
      return ['SUCCEEDED', 'FAILED', 'ERROR'].map((v) => ({
        label: v,
        kind: 'value' as const,
        replace,
      }));
  }
  return [];
}

export type ProcessTarget =
  { kind: 'node'; id: string; span: Span } | { kind: 'bean'; id: string; span: Span };

export function processTargetAt(def: ProcessDefinition, offset: number): ProcessTarget | undefined {
  for (const el of walk(def.xml.root)) {
    if (offset < el.startTag.start || offset > el.startTag.end) continue;
    for (const a of el.attributes) {
      if (offset < a.valueSpan.start || offset > a.valueSpan.end) continue;
      if (el.name === 'action' && a.name === 'bean')
        return { kind: 'bean', id: a.value.trim(), span: a.valueSpan };
      if (TARGET_ATTRIBUTES[el.name]?.includes(a.name))
        return { kind: 'node', id: a.value.trim(), span: a.valueSpan };
    }
  }
  return undefined;
}

export function fixesForProcess(
  problem: Problem,
): { title: string; span: Span; newText: string }[] {
  const suggestion = problem.data?.suggestion;
  return typeof suggestion === 'string'
    ? [{ title: `Change to "${suggestion}"`, span: problem.span, newText: suggestion }]
    : [];
}
