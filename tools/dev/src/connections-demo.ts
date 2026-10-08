/**
 * Renders the connections page as a plain HTML file in `.demo/` with the VS Code colour variables and a fake
 * `acquireVsCodeApi` that answers "ready" with two example connections, so the page can be looked at in a browser.
 *
 *   pnpm --filter @sapcommerce-vstools/dev-tools run demo:connections
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderConnectionsPage } from '../../../packages/extension/src/ui/connections-html.ts';

const out = join(resolve(process.cwd(), '../..'), '.demo');
mkdirSync(out, { recursive: true });

const THEME = `:root{--vscode-font-family:system-ui;--vscode-font-size:13px;--vscode-foreground:#ccc;--vscode-editor-background:#1e1e1e;--vscode-descriptionForeground:#9d9d9d;--vscode-focusBorder:#007fd4;--vscode-errorForeground:#f48771;--vscode-input-background:#3c3c3c;--vscode-input-foreground:#ccc;--vscode-button-background:#0e639c;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#1177bb;--vscode-button-secondaryBackground:#3a3d41;--vscode-button-secondaryForeground:#fff;--vscode-button-secondaryHoverBackground:#45494e;--vscode-list-hoverBackground:#2a2d2e;--vscode-list-activeSelectionBackground:#094771;--vscode-list-activeSelectionForeground:#fff;--vscode-textBlockQuote-background:#2b2b2b;--vscode-textBlockQuote-border:#007fd4}`;
const STUB = `<style>${THEME}</style><script>
window.acquireVsCodeApi = () => ({ postMessage: (m) => {
  if (m.type === 'ready') setTimeout(() => window.postMessage({ type: 'state', activeId: 'local',
    connections: [
      { id: 'local', name: 'Local', url: 'https://localhost:9002/hac', username: 'admin', ignoreTlsErrors: true, protected: false, hasPassword: true },
      { id: 'stage', name: 'Stage', url: 'https://stage.example.com/hac', username: 'dev-user', ignoreTlsErrors: false, protected: true, hasPassword: false } ] }, '*'), 0);
  if (m.type === 'test') setTimeout(() => window.postMessage({ type: 'result', ok: true, message: 'Connected to "Local" as admin.' }, '*'), 200);
  if (m.type === 'save') setTimeout(() => window.postMessage({ type: 'result', ok: false, field: 'url', message: 'Enter the hAC address, e.g. https://localhost:9002/hac (no user name or password in it).' }, '*'), 100);
} });
</script>`;

const html = renderConnectionsPage({ nonce: 'demo', cspSource: 'vscode-webview://demo' })
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  .replace('<head>', `<head>${STUB}`);
writeFileSync(join(out, 'connections.html'), html);
console.log('wrote .demo/connections.html');
