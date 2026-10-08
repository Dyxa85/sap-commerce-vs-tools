import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockHac } from '../src/index.ts';

let base = '';
let cookie = '';
const server = createMockHac();

/** Response bodies of the mocked console endpoints. */
interface Body {
  exception: unknown;
  resultList: string[][];
  resultCount: number;
  rawExecution: boolean;
  stacktraceText: string;
}
const json = async (res: Response): Promise<Body> => (await res.json()) as Body;

const csrfOf = (html: string): string =>
  /<meta name="_csrf" content="([^"]+)"/.exec(html)?.[1] ?? '';

async function csrfFrom(path: string): Promise<string> {
  const res = await fetch(`${base}/hac${path}`, { headers: { cookie } });
  return csrfOf(await res.text());
}

async function post(path: string, form: Record<string, string>, csrf?: string): Promise<Response> {
  return fetch(`${base}/hac${path}`, {
    method: 'POST',
    headers: {
      cookie,
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
    },
    body: new URLSearchParams(form),
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const login = await fetch(`${base}/hac/login`);
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const res = await fetch(`${base}/hac/j_spring_security_check`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      j_username: 'mock-user',
      j_password: 'mock-pass',
      _csrf: csrfOf(await login.text()),
    }),
  });
  expect(res.status).toBe(302);
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const flexForm = (query: string, extra: Record<string, string> = {}) => ({
  flexibleSearchQuery: query,
  sqlQuery: '',
  maxCount: '200',
  user: 'mock-user',
  locale: 'en',
  dataSource: 'master',
  commit: 'false',
  ...extra,
});

describe('csrf / session guard', () => {
  it('answers 405 without csrf header (like the real hAC)', async () => {
    expect((await post('/console/flexsearch/execute', flexForm('SELECT 1'))).status).toBe(405);
  });

  it('answers 405 with a wrong csrf header', async () => {
    const res = await post('/console/flexsearch/execute', flexForm('SELECT 1'), 'bogus');
    expect(res.status).toBe(405);
  });

  it('answers 405 without a session', async () => {
    const res = await fetch(`${base}/hac/console/flexsearch/execute`, { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('flexible search / sql', () => {
  it('returns rows and headers for a known type, honouring maxCount', async () => {
    const csrf = await csrfFrom('/console/flexsearch');
    const res = await post(
      '/console/flexsearch/execute',
      flexForm('SELECT {pk}, {isocode} FROM {Language}', { maxCount: '2' }),
      csrf,
    );
    const body = await json(res);
    expect(body.exception).toBeNull();
    expect(body.resultList).toEqual([['en'], ['de']]);
    expect(body.resultCount).toBe(2);
    expect(body.rawExecution).toBe(false);
  });

  it('reports errors with HTTP 200 and an exception object', async () => {
    const csrf = await csrfFrom('/console/flexsearch');
    const res = await post('/console/flexsearch/execute', flexForm('SELECT {x} FROM {Nope}'), csrf);
    expect(res.status).toBe(200);
    expect((await json(res)).exception).not.toBeNull();
  });

  it('runs raw SQL when only sqlQuery is set', async () => {
    const csrf = await csrfFrom('/console/flexsearch');
    const res = await post(
      '/console/flexsearch/execute',
      flexForm('', { sqlQuery: 'SELECT p_isocode FROM languages' }),
      csrf,
    );
    const body = await json(res);
    expect(body.rawExecution).toBe(true);
    expect(body.resultList).toHaveLength(3);
  });
});

describe('scripting', () => {
  it('returns output and result', async () => {
    const csrf = await csrfFrom('/console/scripting');
    const res = await post(
      '/console/scripting/execute',
      { script: 'println "hi"; return 6*7', scriptType: 'groovy', commit: 'false' },
      csrf,
    );
    expect(await json(res)).toEqual({
      executionResult: '42',
      outputText: 'hi\n',
      stacktraceText: '',
    });
  });

  it('returns a stacktrace when the script throws', async () => {
    const csrf = await csrfFrom('/console/scripting');
    const res = await post(
      '/console/scripting/execute',
      { script: 'throw new RuntimeException()', scriptType: 'groovy', commit: 'false' },
      csrf,
    );
    expect((await json(res)).stacktraceText).toContain('RuntimeException');
  });
});

describe('impex', () => {
  const impexForm = (script: string) => ({
    scriptContent: script,
    validationEnum: 'IMPORT_STRICT',
    encoding: 'UTF-8',
    maxThreads: '1',
  });

  it('validates a good script', async () => {
    const csrf = await csrfFrom('/console/impex/import');
    const res = await post(
      '/console/impex/import/validate',
      impexForm('INSERT_UPDATE Language;isocode[unique=true]\n;en\n'),
      csrf,
    );
    const html = await res.text();
    expect(html).toContain('id="validationResultMsg" data-level="notice"');
    expect(html).toContain('Import script is valid');
  });

  it('flags unknown types and escapes the message', async () => {
    const csrf = await csrfFrom('/console/impex/import');
    const res = await post(
      '/console/impex/import/validate',
      impexForm('INSERT_UPDATE NoSuchType;code[unique=true]\n;x\n'),
      csrf,
    );
    const html = await res.text();
    expect(html).toContain('data-level="error"');
    expect(html).toContain('unknown type &#39;NoSuchType&#39;');
  });

  it('imports with the impexResult tag', async () => {
    const csrf = await csrfFrom('/console/impex/import');
    const res = await post('/console/impex/import', impexForm('# nothing\n'), csrf);
    const html = await res.text();
    expect(html).toContain('id="impexResult" data-level="notice"');
    expect(html).toContain('Import finished successfully');
  });
});
