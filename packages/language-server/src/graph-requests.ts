import { pathToFileURL } from 'node:url';
import {
  describeType,
  graph,
  moduleGraph,
  processes,
  typeGraph,
  type ModuleScope,
} from '@sapcommerce-vstools/core';
import type { Connection } from 'vscode-languageserver/node';
import type { ProjectIndex } from './project-index.js';

/** Result of a diagram request: a ready SVG plus what the extension needs to react to clicks. */
export interface DiagramResult {
  svg: string;
  nodeCount: number;
  /** Set when the graph was cut at its size limit. */
  truncated?: boolean;
  /** Loaded extensions that are not part of the shown scope. */
  hidden?: number;
  /** Where each node leads to. Offsets for process nodes, file URIs for the others. */
  targets: Record<
    string,
    { uri?: string; position?: { line: number; character: number }; start?: number; end?: number }
  >;
}

const MAX_RENDERED_NODES = 400;

function render(
  nodes: Parameters<typeof graph.layoutGraph>[0],
  edges: Parameters<typeof graph.layoutGraph>[1],
  focus: string | undefined,
  direction: 'LR' | 'TB',
): string {
  const layout = graph.layoutGraph(nodes, edges, { direction });
  return graph.renderSvg(layout, { focus });
}

/** Requests that produce diagrams. The layout runs here so the webview only has to display the SVG. */
export function registerGraphRequests(connection: Connection, index: ProjectIndex): void {
  connection.onRequest(
    'sapcommerce/graph/type',
    (params: {
      name: string;
      uri?: string;
      subtypeDepth?: number;
      references?: boolean;
    }): DiagramResult | null => {
      const indexed = index.forUri(params.uri);
      if (!indexed) return null;
      const result = typeGraph(indexed.typeSystem, params.name, {
        subtypeDepth: params.subtypeDepth,
        references: params.references,
      });
      if (!result) return null;
      const targets: DiagramResult['targets'] = {};
      for (const node of result.nodes) {
        const location = describeType(indexed.typeSystem, node.id)?.location;
        if (location)
          targets[node.id] = { uri: pathToFileURL(location.file).href, position: location.start };
      }
      return {
        svg: render(result.nodes, result.edges, result.focus, 'LR'),
        nodeCount: result.nodes.length,
        truncated: result.truncated,
        targets,
      };
    },
  );

  connection.onRequest(
    'sapcommerce/graph/modules',
    (params: { scope: ModuleScope; uri?: string }): DiagramResult | null => {
      const indexed = index.forUri(params.uri);
      if (!indexed) return null;
      const result = moduleGraph(indexed.project, params.scope);
      const truncated = result.nodes.length > MAX_RENDERED_NODES;
      const nodes = truncated ? result.nodes.slice(0, MAX_RENDERED_NODES) : result.nodes;
      const shown = new Set(nodes.map((n) => n.id));
      const edges = result.edges.filter((e) => shown.has(e.from) && shown.has(e.to));
      const targets: DiagramResult['targets'] = {};
      for (const e of indexed.project.loaded) {
        if (shown.has(e.name)) targets[e.name] = { uri: pathToFileURL(e.infoFile).href };
      }
      return {
        svg: render(nodes, edges, undefined, 'TB'),
        nodeCount: nodes.length,
        truncated,
        hidden: result.hidden,
        targets,
      };
    },
  );

  connection.onRequest(
    'sapcommerce/graph/process',
    (params: { text: string }): DiagramResult | null => {
      const def = processes.parseProcess(params.text);
      if (!def) return null;
      const { nodes, edges } = processes.processGraph(def);
      const targets: DiagramResult['targets'] = {};
      for (const n of def.nodes) targets[n.id] = { start: n.idSpan.start, end: n.idSpan.end };
      return { svg: render(nodes, edges, def.start, 'LR'), nodeCount: nodes.length, targets };
    },
  );
}
