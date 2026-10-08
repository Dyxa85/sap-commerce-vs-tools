import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { HacClient } from '@sapcommerce-vstools/core';
import { createMockHac } from '@sapcommerce-vstools/mock-hac';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  assertReadOnlyFlexSearch,
  assertReadOnlySql,
  createServer,
  ProjectKnowledge,
  type QueryRunner,
} from '../src/index.js';

const fixture = fileURLToPath(new URL('../../test-fixtures/hybris', import.meta.url));

describe('read-only guards', () => {
  it('lets plain SELECTs through and drops a trailing semicolon', () => {
    expect(assertReadOnlyFlexSearch('SELECT {pk} FROM {Product};')).toBe(
      'SELECT {pk} FROM {Product}',
    );
    expect(assertReadOnlySql("select * from products where p_code = 'update'")).toContain('update');
    expect(assertReadOnlySql('WITH x AS (SELECT 1) SELECT * FROM x')).toBeTruthy();
  });

  it.each([
    'DELETE FROM products',
    'SELECT 1; DROP TABLE products',
    'select * into backup from products',
    "SELECT 1 /* hi */; UPDATE products SET p_code = 'x'",
    '  ',
    'CALL do_something()',
  ])('rejects %j in SQL', (sql) => {
    expect(() => assertReadOnlySql(sql)).toThrow();
  });

  it('ignores keywords in strings and comments but not outside them', () => {
    expect(() => assertReadOnlySql("SELECT 'delete me' -- drop\nFROM t")).not.toThrow();
    expect(() => assertReadOnlySql('SELECT "drop" FROM t')).not.toThrow();
    expect(() => assertReadOnlySql("SELECT 'it''s'; DELETE FROM t")).toThrow();
  });

  it('allows only SELECT in FlexibleSearch', () => {
    expect(() => assertReadOnlyFlexSearch('UPDATE Product SET {code}=1')).toThrow();
    expect(() => assertReadOnlyFlexSearch('SELECT {pk} FROM {Product}; SELECT 1')).toThrow();
  });
});

describe('MCP server (fixture project)', () => {
  let client: Client;
  const calls: { kind: string; query: string; commit: boolean; maxCount: number }[] = [];
  const queries: QueryRunner = {
    description: 'the test instance',
    flexibleSearch: async (o) => {
      calls.push({ kind: 'fs', query: o.query, commit: o.commit, maxCount: o.maxCount });
      return {
        columns: ['pk', 'code'],
        rows: [
          ['1', 'x'.repeat(1000)],
          ['2', 'b'],
          ['3', 'c'],
        ],
        rowCount: 3,
        executionTimeMs: 4,
      };
    },
    sql: async (o) => {
      calls.push({ kind: 'sql', query: o.query, commit: o.commit, maxCount: o.maxCount });
      return { columns: ['n'], rows: [['1']], rowCount: 1, executionTimeMs: 1 };
    },
  };

  async function connect(withQueries: boolean): Promise<Client> {
    const knowledge = new ProjectKnowledge([fixture]);
    await knowledge.load();
    const server = createServer({ knowledge, queries: withQueries ? queries : undefined });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: 'test', version: '0' });
    await Promise.all([server.connect(a), c.connect(b)]);
    return c;
  }

  const text = (r: unknown): string =>
    ((r as { content: { text: string }[] }).content[0] as { text: string }).text;
  const call = async (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });

  beforeAll(async () => {
    client = await connect(true);
  });

  it('lists the tools, all marked read-only', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'describe_type',
      'extension_graph',
      'find_types',
      'flexible_search',
      'get_extension',
      'list_extensions',
      'sql_query',
    ]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });

  it('describes types and beans', async () => {
    const customer = JSON.parse(text(await call('describe_type', { name: 'Customer' })));
    expect(customer.name).toBe('Customer');
    expect(customer.ancestors).toContain('User');
    expect(
      customer.attributes.some((a: { qualifier: string }) => a.qualifier === 'loyaltyTier'),
    ).toBe(true);
    expect(JSON.stringify(customer)).not.toContain(fixture);

    const bean = JSON.parse(text(await call('describe_type', { name: 'BadgeData' })));
    expect(bean.name).toMatch(/BadgeData$/);

    const unknown = await call('describe_type', { name: 'NoSuchThing' });
    expect(unknown.isError).toBe(true);
  });

  it('finds types and extensions', async () => {
    const hits = JSON.parse(text(await call('find_types', { query: 'loyalty' })));
    expect(hits.some((h: { name: string }) => h.name === 'LoyaltyTier')).toBe(true);
    const custom = JSON.parse(text(await call('list_extensions', { category: 'custom' })));
    expect(custom.map((e: { name: string }) => e.name)).toEqual(
      expect.arrayContaining(['acmecore', 'acmefacades', 'acmeprocess']),
    );
    const ext = JSON.parse(text(await call('get_extension', { name: 'acmecore' })));
    expect(ext.requiredBy).toContain('acmefacades');
    expect(JSON.stringify(ext)).not.toContain(fixture);
  });

  it('answers the dependency graph and validates its arguments', async () => {
    const g = JSON.parse(
      text(await call('extension_graph', { scope: 'dependents', extension: 'acmecore' })),
    );
    expect(g.extensions.map((e: { name: string }) => e.name)).toContain('acmefacades');
    expect((await call('extension_graph', { scope: 'dependents' })).isError).toBe(true);
  });

  it('runs read-only queries without commit and cuts long cells', async () => {
    const r = JSON.parse(
      text(
        await call('flexible_search', { query: 'SELECT {pk},{code} FROM {Product};', maxRows: 2 }),
      ),
    );
    expect(calls.at(-1)).toMatchObject({
      kind: 'fs',
      query: 'SELECT {pk},{code} FROM {Product}',
      commit: false,
      maxCount: 2,
    });
    expect(r.rows).toHaveLength(2);
    expect(r.truncated).toBe(true);
    expect(r.rows[0][1].length).toBeLessThan(400);
  });

  it('refuses writes before they reach the instance', async () => {
    const before = calls.length;
    const r = await call('sql_query', { query: 'DELETE FROM products' });
    expect(r.isError).toBe(true);
    expect(calls.length).toBe(before);
    expect((await call('flexible_search', { query: 'UPDATE Product SET {code}=1' })).isError).toBe(
      true,
    );
  });

  it('offers no query tools without a connection', async () => {
    const offline = await connect(false);
    const { tools } = await offline.listTools();
    expect(tools.map((t) => t.name)).not.toContain('flexible_search');
    expect(tools.map((t) => t.name)).not.toContain('sql_query');
  });
});

describe('query tools against the mock hAC', () => {
  it('reach the instance through the real client, read-only', async () => {
    const hac = createMockHac();
    await new Promise<void>((resolve) => hac.listen(0, '127.0.0.1', resolve));
    const { port } = hac.address() as AddressInfo;
    const client = new HacClient({
      baseUrl: `http://127.0.0.1:${port}/hac`,
      username: 'mock-user',
      password: 'mock-pass',
    });
    try {
      const knowledge = new ProjectKnowledge([fixture]);
      await knowledge.load();
      const server = createServer({
        knowledge,
        queries: {
          description: 'the mock',
          flexibleSearch: (o) => client.flexibleSearch(o),
          sql: (o) => client.sql(o),
        },
      });
      const [a, b] = InMemoryTransport.createLinkedPair();
      const mcp = new Client({ name: 'test', version: '0' });
      await Promise.all([server.connect(a), mcp.connect(b)]);

      const ok = await mcp.callTool({
        name: 'flexible_search',
        arguments: { query: 'SELECT {isocode} FROM {Language}' },
      });
      const body = JSON.parse(((ok.content as { text: string }[])[0] as { text: string }).text);
      expect(body.rows.map((r: string[]) => r[0])).toEqual(['en', 'de', 'fr']);

      const bad = await mcp.callTool({
        name: 'sql_query',
        arguments: { query: 'DROP TABLE languages' },
      });
      expect(bad.isError).toBe(true);
      expect(hac.receivedQueries).toEqual(['SELECT {isocode} FROM {Language}']);
    } finally {
      client.dispose();
      hac.close();
    }
  });
});
