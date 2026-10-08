import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockHac, type MockHacServer } from '@sapcommerce-vstools/mock-hac';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  HacAuthError,
  HacClient,
  HacConnectionError,
  HacQueryError,
  type HacClientOptions,
} from '../src/index.js';

const USER = 'mock-user';
const PASS = 'mock-pass';

let server: MockHacServer;
let baseUrl: string;
const clients: HacClient[] = [];

function client(overrides: Partial<HacClientOptions> = {}): HacClient {
  const c = new HacClient({ baseUrl, username: USER, password: PASS, ...overrides });
  clients.push(c);
  return c;
}

beforeAll(async () => {
  server = createMockHac();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hac`;
});

afterAll(async () => {
  clients.forEach((c) => c.dispose());
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('login', () => {
  it('logs in with valid credentials', async () => {
    await expect(client().login()).resolves.toBeUndefined();
  });

  it('throws HacAuthError for wrong credentials and never leaks the password', async () => {
    const secret = 'super-secret-pw';
    const err = await client({ password: secret })
      .login()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HacAuthError);
    expect(String((err as Error).message)).not.toContain(secret);
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain(secret);
  });

  it('reports an unreachable host as HacConnectionError', async () => {
    const err = await client({ baseUrl: 'http://127.0.0.1:9/hac', timeoutMs: 2000 })
      .login()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HacConnectionError);
  });

  it('logs out', async () => {
    const c = client();
    await c.login();
    await expect(c.logout()).resolves.toBeUndefined();
  });
});

describe('queries', () => {
  it('maps FlexibleSearch results', async () => {
    const result = await client().flexibleSearch({
      query: 'SELECT {pk}, {isocode} FROM {Language}',
      maxCount: 2,
    });
    expect(result.rows).toEqual([['en'], ['de']]);
    expect(result.columns).toEqual(['P_ISOCODE']);
    expect(result.rowCount).toBe(2);
    expect(result.raw).toBe(false);
  });

  it('maps raw SQL results', async () => {
    const result = await client().sql({ query: 'SELECT p_isocode FROM languages' });
    expect(result.raw).toBe(true);
    expect(result.rows).toHaveLength(3);
  });

  it('turns server-side errors into HacQueryError', async () => {
    const err = await client()
      .flexibleSearch({ query: 'SELECT {x} FROM {Nope}' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HacQueryError);
    expect((err as HacQueryError).message).toContain('unknown type');
  });
});

describe('scripts', () => {
  it('returns result and output', async () => {
    const r = await client().executeScript({ script: 'println "hi"; return 6*7' });
    expect(r).toMatchObject({ result: '42', output: 'hi\n', failed: false });
  });

  it('flags failed scripts via stacktrace', async () => {
    const r = await client().executeScript({ script: 'throw new RuntimeException()' });
    expect(r.failed).toBe(true);
    expect(r.stacktrace).toContain('RuntimeException');
  });
});

describe('impex', () => {
  it('validates a good script', async () => {
    const r = await client().validateImpex('INSERT_UPDATE Language;isocode[unique=true]\n;en\n');
    expect(r).toEqual({ ok: true, level: 'notice', message: 'Import script is valid' });
  });

  it('reports invalid scripts with the decoded message', async () => {
    const r = await client().validateImpex('INSERT_UPDATE NoSuchType;code[unique=true]\n');
    expect(r.ok).toBe(false);
    expect(r.message).toContain("unknown type 'NoSuchType'");
  });

  it('returns the unresolved lines of a failed import as details', async () => {
    const r = await client().importImpex('INSERT_UPDATE NoSuchType;code[unique=true]\n;x\n');
    expect(r.ok).toBe(false);
    expect(r.details).toContain("unknown type 'NoSuchType'");
  });

  it('imports', async () => {
    const r = await client().importImpex('# nothing\n');
    expect(r.ok).toBe(true);
    expect(r.message).toBe('Import finished successfully');
  });
});

describe('loggers', () => {
  it('lists and changes levels', async () => {
    const c = client();
    const before = await c.listLoggers();
    expect(before.find((l) => l.name === 'root')?.level).toBe('WARN');

    await c.setLoggerLevel('com.example.test', 'DEBUG');
    const after = await c.listLoggers();
    expect(after.find((l) => l.name === 'com.example.test')?.level).toBe('DEBUG');
  });

  it('rejects invalid logger names before sending', async () => {
    await expect(client().setLoggerLevel('bad name;', 'INFO')).rejects.toBeInstanceOf(
      HacQueryError,
    );
  });
});

describe('session handling', () => {
  it('re-authenticates once when the session was lost', async () => {
    const c = client();
    await c.flexibleSearch({ query: 'SELECT {pk} FROM {Language}' });
    const rejectedBefore = server.rejectedCount;

    server.expireSessions();
    const r = await c.flexibleSearch({ query: 'SELECT {pk} FROM {Language}' });

    expect(r.rowCount).toBe(3);
    expect(server.rejectedCount).toBe(rejectedBefore + 1);
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const err = await client()
      .flexibleSearch({ query: 'SELECT {pk} FROM {Language}' }, controller.signal)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HacConnectionError);
  });
});

describe('tls', () => {
  let dir = '';
  let tlsServer: MockHacServer | undefined;
  let tlsUrl = '';

  beforeAll(async () => {
    try {
      dir = mkdtempSync(join(tmpdir(), 'sapc-tls-'));
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-keyout',
          join(dir, 'k.pem'),
          '-out',
          join(dir, 'c.pem'),
          '-days',
          '2',
          '-subj',
          '/CN=localhost',
        ],
        { stdio: 'ignore' },
      );
      tlsServer = createMockHac({
        tls: {
          key: readFileSync(join(dir, 'k.pem'), 'utf8'),
          cert: readFileSync(join(dir, 'c.pem'), 'utf8'),
        },
      });
      await new Promise<void>((resolve) => tlsServer!.listen(0, '127.0.0.1', resolve));
      tlsUrl = `https://127.0.0.1:${(tlsServer.address() as AddressInfo).port}/hac`;
    } catch {
      tlsServer = undefined; // openssl unavailable: TLS tests are skipped below
    }
  });

  afterAll(async () => {
    if (tlsServer) await new Promise<void>((resolve) => tlsServer!.close(() => resolve()));
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a self-signed certificate by default, with a helpful hint', async (ctx) => {
    if (!tlsServer) return ctx.skip();
    const err = await client({ baseUrl: tlsUrl })
      .login()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HacConnectionError);
    expect((err as Error).message).toContain('ignore TLS errors');
  });

  it('accepts it when the connection opts out of verification', async (ctx) => {
    if (!tlsServer) return ctx.skip();
    const r = await client({ baseUrl: tlsUrl, ignoreTlsErrors: true }).sql({
      query: 'SELECT p_isocode FROM languages',
    });
    expect(r.rowCount).toBe(3);
  });
});
