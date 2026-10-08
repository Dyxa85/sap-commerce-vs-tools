# Architecture

```
VS Code ── packages/extension ──┬─ commands, tasks, tree view, webviews (results, type preview, diagrams), status bar
  (bundle dist/extension.cjs)   ├─ MCP definition provider ──► starts packages/mcp-server (dist/mcp.cjs, stdio)
                                ├─ LSP client ──► packages/language-server (dist/server.cjs, separate process)
                                └─ imports ─────► packages/core

packages/language-server ── imports ──► packages/core
packages/mcp-server ─────── imports ──► packages/core, @modelcontextprotocol/sdk
tools/mock-hac ──────────── test double of the hAC (login, CSRF, console endpoints)
packages/test-fixtures ──── synthetic SAP Commerce project used by all tests
```

## packages/core (no `vscode` dependency)

| Folder          | Contents                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `hac`           | HTTP session (cookies, CSRF, 405 retry, TLS policy), FlexSearch/SQL, Groovy, ImpEx, PK analyzer, loggers |
| `languages`     | ImpEx and FlexibleSearch: parser, analyzer, completion, hover, formatter, quick fixes, semantic tokens   |
| `xml`           | lenient XML parser with spans and cursor context, shared by all XML features                             |
| `platform`      | `localextensions.xml`, `extensioninfo.xml`, scan paths, load order, module graph                         |
| `typesystem`    | `items.xml` parser, merged type system, describe/search, items editor features, type graph               |
| `beans`         | `beans.xml` parser and bean system, editor features                                                      |
| `spring`        | `*-spring.xml` beans, aliases, overrides, Java class index                                               |
| `processes`     | business process definitions: parser, analyzer, editor features, graph                                   |
| `graph`         | layered graph layout (virtual nodes for long edges) and SVG renderer                                     |
| `build`, `java` | Ant/server invocations without shell quoting; Red Hat Java settings derived from the loaded extensions   |

## How a feature flows

1. The language server loads the platform model and builds the type, bean and Spring systems per project (`ProjectIndex`).
   Unsaved edits of `items`/`beans`/`spring` files are overlaid, so completion and diagnostics follow the editor.
2. Services translate pure `core` results into LSP types; documents are routed by language id, or by file name for `xml`.
3. Requests for non-LSP features (`sapcommerce/types/*`, `sapcommerce/graph/*`, `sapcommerce/index/info`) go through the
   same connection; diagrams are laid out in the server and arrive as ready SVG.
4. Everything that talks to an instance goes through `HacClient`.

## Principles

- `core` has **no** `vscode` dependency → reusable by the language server, MCP server and tests.
- Anything slow (indexing, parsing large files) runs in the language-server process, never in the extension host's UI path.
- All network access goes through one hAC client with explicit timeouts, TLS policy and redaction of secrets.
- Data from instances and from project files is untrusted: escape before rendering, strict CSP in webviews, messages from
  webviews are validated, nothing from a webview is executed.
- Processes are started without a shell string: targets and arguments are validated and passed as separate arguments.
- SAP-owned artefacts (XSDs, JARs) are read from the user's installation at runtime, never shipped.
- A feature that mirrors the hAC or the importer is derived from observed behaviour and documented in `docs/*-behaviour.md`.

Decisions are recorded as ADRs in `docs/adr/`.
