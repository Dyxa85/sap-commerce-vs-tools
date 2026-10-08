import { csp, esc, type RenderContext } from './results-html.js';

/**
 * The page for managing connections. It is a static shell: all data arrives through `postMessage` and is put into the
 * page with `textContent`/`value`, never as HTML, so nothing from settings can inject markup.
 */
export function renderConnectionsPage(ctx: RenderContext): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp(ctx)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${esc(ctx.nonce)}">${STYLES}</style></head><body>
<h1>SAP Commerce – Connections</h1>
<section class="intro" aria-label="What a connection is for">
  <p>A <strong>connection</strong> tells the extension where the hybris Administration Console (<strong>hAC</strong>) of one
  SAP Commerce instance is. It is needed for everything that talks to a <em>running</em> system:</p>
  <ul>
    <li>run <strong>FlexibleSearch</strong> and <strong>SQL</strong> queries and see the results as a table</li>
    <li>run <strong>Groovy</strong> scripts (rolled back by default)</li>
    <li><strong>validate and import ImpEx</strong></li>
    <li><strong>PK analyzer</strong> and <strong>log levels</strong>, and read-only queries for AI tools (optional)</li>
  </ul>
  <p>The editors, the Commerce Project and CCv2 views, diagrams and the AI project tools work <strong>without</strong> a connection.
  Passwords are kept in VS Code's secret storage, never in settings.</p>
</section>
<div class="layout">
  <aside>
    <button id="new" type="button">+ New connection</button>
    <ul id="list" aria-label="Connections"></ul>
  </aside>
  <form id="form" autocomplete="off" novalidate>
    <h2 id="heading">New connection</h2>
    <label>Name <input id="name" maxlength="60" placeholder="Local, Dev, Stage …"></label>
    <div class="error" id="error-name"></div>
    <label>hAC address <input id="url" placeholder="https://localhost:9002/hac" spellcheck="false"></label>
    <div class="hint">The address of the hybris Administration Console, ending in <code>/hac</code>.</div>
    <div class="error" id="error-url"></div>
    <label>User name <input id="username" placeholder="admin" spellcheck="false"></label>
    <div class="error" id="error-username"></div>
    <label>Password <input id="password" type="password" autocomplete="new-password"></label>
    <div class="hint" id="password-hint">Asked for when you first use the connection if you leave it empty.</div>
    <label class="check"><input id="ignoreTlsErrors" type="checkbox"> Ignore certificate errors</label>
    <div class="hint">Only for a local instance with a self-signed certificate. Never for remote systems.</div>
    <label class="check"><input id="protected" type="checkbox"> Protected (production-like system)</label>
    <div class="hint">Every write – commit, import, log level – asks for confirmation first.</div>
    <details><summary>Advanced</summary>
      <label>Locale <input id="locale" placeholder="en"></label>
      <div class="error" id="error-locale"></div>
      <label>Data source <input id="dataSource" placeholder="master"></label>
      <div class="error" id="error-dataSource"></div>
    </details>
    <div class="actions">
      <button id="save" type="submit" class="primary">Save</button>
      <button id="test" type="button">Test connection</button>
      <button id="select" type="button">Use this connection</button>
      <button id="openHac" type="button">Open hAC</button>
      <button id="forget" type="button">Forget password</button>
      <button id="remove" type="button" class="danger">Remove</button>
    </div>
    <div id="status" role="status" aria-live="polite"></div>
  </form>
</div>
<script nonce="${esc(ctx.nonce)}">${SCRIPT}</script></body></html>`;
}

const STYLES = `
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:16px 24px;max-width:1000px}
h1{font-size:1.4em;margin:0 0 8px}h2{font-size:1.1em;margin:0 0 12px}
.intro{background:var(--vscode-textBlockQuote-background);border-left:3px solid var(--vscode-textBlockQuote-border,var(--vscode-focusBorder));padding:4px 14px;margin:8px 0 18px}
.intro p{margin:8px 0}.intro ul{margin:6px 0 6px 18px;padding:0}
.layout{display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap}
aside{width:240px;flex:none}form{flex:1;min-width:320px;max-width:560px}
ul#list{list-style:none;margin:10px 0 0;padding:0}
ul#list li{padding:6px 8px;border-radius:3px;cursor:pointer;display:flex;flex-direction:column}
ul#list li:hover{background:var(--vscode-list-hoverBackground)}
ul#list li.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}
ul#list li .sub{font-size:.85em;opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
ul#list li:focus{outline:1px solid var(--vscode-focusBorder)}
label{display:block;margin-top:10px}label.check{display:flex;gap:8px;align-items:center}
input:not([type=checkbox]){display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:4px 6px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent)}
input:focus{outline:1px solid var(--vscode-focusBorder)}
.hint{font-size:.85em;color:var(--vscode-descriptionForeground);margin:2px 0 0 0}
.error{font-size:.85em;color:var(--vscode-errorForeground);min-height:0}
details{margin-top:12px}summary{cursor:pointer}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}
button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:0;padding:5px 12px;cursor:pointer;border-radius:2px}
button:hover{background:var(--vscode-button-secondaryHoverBackground)}
button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
button.primary:hover{background:var(--vscode-button-hoverBackground)}
button:disabled{opacity:.5;cursor:default}
#status{margin-top:14px;min-height:1.4em}#status.ok{color:var(--vscode-testing-iconPassed,#89d185)}#status.bad{color:var(--vscode-errorForeground)}
aside>button{width:100%}
`;

const SCRIPT = `
(function(){
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const fields = ['name','url','username','locale','dataSource'];
  let state = { connections: [], activeId: undefined };
  let selected; // an id, or null for a new connection
  let shown; // what the form was filled for

  const current = () => state.connections.find((c) => c.id === selected);

  function setStatus(text, kind){ const s = $('status'); s.textContent = text || ''; s.className = kind || ''; }
  function clearErrors(){ for (const f of fields) $('error-' + f).textContent = ''; }

  function fill(){
    const c = current();
    shown = selected;
    clearErrors();
    $('heading').textContent = c ? 'Edit "' + c.name + '"' : 'New connection';
    $('name').value = c ? c.name : (state.connections.length ? '' : 'Local');
    $('url').value = c ? c.url : 'https://localhost:9002/hac';
    $('username').value = c ? c.username : 'admin';
    $('password').value = '';
    $('password-hint').textContent = c
      ? (c.hasPassword ? 'A password is stored. Type a new one to replace it.' : 'No password stored yet. It is asked for on first use, or enter it here.')
      : 'Asked for when you first use the connection if you leave it empty.';
    $('ignoreTlsErrors').checked = !!(c && c.ignoreTlsErrors);
    $('protected').checked = !!(c && c.protected);
    $('locale').value = c && c.locale ? c.locale : '';
    $('dataSource').value = c && c.dataSource ? c.dataSource : '';
    for (const id of ['test','select','openHac','forget','remove']) $(id).disabled = !c;
    $('select').disabled = !c || state.activeId === c.id;
    $('forget').disabled = !c || !c.hasPassword;
  }

  function renderList(){
    const list = $('list');
    list.textContent = '';
    for (const c of state.connections) {
      const li = document.createElement('li');
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      if (c.id === selected) li.className = 'selected';
      const title = document.createElement('span');
      title.textContent = (c.id === state.activeId ? '● ' : '') + c.name + (c.protected ? ' 🛡' : '');
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = c.username + ' @ ' + c.url;
      li.append(title, sub);
      const choose = () => { selected = c.id; setStatus(''); renderList(); fill(); };
      li.addEventListener('click', choose);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
      list.appendChild(li);
    }
    if (!state.connections.length) {
      const li = document.createElement('li');
      li.textContent = 'No connection yet';
      li.style.opacity = '.7';
      li.style.cursor = 'default';
      list.appendChild(li);
    }
  }

  function form(){
    return {
      type: 'save',
      originalId: selected || undefined,
      name: $('name').value, url: $('url').value, username: $('username').value, password: $('password').value,
      ignoreTlsErrors: $('ignoreTlsErrors').checked, protected: $('protected').checked,
      locale: $('locale').value, dataSource: $('dataSource').value,
    };
  }

  $('new').addEventListener('click', () => { selected = null; setStatus(''); renderList(); fill(); $('name').focus(); });
  $('form').addEventListener('submit', (e) => { e.preventDefault(); clearErrors(); setStatus('Saving…'); vscode.postMessage(form()); });
  $('test').addEventListener('click', () => { setStatus('Connecting…'); vscode.postMessage({ type: 'test', id: selected }); });
  $('select').addEventListener('click', () => vscode.postMessage({ type: 'select', id: selected }));
  $('openHac').addEventListener('click', () => vscode.postMessage({ type: 'openHac', id: selected }));
  $('forget').addEventListener('click', () => vscode.postMessage({ type: 'forgetPassword', id: selected }));
  $('remove').addEventListener('click', () => vscode.postMessage({ type: 'remove', id: selected }));

  window.addEventListener('message', (event) => {
    const m = event.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'state') {
      state = { connections: Array.isArray(m.connections) ? m.connections : [], activeId: m.activeId };
      if (selected === undefined) selected = m.selectedId !== undefined ? m.selectedId : (state.activeId || (state.connections[0] && state.connections[0].id) || null);
      if (selected && !current()) selected = state.connections[0] ? state.connections[0].id : null;
      renderList();
      if (shown !== selected || shown === undefined) fill();
      else { $('select').disabled = !current() || state.activeId === selected; $('forget').disabled = !current() || !current().hasPassword; }
    } else if (m.type === 'selected') {
      selected = m.id; renderList(); fill();
    } else if (m.type === 'result') {
      if (m.field && fields.includes(m.field)) { setStatus(''); $('error-' + m.field).textContent = m.message; $(m.field).focus(); }
      else setStatus(m.message, m.ok ? 'ok' : 'bad');
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
`;
