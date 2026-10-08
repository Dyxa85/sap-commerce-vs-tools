import type { ImpexResult, PkAnalysis, QueryResult, ScriptResult } from '@sapcommerce-vstools/core';

/** Pure HTML rendering for the results webview. All dynamic text is escaped; scripts/styles carry a nonce. */

export type ResultModel =
  | { kind: 'query'; title: string; connection: string; result: QueryResult; sourceText: string }
  | { kind: 'script'; title: string; connection: string; result: ScriptResult; committed: boolean }
  | {
      kind: 'impex';
      title: string;
      connection: string;
      result: ImpexResult;
      action: 'validate' | 'import';
    }
  | { kind: 'pk'; title: string; connection: string; result: PkAnalysis }
  | { kind: 'error'; title: string; connection?: string; message: string; details?: string };

export interface RenderContext {
  nonce: string;
  cspSource: string;
}

/** Rows rendered at once; the rest stays reachable through "Show more" (keeps the webview responsive). */
export const RENDER_PAGE_SIZE = 1000;

export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function csp(ctx: RenderContext): string {
  return `default-src 'none'; style-src 'nonce-${ctx.nonce}'; script-src 'nonce-${ctx.nonce}';`;
}

export function renderResult(model: ResultModel, ctx: RenderContext): string {
  const body = (() => {
    switch (model.kind) {
      case 'query':
        return renderQuery(model.result, model.sourceText);
      case 'script':
        return renderScript(model.result, model.committed);
      case 'impex':
        return renderImpex(model.result, model.action);
      case 'pk':
        return renderPk(model.result);
      case 'error':
        return renderError(model.message, model.details);
    }
  })();

  const connection = model.connection ? `<span class="chip">${esc(model.connection)}</span>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp(ctx)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${ctx.nonce}">${STYLES}</style></head>
<body>
<header><h1>${esc(model.title)}</h1>${connection}</header>
${body}
<script nonce="${ctx.nonce}">${SCRIPT}</script>
</body></html>`;
}

function renderQuery(result: QueryResult, sourceText: string): string {
  const shown = result.rows.slice(0, RENDER_PAGE_SIZE);
  const head = result.columns
    .map((c, i) => `<th data-col="${i}" tabindex="0" role="button">${esc(c)}</th>`)
    .join('');
  const rows = shown.map(renderRow).join('');
  const more =
    result.rows.length > shown.length
      ? `<button id="more" data-total="${result.rows.length}">Show more (${result.rows.length - shown.length} remaining)</button>`
      : '';
  const rowsJson =
    result.rows.length > shown.length ? jsonForScript(result.rows.slice(shown.length)) : '[]';
  return `<section class="meta">
<span>${result.rowCount} row${result.rowCount === 1 ? '' : 's'}</span>
<span>${result.executionTimeMs} ms</span>
${result.raw ? '<span>raw SQL</span>' : ''}
<input id="filter" type="search" placeholder="Filter rows…" aria-label="Filter rows">
<button data-export="csv">Export CSV</button><button data-export="json">Export JSON</button>
</section>
${
  result.columns.length === 0
    ? '<p class="empty">The query returned no columns.</p>'
    : `<div class="scroll"><table id="grid"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>${more}`
}
<script type="application/json" id="rest">${rowsJson}</script>
${sourceText ? `<details><summary>Executed text</summary><pre>${esc(sourceText)}</pre></details>` : ''}
${result.query && result.query !== sourceText ? `<details><summary>Generated SQL</summary><pre>${esc(result.query)}</pre></details>` : ''}`;
}

function renderRow(row: readonly string[]): string {
  return `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`;
}

function renderScript(result: ScriptResult, committed: boolean): string {
  return `<p class="mode ${committed ? 'warn' : ''}">${
    committed
      ? 'Executed in <b>commit mode</b>: changes were persisted.'
      : 'Executed in <b>rollback mode</b>: changes were not persisted.'
  }</p>
${result.failed ? `<h2>Error</h2><pre class="err">${esc(result.stacktrace)}</pre>` : ''}
<h2>Result</h2><pre>${esc(result.result || '(empty)')}</pre>
<h2>Output</h2><pre>${esc(result.output || '(no output)')}</pre>`;
}

function renderImpex(result: ImpexResult, action: 'validate' | 'import'): string {
  const label = action === 'validate' ? 'Validation' : 'Import';
  return `<p class="status ${result.ok ? 'ok' : 'bad'}" role="status">${result.ok ? '✔' : '✖'} ${esc(label)}: ${esc(result.message)}</p>
${result.details ? `<h2>Unresolved lines</h2><pre class="err">${esc(result.details)}</pre>` : ''}`;
}

function renderPk(r: PkAnalysis): string {
  const rows: [string, string][] = [
    ['PK', r.pk],
    ['Type', r.composedTypeCode ?? '(unknown)'],
    ['Type code', String(r.typeCode)],
    ['Cluster id', String(r.clusterId)],
    ['Counter based', r.counterBased ? 'yes' : 'no'],
    ['Created', r.creationDate ?? ''],
    ['Hex', r.hex ?? ''],
  ];
  return `<table class="kv"><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`;
}

function renderError(message: string, details?: string): string {
  return `<p class="status bad" role="alert">✖ ${esc(message)}</p>${details ? `<details open><summary>Details</summary><pre class="err">${esc(details)}</pre></details>` : ''}`;
}

/** JSON embedded in a script tag: neutralise `<` so a value can never close the tag. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(LINE_SEPARATOR, '\\u2028')
    .replace(PARAGRAPH_SEPARATOR, '\\u2029');
}

const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), 'g');
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), 'g');

const STYLES = `
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:12px 16px}
header{display:flex;align-items:center;gap:10px;margin-bottom:8px}h1{font-size:1.2em;margin:0}h2{font-size:1em;margin:14px 0 4px}
.chip{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-radius:10px;padding:1px 8px;font-size:.85em}
.meta{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:6px 0 10px;color:var(--vscode-descriptionForeground)}
input{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);padding:3px 6px}
button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:0;padding:3px 10px;cursor:pointer}
button:hover{background:var(--vscode-button-secondaryHoverBackground)}
.scroll{overflow:auto;max-height:calc(100vh - 150px)}
table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--vscode-editorWidget-border,#8884);padding:3px 8px;text-align:left;white-space:pre-wrap;word-break:break-word;vertical-align:top}
thead th{position:sticky;top:0;background:var(--vscode-editorWidget-background);cursor:pointer}thead th.asc::after{content:' ▲'}thead th.desc::after{content:' ▼'}
tbody tr:nth-child(even){background:var(--vscode-list-hoverBackground)}
table.kv th{width:12em;background:var(--vscode-editorWidget-background)}
pre{background:var(--vscode-textCodeBlock-background);padding:8px;overflow:auto;white-space:pre-wrap;word-break:break-word}
pre.err,.bad{color:var(--vscode-errorForeground)}.ok{color:var(--vscode-testing-iconPassed,var(--vscode-foreground))}
.status{font-weight:600}.mode.warn{color:var(--vscode-editorWarning-foreground)}.empty{color:var(--vscode-descriptionForeground)}
`;

/** Runs inside the webview: sort, filter, show-more, export requests. No remote access, no eval. */
const SCRIPT = `
(function(){
  const vscode = acquireVsCodeApi();
  const grid = document.getElementById('grid');
  const filter = document.getElementById('filter');
  const more = document.getElementById('more');
  const restEl = document.getElementById('rest');
  let rest = [];
  try { rest = JSON.parse(restEl ? restEl.textContent : '[]'); } catch (e) { rest = []; }

  function cellText(tr, i){ const c = tr.children[i]; return c ? c.textContent : ''; }
  function compare(a, b){
    const na = Number(a), nb = Number(b);
    if (a !== '' && b !== '' && !isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b, undefined, {numeric: true});
  }
  if (grid) {
    grid.tHead.addEventListener('click', onSort);
    grid.tHead.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(e); } });
  }
  function onSort(e){
    const th = e.target.closest('th'); if (!th) return;
    const col = Number(th.dataset.col);
    const dir = th.classList.contains('asc') ? 'desc' : 'asc';
    for (const h of grid.tHead.rows[0].cells) h.classList.remove('asc','desc');
    th.classList.add(dir);
    const rows = Array.from(grid.tBodies[0].rows);
    rows.sort(function(a, b){ const r = compare(cellText(a, col), cellText(b, col)); return dir === 'asc' ? r : -r; });
    for (const r of rows) grid.tBodies[0].appendChild(r);
  }
  if (filter) filter.addEventListener('input', function(){
    const q = filter.value.toLowerCase();
    for (const tr of grid.tBodies[0].rows) tr.hidden = q !== '' && !tr.textContent.toLowerCase().includes(q);
  });
  if (more) more.addEventListener('click', function(){
    const chunk = rest.splice(0, ${RENDER_PAGE_SIZE});
    for (const row of chunk) {
      const tr = document.createElement('tr');
      for (const v of row) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }
      grid.tBodies[0].appendChild(tr);
    }
    if (rest.length === 0) more.remove(); else more.textContent = 'Show more (' + rest.length + ' remaining)';
  });
  for (const b of document.querySelectorAll('[data-export]')) {
    b.addEventListener('click', function(){ vscode.postMessage({ type: 'export', format: b.dataset.export }); });
  }
})();
`;
