/**
 * Writes the diagram pages of the extension for the synthetic fixture project as plain HTML files into `.demo/`, with
 * the VS Code colour variables and `acquireVsCodeApi` stubbed, so layout, zoom and clicks can be looked at in any
 * browser. (A webview cannot be screenshotted by tests; this is how the diagrams were checked visually.)
 *
 *   pnpm --filter @sapcommerce-vstools/dev-tools run demo:diagrams
 *   python3 -m http.server --directory .demo 8765     # then open http://127.0.0.1:8765/diagram-process.html
 *
 * Pass a `hybris` directory as the first argument to draw your own project instead of the fixture.
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
import { renderDiagramPage } from '../../../packages/extension/src/ui/diagram-html.ts';

// the script runs with the package directory (tools/dev) as working directory
const repo = resolve(process.cwd(), '../..');
const root = resolve(process.argv[2] ?? join(repo, 'packages/test-fixtures/hybris'));
const out = join(repo, '.demo');
mkdirSync(out, { recursive: true });

const THEME = `:root{--vscode-font-family:system-ui;--vscode-font-size:13px;--vscode-foreground:#ccc;--vscode-editor-background:#1e1e1e;--vscode-editorWidget-background:#252526;--vscode-editorWidget-border:#454545;--vscode-focusBorder:#007fd4;--vscode-list-activeSelectionBackground:#094771;--vscode-list-activeSelectionForeground:#fff;--vscode-descriptionForeground:#9d9d9d;--vscode-button-secondaryBackground:#3a3d41;--vscode-button-secondaryForeground:#fff;--vscode-button-secondaryHoverBackground:#45494e;--vscode-charts-blue:#3794ff;--vscode-charts-orange:#d18616;--vscode-charts-purple:#b180d7;--vscode-charts-green:#89d185;--vscode-charts-red:#f14c4c;--vscode-charts-yellow:#cca700}`;
const STUB = `<style>${THEME}</style><script>window.__msgs=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.__msgs.push(m)});</script>`;

function write(name: string, page: Parameters<typeof renderDiagramPage>[0]): void {
  const html = renderDiagramPage(page, { nonce: 'demo', cspSource: 'vscode-webview://demo' })
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
    .replace('<head>', `<head>${STUB}`);
  writeFileSync(join(out, `diagram-${name}.html`), html);
  console.log(`wrote .demo/diagram-${name}.html`);
}

const project = await loadPlatform(root);
const types = await buildTypeSystem(project);

const focus = types.items.has('Customer') ? 'Customer' : [...types.items.keys()][0];
const t = focus ? typeGraph(types, focus) : undefined;
if (t) {
  write('type', {
    title: `Type diagram: ${focus}`,
    subtitle: `${t.nodes.length} types`,
    svg: graph.renderSvg(graph.layoutGraph(t.nodes, t.edges), { focus: t.focus }),
  });
}

const m = moduleGraph(project, { kind: 'custom' });
write('modules', {
  title: 'Extension dependencies',
  subtitle: `${m.nodes.length} extensions`,
  svg: graph.renderSvg(graph.layoutGraph(m.nodes, m.edges, { direction: 'TB' })),
  legend: [
    { kind: 'custom', label: 'custom' },
    { kind: 'platform', label: 'platform' },
  ],
});

const processFile = join(
  root,
  'bin/custom/acmeprocess/resources/processes/badge-award-process.xml',
);
try {
  const def = processes.parseProcess(readFileSync(processFile, 'utf8'));
  if (def) {
    const p = processes.processGraph(def);
    write('process', {
      title: 'Business process',
      subtitle: `${p.nodes.length} nodes`,
      svg: graph.renderSvg(graph.layoutGraph(p.nodes, p.edges), { focus: def.start }),
    });
  }
} catch {
  console.log('no process file in this project, skipped');
}
