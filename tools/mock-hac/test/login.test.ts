import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockHac } from '../src/index.ts';

let base = '';
const server = createMockHac();

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function cookieOf(res: Response): string {
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

function csrfOf(html: string): string {
  const match = /<meta name="_csrf" content="([^"]+)"/.exec(html);
  if (!match?.[1]) throw new Error('no csrf token in page');
  return match[1];
}

async function login(user: string, pass: string, csrfOverride?: string) {
  const page = await fetch(`${base}/hac/login`);
  const cookie = cookieOf(page);
  const csrf = csrfOf(await page.text());
  const res = await fetch(`${base}/hac/j_spring_security_check`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      j_username: user,
      j_password: pass,
      _csrf: csrfOverride ?? csrf,
    }),
  });
  return { res, cookie };
}

describe('mock hAC login flow', () => {
  it('redirects anonymous users to the login page', async () => {
    const res = await fetch(`${base}/hac/`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/hac/login');
  });

  it('logs in with valid credentials and csrf token', async () => {
    const { res, cookie } = await login('mock-user', 'mock-pass');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/hac/');

    const home = await fetch(`${base}/hac/`, { headers: { cookie }, redirect: 'manual' });
    expect(home.status).toBe(200);
  });

  it('rejects wrong credentials', async () => {
    const { res } = await login('mock-user', 'wrong');
    expect(res.headers.get('location')).toBe('/hac/login?error=true');
  });

  it('rejects a missing/forged csrf token', async () => {
    const { res } = await login('mock-user', 'mock-pass', 'forged');
    expect(res.headers.get('location')).toBe('/hac/login?error=true');
  });
});
