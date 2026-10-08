import type { Layout, PositionedEdge } from './layout.js';

const esc = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** CSS-class safe token (the renderer never puts data into attribute names or unquoted values). */
const token = (value: string | undefined): string => (value ?? 'default').replace(/[^\w-]/g, '_');

export interface SvgOptions {
  /** Nodes with this id get the class "focus". */
  focus?: string;
}

/**
 * Renders a layout as an SVG fragment. Styling happens through CSS classes (`node`, `node-<kind>`, `edge`,
 * `edge-<kind>`, `back`, `focus`) so the host page can follow the editor theme. Node ids are exposed as
 * `data-id` for click handling.
 */
export function renderSvg(layout: Layout, options: SvgOptions = {}): string {
  const edges = layout.edges.map((e) => renderEdge(e, layout.direction)).join('');
  const nodes = layout.nodes
    .map((n) => {
      const cls = `node node-${token(n.kind)}${n.id === options.focus ? ' focus' : ''}`;
      const text = n.detail
        ? `<text class="label" x="${n.x + n.width / 2}" y="${n.y + n.height / 2 - 5}" text-anchor="middle">${esc(n.label)}</text><text class="detail" x="${n.x + n.width / 2}" y="${n.y + n.height / 2 + 11}" text-anchor="middle">${esc(n.detail)}</text>`
        : `<text class="label" x="${n.x + n.width / 2}" y="${n.y + n.height / 2 + 4}" text-anchor="middle">${esc(n.label)}</text>`;
      return `<g class="${cls}" data-id="${esc(n.id)}" tabindex="0" role="button"><title>${esc(n.id)}</title><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="6"/>${text}</g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" role="img">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" class="arrowhead"/></marker></defs>
${edges}${nodes}</svg>`;
}

function renderEdge(edge: PositionedEdge, direction: 'LR' | 'TB'): string {
  const pts = edge.points;
  const first = pts[0];
  if (!first || pts.length < 2) return '';
  // one cubic curve per pair of anchors, leaving and entering along the layer direction (like a flow chart)
  let path = `M ${first.x} ${first.y}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1] as { x: number; y: number };
    const q = pts[i] as { x: number; y: number };
    const dx = direction === 'LR' ? (q.x - p.x) / 2 : 0;
    const dy = direction === 'TB' ? (q.y - p.y) / 2 : 0;
    path += ` C ${p.x + dx} ${p.y + dy}, ${q.x - dx} ${q.y - dy}, ${q.x} ${q.y}`;
  }
  const cls = `edge edge-${token(edge.kind)}${edge.back ? ' back' : ''}`;
  // the label sits on the middle segment
  const m = Math.floor((pts.length - 1) / 2);
  const a = pts[m] as { x: number; y: number };
  const b = pts[m + 1] as { x: number; y: number };
  const label = edge.label
    ? `<text class="edge-label" x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 4}" text-anchor="middle">${esc(edge.label)}</text>`
    : '';
  return `<g class="${cls}"><path d="${path}" marker-end="url(#arrow)"/>${label}</g>`;
}
