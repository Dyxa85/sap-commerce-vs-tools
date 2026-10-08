import { describe, expect, it } from 'vitest';
import {
  isInsecureRemote,
  normalizeBaseUrl,
  normalizeConnections,
  slugify,
} from '../src/connections/model.js';

describe('normalizeBaseUrl', () => {
  it.each([
    ['localhost:9002', 'https://localhost:9002/hac'],
    ['https://localhost:9002/hac/', 'https://localhost:9002/hac'],
    ['https://example.com:9002', 'https://example.com:9002/hac'],
    ['http://10.0.0.5:9001/hac', 'http://10.0.0.5:9001/hac'],
    ['https://host/custom-context?x=1#y', 'https://host/custom-context'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected);
  });

  it.each(['', '   ', 'ftp://host/hac', 'https://user:pw@host/hac', 'http://'])(
    'rejects %j',
    (input) => {
      expect(normalizeBaseUrl(input)).toBeUndefined();
    },
  );
});

describe('slugify', () => {
  it('creates stable ids', () => {
    expect(slugify('Dev (local) #1')).toBe('dev-local-1');
    expect(slugify('!!!')).toBe('connection');
  });
});

describe('normalizeConnections', () => {
  it('accepts valid entries and fills defaults', () => {
    const { connections, problems } = normalizeConnections([
      { name: 'Local', url: 'localhost:9002', username: 'admin', ignoreTlsErrors: true },
    ]);
    expect(problems).toEqual([]);
    expect(connections).toEqual([
      {
        id: 'local',
        name: 'Local',
        url: 'https://localhost:9002/hac',
        username: 'admin',
        ignoreTlsErrors: true,
        protected: false,
        locale: undefined,
        dataSource: undefined,
      },
    ]);
  });

  it('makes ids unique for duplicate names', () => {
    const { connections } = normalizeConnections([
      { name: 'Dev', url: 'a:1', username: 'u' },
      { name: 'dev', url: 'b:1', username: 'u' },
    ]);
    expect(connections.map((c) => c.id)).toEqual(['dev', 'dev-2']);
  });

  it('reports invalid entries instead of throwing', () => {
    const { connections, problems } = normalizeConnections([
      null,
      { url: 'a:1', username: 'u' },
      { name: 'X', url: '::', username: 'u' },
      { name: 'Y', url: 'a:1' },
    ]);
    expect(connections).toEqual([]);
    expect(problems.map((p) => p.index)).toEqual([0, 1, 2, 3]);
  });

  it('warns when a password is stored in settings but still loads the connection', () => {
    const { connections, problems } = normalizeConnections([
      { name: 'P', url: 'a:1', username: 'u', password: 'secret' },
    ]);
    expect(connections).toHaveLength(1);
    expect(problems[0]?.message).toContain('secret storage');
    expect(JSON.stringify(connections)).not.toContain('secret');
  });

  it('handles non-array input', () => {
    expect(normalizeConnections(undefined)).toEqual({ connections: [], problems: [] });
    expect(normalizeConnections({}).problems).toHaveLength(1);
  });
});

describe('isInsecureRemote', () => {
  it.each([
    ['http://10.0.0.5:9001/hac', true],
    ['http://dev.example.com/hac', true],
    ['http://localhostfoo.example.com/hac', true],
    ['http://127.0.0.1:9001/hac', false],
    ['http://127.1.2.3/hac', false],
    ['http://localhost:9001/hac', false],
    ['http://shop.localhost:9001/hac', false],
    ['http://[::1]:9001/hac', false],
    ['https://dev.example.com/hac', false],
    ['not a url', false],
  ])('%s -> %s', (url, expected) => {
    expect(isInsecureRemote(url)).toBe(expected);
  });
});
