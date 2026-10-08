import { csp, esc, type RenderContext } from './results-html.js';

export interface DiagramPage {
  title: string;
  /** SVG produced by `graph.renderSvg` (already escaped). */
  svg: string;
  /** One line of context under the title, e.g. "42 of 234 extensions". */
  subtitle?: string;
  /** Buttons shown in the toolbar; clicking posts `{ type: 'action', id }`. */
  actions?: { id: string; label: string }[];
  legend?: { kind: string; label: string }[];
}

export function renderDiagramPage(page: DiagramPage, ctx: RenderContext): string {
  const actions = (page.actions ?? [])
    .map((a) => `<button data-action="${esc(a.id)}">${esc(a.label)}</button>`)
    .join('');
  const legend = (page.legend ?? [])
    .map(
      (l) =>
        `<span class="legend-item"><svg width="14" height="14" aria-hidden="true"><g class="node node-${esc(l.kind.replace(/[^\w-]/g, '_'))}"><rect x="1" y="1" width="12" height="12" rx="3"/></g></svg>${esc(l.label)}</span>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp(ctx)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${ctx.nonce}">${DIAGRAM_STYLES}</style></head><body>
<header><h1>${esc(page.title)}</h1>${page.subtitle ? `<span class="sub">${esc(page.subtitle)}</span>` : ''}
<span class="tools">${actions}<button id="zoom-out" title="Zoom out" aria-label="Zoom out">−</button><button id="zoom-in" title="Zoom in" aria-label="Zoom in">+</button><button id="fit" title="Fit to window">Fit</button><button id="reset" title="Actual size">100%</button></span></header>
${legend ? `<div class="legend">${legend}</div>` : ''}
<div id="viewport" tabindex="0" aria-label="Diagram"><div id="stage">${page.svg}</div></div>
<script nonce="${ctx.nonce}">${SCRIPT}</script></body></html>`;
}

export const DIAGRAM_STYLES = `
html,body{height:100%}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:12px;padding:8px 14px;border-bottom:1px solid var(--vscode-editorWidget-border,#8884);flex-wrap:wrap}
h1{font-size:1.1em;margin:0}.sub{color:var(--vscode-descriptionForeground)}.tools{margin-left:auto;display:flex;gap:6px}
button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:0;padding:3px 10px;cursor:pointer;border-radius:2px}
button:hover{background:var(--vscode-button-secondaryHoverBackground)}
.legend{display:flex;gap:14px;padding:4px 14px;color:var(--vscode-descriptionForeground);flex-wrap:wrap}.legend-item{display:flex;align-items:center;gap:5px}
#viewport{flex:1;overflow:hidden;position:relative;cursor:grab;outline:none}#viewport.dragging{cursor:grabbing}
#stage{transform-origin:0 0;position:absolute;left:0;top:0}
svg text{font-family:var(--vscode-font-family);font-size:12px;fill:var(--vscode-foreground);pointer-events:none}
.node rect{fill:var(--vscode-editorWidget-background);stroke:var(--vscode-editorWidget-border,#888);stroke-width:1.2}
.node{cursor:pointer}.node:hover rect,.node:focus rect{stroke:var(--vscode-focusBorder);stroke-width:2}
.node .detail{fill:var(--vscode-descriptionForeground);font-size:10.5px}
.node-focus rect,.focus rect{fill:var(--vscode-list-activeSelectionBackground);stroke:var(--vscode-focusBorder);stroke-width:2}
.node-focus text,.focus text{fill:var(--vscode-list-activeSelectionForeground)}
.node-abstract rect{stroke-dasharray:5 3}
.node-enum rect{stroke:var(--vscode-charts-purple)}.node-relation rect{stroke:var(--vscode-charts-orange)}
.node-custom rect{stroke:var(--vscode-charts-blue);stroke-width:2}.node-platform rect{opacity:.75}
.node-start rect{stroke:var(--vscode-charts-green);stroke-width:2.2}
.node-end-succeeded rect{stroke:var(--vscode-charts-green);stroke-width:2.2}
.node-end-failed rect,.node-end-error rect{stroke:var(--vscode-charts-red);stroke-width:2.2}
.node-wait rect{stroke:var(--vscode-charts-yellow);stroke-width:1.8}
.node-split rect,.node-join rect{stroke:var(--vscode-charts-blue);stroke-width:1.8}
.node-scriptAction rect,.node-notify rect{stroke:var(--vscode-charts-purple);stroke-width:1.6}
.edge path{fill:none;stroke:var(--vscode-descriptionForeground,#888);stroke-width:1.3;opacity:.85}
.edge-reference path{stroke-dasharray:4 3;stroke:var(--vscode-charts-orange)}
.edge.back path{stroke-dasharray:2 3;stroke:var(--vscode-charts-red)}
.arrowhead{fill:var(--vscode-descriptionForeground,#888)}
.edge-label{font-size:10.5px;fill:var(--vscode-descriptionForeground)}
`;

const SCRIPT = `
(function(){
  const vscode = acquireVsCodeApi();
  const viewport = document.getElementById('viewport');
  const stage = document.getElementById('stage');
  const svg = stage.querySelector('svg');
  let scale = 1, x = 0, y = 0, touched = false;
  const apply = () => { stage.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')'; };
  const size = () => svg ? { w: svg.viewBox.baseVal.width || svg.clientWidth, h: svg.viewBox.baseVal.height || svg.clientHeight } : { w: 1, h: 1 };
  function fit(){
    const s = size(); const r = viewport.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return; // hidden or not laid out yet; the observer calls again
    scale = Math.min(1.5, Math.max(0.05, Math.min((r.width - 20) / s.w, (r.height - 20) / s.h)));
    x = (r.width - s.w * scale) / 2; y = Math.max(10, (r.height - s.h * scale) / 2); apply();
  }
  function zoom(f, cx, cy){
    touched = true;
    const r = viewport.getBoundingClientRect();
    cx = cx === undefined ? r.width / 2 : cx; cy = cy === undefined ? r.height / 2 : cy;
    const next = Math.min(4, Math.max(0.05, scale * f));
    x = cx - (cx - x) * (next / scale); y = cy - (cy - y) * (next / scale); scale = next; apply();
  }
  document.getElementById('zoom-in').addEventListener('click', () => zoom(1.25));
  document.getElementById('zoom-out').addEventListener('click', () => zoom(0.8));
  document.getElementById('fit').addEventListener('click', () => { touched = false; fit(); });
  document.getElementById('reset').addEventListener('click', () => { touched = true; scale = 1; x = 10; y = 10; apply(); });
  viewport.addEventListener('wheel', (e) => { e.preventDefault(); const r = viewport.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  let drag = null, moved = false;
  viewport.addEventListener('mousedown', (e) => { drag = { px: e.clientX, py: e.clientY, ox: x, oy: y }; moved = false; viewport.classList.add('dragging'); });
  window.addEventListener('mousemove', (e) => { if (!drag) return; const dx = e.clientX - drag.px, dy = e.clientY - drag.py; if (Math.abs(dx) + Math.abs(dy) > 3) { moved = true; touched = true; } x = drag.ox + dx; y = drag.oy + dy; apply(); });
  window.addEventListener('mouseup', () => { drag = null; viewport.classList.remove('dragging'); });
  function open(el){ const node = el.closest('.node'); if (node && node.dataset.id) vscode.postMessage({ type: 'node', id: node.dataset.id }); }
  viewport.addEventListener('click', (e) => { if (!moved) open(e.target); });
  viewport.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && document.activeElement) { e.preventDefault(); open(document.activeElement); } });
  for (const b of document.querySelectorAll('[data-action]')) b.addEventListener('click', () => vscode.postMessage({ type: 'action', id: b.dataset.action }));
  // the panel may be hidden or still without a size when the page loads: fit again until the user takes over
  new ResizeObserver(() => { if (!touched) fit(); }).observe(viewport);
  fit();
})();
`;
