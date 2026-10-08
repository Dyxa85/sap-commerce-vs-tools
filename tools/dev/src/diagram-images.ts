/**
 * Writes the diagrams of the synthetic fixture project as standalone SVG files into `docs/images/` for the README.
 * They are produced by the same layout and renderer the extension uses, with a dark theme baked in.
 *
 *   pnpm --filter @sapcommerce-vstools/dev-tools run demo:images
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildTypeSystem,
  graph,
  loadPlatform,
  moduleGraph,
  processes,
  typeGraph,
} from '@sapcommerce-vstools/core';
import { DIAGRAM_STYLES } from '../../../packages/extension/src/ui/diagram-html.ts';

const repo = resolve(process.cwd(), '../..');
const root = join(repo, 'packages/test-fixtures/hybris');
const out = join(repo, 'docs/images');
mkdirSync(out, { recursive: true });

const THEME = `:root{--vscode-font-family:-apple-system,'Segoe UI',system-ui,sans-serif;--vscode-font-size:13px;--vscode-foreground:#cccccc;--vscode-editor-background:#1e1e1e;--vscode-editorWidget-background:#252526;--vscode-editorWidget-border:#5a5a5a;--vscode-focusBorder:#007fd4;--vscode-list-activeSelectionBackground:#094771;--vscode-list-activeSelectionForeground:#ffffff;--vscode-descriptionForeground:#9d9d9d;--vscode-charts-blue:#3794ff;--vscode-charts-orange:#d18616;--vscode-charts-purple:#b180d7;--vscode-charts-green:#89d185;--vscode-charts-red:#f14c4c;--vscode-charts-yellow:#cca700}`;

/** Wraps the renderer's SVG fragment: background, theme variables and the diagram stylesheet. */
function standalone(svg: string, title: string): string {
  const size = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const w = Number(size?.[1] ?? 800);
  const h = Number(size?.[2] ?? 400);
  const header = 30;
  const body = svg
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<defs>[\s\S]*?<\/defs>/, '');
  const marker =
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" class="arrowhead"/></marker></defs>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h + header}" width="${w}" height="${h + header}" role="img" aria-label="${title}">
<style>${THEME}${DIAGRAM_STYLES.replace(/body\{[^}]*\}|html,body\{[^}]*\}|header\{[^}]*\}|h1\{[^}]*\}|button[^{]*\{[^}]*\}|#viewport[^{]*\{[^}]*\}|#stage\{[^}]*\}|\.legend[^{]*\{[^}]*\}|\.tools\{[^}]*\}/g, '')}</style>
<rect width="100%" height="100%" rx="8" fill="#1e1e1e"/>
<text x="16" y="21" style="font-size:13px;font-weight:600;fill:#cccccc">${title}</text>
${marker}<g transform="translate(0 ${header})">${body}</g></svg>`;
}

function write(name: string, svg: string, title: string): void {
  writeFileSync(join(out, `${name}.svg`), standalone(svg, title));
  console.log(`wrote docs/images/${name}.svg`);
}

const project = await loadPlatform(root);
const types = await buildTypeSystem(project);

const t = typeGraph(types, 'Customer');
if (t) {
  write(
    'diagram-type',
    graph.renderSvg(graph.layoutGraph(t.nodes, t.edges), { focus: t.focus }),
    'Type diagram: Customer',
  );
}
const m = moduleGraph(project, { kind: 'custom' });
write(
  'diagram-modules',
  graph.renderSvg(graph.layoutGraph(m.nodes, m.edges, { direction: 'TB' })),
  'Extension dependencies',
);
const def = processes.parseProcess(
  readFileSync(
    join(root, 'bin/custom/acmeprocess/resources/processes/badge-award-process.xml'),
    'utf8',
  ),
);
if (def) {
  const p = processes.processGraph(def);
  write(
    'diagram-process',
    graph.renderSvg(graph.layoutGraph(p.nodes, p.edges), { focus: def.start }),
    'Business process: badgeAwardProcess',
  );
}
