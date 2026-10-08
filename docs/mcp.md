# MCP server for AI tools

The extension bundles a [Model Context Protocol](https://modelcontextprotocol.io) server (`dist/mcp.cjs`). VS Code lists
it as **SAP Commerce** among its MCP servers when the workspace contains a SAP Commerce project, so Copilot's agent mode
and other MCP clients can use it. It also runs on its own:

```bash
node dist/mcp.cjs --project /path/to/hybris
```

## Tools

All tools are read-only (`readOnlyHint`).

| Tool                                    | What it answers                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| `list_extensions`                       | Loaded extensions in load order, filtered by category or name                    |
| `get_extension`                         | Version, required extensions, extensions that require it                         |
| `extension_graph`                       | Dependencies between extensions (custom, dependencies/dependents of one, or all) |
| `find_types`                            | Item types, enums, relations, attributes, enum values and beans by name          |
| `describe_type`                         | Supertypes, subtypes, attributes with declaring type, contributing extensions    |
| `flexible_search`, `sql_query` (opt-in) | One `SELECT` against the active connection, at most 200 rows                     |

File paths of your machine are not included in answers.

## Queries against an instance (off by default)

Set `sapcommerce.mcp.enableQueries` (user setting, not available in workspace settings). Each time the server starts,
VS Code asks you to confirm which connection the AI may query. Then:

- only a single `SELECT` (or `WITH … SELECT` for SQL) passes; any write keyword, a second statement or `INTO` is rejected
  **before** a request is sent;
- queries always run in rollback mode, never commit;
- results are capped (200 rows, 300 characters per cell) but **are visible to the AI model** – do not enable this on a
  system with personal data you must not share with it.

The password never appears on a command line: the extension reads it from VS Code's secret storage and hands it to the
server process in the environment variable `SAPC_MCP_HAC_PASSWORD` of that child process only. (Run standalone, use
`--hac-password-file`.)

## Not verified

The server was exercised through the MCP SDK's in-memory transport, over stdio with the VS Code binary running as Node
(`ELECTRON_RUN_AS_NODE=1`, how the extension starts it), and against the mock hAC. It has **not** been exercised from
Copilot's agent mode or another real MCP client.
