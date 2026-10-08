import { csp, esc, type RenderContext } from './results-html.js';

/** Mirrors the server's `sapcommerce/types/describe` answer. */
export interface WireLocation {
  uri: string;
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface WireAttribute {
  qualifier: string;
  type: string;
  declaredIn: string;
  own: boolean;
  localized: boolean;
  optional?: boolean;
  unique?: boolean;
  read?: boolean;
  write?: boolean;
  search?: boolean;
  initial?: boolean;
  partOf?: boolean;
  persistence?: string;
  defaultValue?: string;
  description?: string;
  relation?: string;
  location?: WireLocation;
}

export interface WireType {
  name: string;
  kind: 'item' | 'enum' | 'collection' | 'map' | 'atomic' | 'relation' | 'bean' | 'bean-enum';
  extends?: string;
  abstract?: boolean;
  description?: string;
  jaloclass?: string;
  deployment?: { table?: string; typecode?: number };
  ancestors: string[];
  subtypes: string[];
  attributes: WireAttribute[];
  enumValues?: { code: string; description?: string }[];
  relation?: {
    source: string;
    sourceQualifier?: string;
    target: string;
    targetQualifier?: string;
    localized: boolean;
  };
  elementType?: string;
  extensions: string[];
  location?: WireLocation;
  incomplete?: boolean;
}

/** A name that can be a link to another type: letters, digits, dots/underscores/dollars only. */
const TYPE_NAME = /^[A-Za-z_$][\w$.]*$/;

function typeLink(name: string, known: ReadonlySet<string>): string {
  return known.has(name) ? `<a href="#" data-type="${esc(name)}">${esc(name)}</a>` : esc(name);
}

/** Splits `Collection<Foo>` / `localized:Foo` into linkable parts while escaping everything. */
function typeCell(type: string, known: ReadonlySet<string>): string {
  const parts = type.split(/([A-Za-z_$][\w$.]*)/g);
  return parts
    .map((part) => (TYPE_NAME.test(part) && known.has(part) ? typeLink(part, known) : esc(part)))
    .join('');
}

export function renderType(type: WireType, known: ReadonlySet<string>, ctx: RenderContext): string {
  const flags = (a: WireAttribute): string =>
    [
      a.unique ? 'unique' : '',
      a.optional === false ? 'mandatory' : '',
      a.localized ? 'localized' : '',
      a.write === false ? 'read-only' : '',
      a.partOf ? 'partOf' : '',
      a.initial ? 'initial' : '',
      a.search === false ? 'not searchable' : '',
    ]
      .filter(Boolean)
      .map((f) => `<span class="tag">${esc(f)}</span>`)
      .join(' ');

  const attributeRows = type.attributes
    .map((a) => {
      const open = a.location ? ` data-open='${esc(JSON.stringify(a.location))}'` : '';
      return `<tr class="${a.own ? 'own' : 'inherited'}"><td><a href="#"${open} class="q">${esc(a.qualifier)}</a></td><td>${typeCell(a.type, known)}</td><td>${typeLink(a.declaredIn, known)}</td><td>${flags(a)}</td><td>${esc(a.description ?? '')}${a.relation ? ` <em>(relation ${esc(a.relation)})</em>` : ''}</td></tr>`;
    })
    .join('');

  const chain = [type.name, ...type.ancestors]
    .map((n, i) => (i === 0 ? `<b>${esc(n)}</b>` : typeLink(n, known)))
    .join(' → ');

  const meta: string[] = [];
  if (type.deployment?.table)
    meta.push(
      `Table <code>${esc(type.deployment.table)}</code>${type.deployment.typecode !== undefined ? `, typecode ${type.deployment.typecode}` : ''}`,
    );
  if (type.jaloclass) meta.push(`Jalo class <code>${esc(type.jaloclass)}</code>`);
  if (type.extensions.length > 0)
    meta.push(`Defined in ${type.extensions.map((e) => `<code>${esc(e)}</code>`).join(', ')}`);

  const body: string[] = [];
  if (type.kind === 'item' || type.kind === 'relation' || type.kind === 'bean') {
    if (type.relation) {
      body.push(
        `<p>Relation: ${typeLink(type.relation.source, known)}${type.relation.sourceQualifier ? ` (<code>${esc(type.relation.sourceQualifier)}</code>)` : ''} ↔ ${typeLink(type.relation.target, known)}${type.relation.targetQualifier ? ` (<code>${esc(type.relation.targetQualifier)}</code>)` : ''}${type.relation.localized ? ' · localized' : ''}</p>`,
      );
    }
    body.push(`<p class="chain">${chain}</p>`);
    if (type.subtypes.length > 0) {
      body.push(
        `<details><summary>${type.subtypes.length} direct subtype${type.subtypes.length === 1 ? '' : 's'}</summary><p>${type.subtypes.map((s) => typeLink(s, known)).join(' · ')}</p></details>`,
      );
    }
    body.push(
      `<section class="meta"><input id="filter" type="search" placeholder="Filter attributes…" aria-label="Filter attributes"><label><input type="checkbox" id="own"> only own attributes</label><span id="count"></span></section>`,
    );
    body.push(
      `<div class="scroll"><table id="attrs"><thead><tr><th>Attribute</th><th>Type</th><th>Declared in</th><th>Modifiers</th><th>Description</th></tr></thead><tbody>${attributeRows}</tbody></table></div>`,
    );
  } else if (type.kind === 'enum' || type.kind === 'bean-enum') {
    body.push(
      `<table><thead><tr><th>Value</th><th>Description</th></tr></thead><tbody>${(type.enumValues ?? []).map((v) => `<tr><td><code>${esc(v.code)}</code></td><td>${esc(v.description ?? '')}</td></tr>`).join('')}</tbody></table>`,
    );
  } else if (type.kind === 'collection') {
    body.push(`<p>Collection of ${type.elementType ? typeLink(type.elementType, known) : ''}</p>`);
  } else if (type.kind === 'map' && type.description) {
    body.push(`<p>Map: ${typeCell(type.description, known)}</p>`);
  }

  const open = type.location ? ` data-open='${esc(JSON.stringify(type.location))}'` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp(ctx)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${ctx.nonce}">${STYLES}</style></head><body>
<header><h1>${esc(type.name)}</h1><span class="chip">${esc(type.kind)}${type.abstract ? ' · abstract' : ''}</span>${type.location ? ` <a href="#"${open} class="def">Go to definition</a>` : ''}</header>
${type.incomplete ? '<p class="warn">The declaration of this type (or of a parent) is not part of the loaded files; the attribute list may be incomplete.</p>' : ''}
${type.description ? `<p>${esc(type.description)}</p>` : ''}
${meta.length > 0 ? `<p class="metaline">${meta.join(' · ')}</p>` : ''}
${body.join('\n')}
<script nonce="${ctx.nonce}">${SCRIPT}</script></body></html>`;
}

const STYLES = `
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:12px 16px}
header{display:flex;align-items:center;gap:10px;margin-bottom:8px}h1{font-size:1.3em;margin:0}
a{color:var(--vscode-textLink-foreground);text-decoration:none}a:hover{text-decoration:underline}
.chip{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-radius:10px;padding:1px 8px;font-size:.85em}
.tag{background:var(--vscode-textBlockQuote-background);border-radius:3px;padding:0 5px;font-size:.85em;white-space:nowrap}
.metaline,.chain{color:var(--vscode-descriptionForeground)}.warn{color:var(--vscode-editorWarning-foreground)}
.meta{display:flex;gap:14px;align-items:center;margin:8px 0;color:var(--vscode-descriptionForeground)}
input[type=search]{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);padding:3px 6px}
.scroll{overflow:auto;max-height:calc(100vh - 220px)}
table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--vscode-editorWidget-border,#8884);padding:3px 8px;text-align:left;vertical-align:top}
thead th{position:sticky;top:0;background:var(--vscode-editorWidget-background)}
tr.inherited td:first-child a{opacity:.75}
code{font-family:var(--vscode-editor-font-family)}
`;

const SCRIPT = `
(function(){
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', function(e){
    const a = e.target.closest('a'); if (!a) return;
    e.preventDefault();
    if (a.dataset.type) vscode.postMessage({ type: 'show', name: a.dataset.type });
    else if (a.dataset.open) { try { vscode.postMessage({ type: 'open', location: JSON.parse(a.dataset.open) }); } catch (err) {} }
  });
  const table = document.getElementById('attrs'); if (!table) return;
  const filter = document.getElementById('filter'), own = document.getElementById('own'), count = document.getElementById('count');
  function apply(){
    const q = filter.value.toLowerCase(); let shown = 0;
    for (const tr of table.tBodies[0].rows) {
      const hide = (own.checked && !tr.classList.contains('own')) || (q !== '' && !tr.textContent.toLowerCase().includes(q));
      tr.hidden = hide; if (!hide) shown++;
    }
    count.textContent = shown + ' of ' + table.tBodies[0].rows.length + ' attributes';
  }
  filter.addEventListener('input', apply); own.addEventListener('change', apply); apply();
})();
`;
