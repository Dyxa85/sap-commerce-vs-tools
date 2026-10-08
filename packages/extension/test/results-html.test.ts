import { describe, expect, it } from 'vitest';
import {
  esc,
  jsonForScript,
  renderResult,
  RENDER_PAGE_SIZE,
  type ResultModel,
} from '../src/ui/results-html.js';

const ctx = { nonce: 'N0NCE', cspSource: 'vscode-webview://x' };
const evil = '<img src=x onerror=alert(1)>"\'&';

function queryModel(rows: string[][], columns = ['c']): ResultModel {
  return {
    kind: 'query',
    title: 'T',
    connection: 'conn',
    sourceText: 'SELECT 1',
    result: { columns, rows, rowCount: rows.length, executionTimeMs: 3, raw: false },
  };
}

describe('esc', () => {
  it('escapes all html-significant characters', () => {
    expect(esc(evil)).toBe('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;');
  });
});

describe('renderResult', () => {
  it('sets a strict CSP bound to the nonce', () => {
    const html = renderResult(queryModel([['a']]), ctx);
    expect(html).toContain(
      "default-src 'none'; style-src 'nonce-N0NCE'; script-src 'nonce-N0NCE';",
    );
    expect(html).not.toMatch(/<script(?![^>]*(nonce="N0NCE"|type="application\/json"))/);
  });

  it('never emits unescaped database content', () => {
    const html = renderResult(queryModel([[evil]], [evil]), ctx);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('escapes titles, connection names and error text', () => {
    const html = renderResult(
      { kind: 'error', title: evil, connection: evil, message: evil, details: evil },
      ctx,
    );
    expect(html).not.toContain('<img');
  });

  it('paginates large result sets without losing rows', () => {
    const rows = Array.from({ length: RENDER_PAGE_SIZE + 5 }, (_, i) => [`r${i}`]);
    const html = renderResult(queryModel(rows), ctx);
    expect(html.match(/<tr><td>/g)).toHaveLength(RENDER_PAGE_SIZE);
    expect(html).toContain('Show more (5 remaining)');
    expect(html).toContain('r' + (RENDER_PAGE_SIZE + 4));
  });

  it('renders script output, failures and mode', () => {
    const html = renderResult(
      {
        kind: 'script',
        title: 'S',
        connection: 'c',
        committed: true,
        result: { result: '42', output: 'out', stacktrace: 'boom', failed: true },
      },
      ctx,
    );
    expect(html).toContain('commit mode');
    expect(html).toContain('boom');
    expect(html).toContain('42');
  });

  it('renders impex failure details', () => {
    const html = renderResult(
      {
        kind: 'impex',
        title: 'I',
        connection: 'c',
        action: 'import',
        result: {
          ok: false,
          level: 'error',
          message: 'Import has encountered problems.',
          details: 'line 1 # bad',
        },
      },
      ctx,
    );
    expect(html).toContain('✖');
    expect(html).toContain('line 1 # bad');
  });
});

describe('jsonForScript', () => {
  it('cannot terminate the script element', () => {
    expect(jsonForScript(['</script><script>alert(1)</script>'])).not.toContain('</script>');
  });

  it('round-trips', () => {
    const v = [['a<b', 'x y']];
    expect(JSON.parse(jsonForScript(v))).toEqual(v);
  });
});
