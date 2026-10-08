import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { ProjectKnowledge } from './knowledge.js';
import { assertReadOnlyFlexSearch, assertReadOnlySql, NotReadOnlyError } from './readonly.js';

/** What the query tools need from the hAC. `HacClient` fits; tests pass a stub. */
export interface QueryRunner {
  flexibleSearch(options: { query: string; maxCount: number; commit: false }): Promise<QueryRows>;
  sql(options: { query: string; maxCount: number; commit: false }): Promise<QueryRows>;
  /** Shown to the model so it knows which system it is talking to. */
  readonly description: string;
}

export interface QueryRows {
  columns: string[];
  rows: string[][];
  rowCount: number;
  executionTimeMs: number;
}

export interface ServerOptions {
  knowledge: ProjectKnowledge;
  /** When absent, the query tools are not registered at all. */
  queries?: QueryRunner;
  version?: string;
}

const MAX_ROWS = 200;
const MAX_CELL = 300;
const MAX_OUTPUT = 60_000;

function json(value: unknown): CallToolResult {
  let text = JSON.stringify(value, null, 1);
  if (text.length > MAX_OUTPUT)
    text = `${text.slice(0, MAX_OUTPUT)}\n… output cut at ${MAX_OUTPUT} characters`;
  return { content: [{ type: 'text', text }] };
}

function failure(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function tabular(result: QueryRows, cap: number) {
  const rows = result.rows
    .slice(0, cap)
    .map((row) => row.map((c) => (c.length > MAX_CELL ? `${c.slice(0, MAX_CELL)}…` : c)));
  return {
    columns: result.columns,
    rows,
    rowCount: result.rowCount,
    truncated: result.rows.length > cap || result.rowCount > rows.length,
    executionTimeMs: result.executionTimeMs,
  };
}

/** Builds the server with all tools registered; the caller connects a transport. */
export function createServer(options: ServerOptions): McpServer {
  const { knowledge, queries } = options;
  const server = new McpServer(
    { name: 'sapcommerce-vstools', version: options.version ?? '0.0.0' },
    {
      instructions:
        'Read-only knowledge about an SAP Commerce project: extensions and their dependencies, item types, enums, relations and beans. ' +
        'Use find_types to locate a name and describe_type for its attributes. ' +
        (queries
          ? `The query tools run SELECT statements against ${queries.description}; nothing can be changed through them.`
          : 'No instance is connected, so no queries can be run.'),
    },
  );
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

  const guarded = <T>(fn: () => T): CallToolResult => {
    try {
      return json(fn());
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  };

  server.registerTool(
    'list_extensions',
    {
      title: 'List extensions',
      description:
        'Extensions the platform loads, in load order, optionally filtered by category or name.',
      inputSchema: {
        category: z.enum(['platform', 'modules', 'custom', 'other']).optional(),
        query: z.string().optional().describe('Substring of the extension name'),
      },
      annotations: readOnly,
    },
    ({ category, query }) => guarded(() => knowledge.listExtensions({ category, query })),
  );

  server.registerTool(
    'get_extension',
    {
      title: 'Get extension',
      description:
        'Version, required extensions and the extensions that (transitively) require it.',
      inputSchema: { name: z.string() },
      annotations: readOnly,
    },
    ({ name }) =>
      guarded(() => {
        const e = knowledge.getExtension(name);
        if (!e) throw new Error(`No loaded extension called "${name}".`);
        return e;
      }),
  );

  server.registerTool(
    'extension_graph',
    {
      title: 'Extension dependency graph',
      description:
        'Dependencies between extensions. scope: custom (your extensions and what they require), dependencies or dependents of one extension, or all.',
      inputSchema: {
        scope: z.enum(['custom', 'dependencies', 'dependents', 'all']),
        extension: z.string().optional().describe('Required for dependencies and dependents'),
        depth: z.number().int().min(1).max(20).optional(),
      },
      annotations: readOnly,
    },
    ({ scope, extension, depth }) =>
      guarded(() => {
        if ((scope === 'dependencies' || scope === 'dependents') && !extension)
          throw new Error(`scope "${scope}" needs the "extension" argument.`);
        if (scope === 'dependencies' || scope === 'dependents')
          return knowledge.extensionGraph({ kind: scope, extension: extension as string, depth });
        return knowledge.extensionGraph({ kind: scope });
      }),
  );

  server.registerTool(
    'find_types',
    {
      title: 'Find types',
      description:
        'Searches item types, enums, relations, attributes, enum values and beans by (part of) the name.',
      inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(100).optional() },
      annotations: readOnly,
    },
    ({ query, limit }) => guarded(() => knowledge.findTypes(query, limit)),
  );

  server.registerTool(
    'describe_type',
    {
      title: 'Describe type',
      description:
        'Full description of an item type, enum, relation or bean: supertypes, subtypes, attributes with their declaring type, and the extensions that contribute to it.',
      inputSchema: { name: z.string().min(1) },
      annotations: readOnly,
    },
    ({ name }) =>
      guarded(() => {
        const d = knowledge.describe(name);
        if (!d) throw new Error(`Unknown type "${name}". Try find_types first.`);
        return d;
      }),
  );

  if (queries) {
    server.registerTool(
      'flexible_search',
      {
        title: 'Run FlexibleSearch',
        description: `Runs one read-only FlexibleSearch SELECT against ${queries.description}. At most ${MAX_ROWS} rows. No ";", no LIMIT, no "--" comments (the hAC rejects them).`,
        inputSchema: {
          query: z.string().min(1),
          maxRows: z.number().int().min(1).max(MAX_ROWS).optional(),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ query, maxRows }) => {
        try {
          const cap = maxRows ?? 50;
          const result = await queries.flexibleSearch({
            query: assertReadOnlyFlexSearch(query),
            maxCount: cap,
            commit: false,
          });
          return json(tabular(result, cap));
        } catch (err) {
          return failure(err instanceof Error ? err.message : String(err));
        }
      },
    );

    server.registerTool(
      'sql_query',
      {
        title: 'Run SQL',
        description: `Runs one read-only SQL SELECT against the database of ${queries.description}. At most ${MAX_ROWS} rows.`,
        inputSchema: {
          query: z.string().min(1),
          maxRows: z.number().int().min(1).max(MAX_ROWS).optional(),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ query, maxRows }) => {
        try {
          const cap = maxRows ?? 50;
          const result = await queries.sql({
            query: assertReadOnlySql(query),
            maxCount: cap,
            commit: false,
          });
          return json(tabular(result, cap));
        } catch (err) {
          if (err instanceof NotReadOnlyError) return failure(err.message);
          return failure(err instanceof Error ? err.message : String(err));
        }
      },
    );
  }

  return server;
}
