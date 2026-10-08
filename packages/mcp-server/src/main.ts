import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HacClient } from '@sapcommerce-vstools/core';
import { ProjectKnowledge } from './knowledge.js';
import { createServer, type QueryRunner } from './server.js';

const USAGE = `sapcommerce-mcp – read-only SAP Commerce knowledge for AI tools

  --project <hybris dir>        a "hybris" directory (repeatable; the first one answers)
  --hac-url <url>               enable flexible_search and sql_query against this hAC
  --hac-user <name>
  --hac-password-file <path>    file that contains the password (or set SAPC_MCP_HAC_PASSWORD)
  --insecure                    accept an untrusted TLS certificate for the hAC
`;

function parse(argv: string[]): Record<string, string[]> {
  const args: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    const key = a.slice(2);
    if (key === 'insecure' || key === 'help') args[key] = ['true'];
    else {
      const value = argv[++i];
      if (value === undefined) throw new Error(`--${key} needs a value`);
      (args[key] ??= []).push(value);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  if (args['help'] || !args['project']) {
    process.stderr.write(USAGE);
    process.exit(args['help'] ? 0 : 2);
  }
  const knowledge = new ProjectKnowledge(args['project'] as string[]);
  await knowledge.load();

  let queries: QueryRunner | undefined;
  const url = args['hac-url']?.[0];
  if (url) {
    const user = args['hac-user']?.[0];
    const file = args['hac-password-file']?.[0];
    const password = file
      ? readFileSync(file, 'utf8').replace(/\r?\n$/, '')
      : process.env['SAPC_MCP_HAC_PASSWORD'];
    if (!user || !password)
      throw new Error('--hac-url needs --hac-user and a password (--hac-password-file).');
    const client = new HacClient({
      baseUrl: url,
      username: user,
      password,
      ignoreTlsErrors: !!args['insecure'],
    });
    queries = {
      description: `the instance at ${url} (user ${user})`,
      flexibleSearch: (o) => client.flexibleSearch(o),
      sql: (o) => client.sql(o),
    };
  }
  await createServer({ knowledge, queries }).connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  // stdout carries the protocol, so everything else goes to stderr
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
