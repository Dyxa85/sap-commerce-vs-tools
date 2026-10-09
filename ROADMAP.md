# Roadmap

What is **not** in 1.0 and why, plus ideas that came up while building it. Ordered by value for a day-to-day SAP Commerce
developer, not by effort. Anything marked _needs …_ cannot be built honestly without that thing.

## Next (1.1)

| Item                                  | Why / what                                                                                                                 | Needs                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Java memory use                       | Measure the memory of the Java server for a 234-extension project (the setup itself is validated, ADR 0001)                | A machine with a platform                       |
| Real-webview check of the diagrams    | Diagrams were verified in a browser pane with VS Code colour variables simulated                                           | —                                               |
| Cockpit NG / Backoffice configuration | `cockpit-config.xml`, `*_backoffice-config.xml`, widget definitions: completion for editor types, navigation to attributes | Public schema (the XSDs ship with the platform) |
| User-rights blocks in ImpEx           | `$START_USERRIGHTS` … `$END_USERRIGHTS`: validate the fixed column layout, complete type and permission names              | Observed importer behaviour                     |
| Free module groups                    | User-defined groups in the Commerce Project view (by name pattern or folder)                                               | —                                               |
| `*-deployment` and `web-spring` files | Deployment tables/typecodes, web contexts                                                                                  | —                                               |

## Later

- **CCv2 Cloud Portal**: builds, deployments, logs and environments via the Cloud Portal API; MCP tools for build status. _Needs a Cloud Portal API token to verify._ (The repository structure and `manifest.json` outline are done: the **CCv2** view.)
- **Solr console**: run queries against the Solr cores configured for an instance. _Needs a Solr instance to verify._
- **"Show model as table"** command for the Java debugger (VS Code has no custom value renderers).
- **Polyglot Query**: only if a public syntax description or sample set becomes available.
- **Log viewer**: tail the server log in a panel with level filters.
- **Type-system diff**: compare two checkouts or two environments and list added/removed attributes.
- **ImpEx data generator**: build a header and rows from a type (mandatory attributes first).
- **Test runner integration**: map `ant unittests` output to the Testing view.
- **Localization**: UI strings (German first).

## Ideas worth a spike

- Run FlexibleSearch against an in-memory sample dataset of the type system to catch attribute errors offline.
- Detect Groovy scripts that are not rollback-safe (statements that commit) and warn before running them in commit mode.
- Explain a failed ImpEx line by combining the importer message with the type system (e.g. "unique attribute missing").
- Dependency health: find extensions that are loaded but whose types nobody uses.

## Housekeeping before 1.0

See [docs/release.md](docs/release.md): enable private vulnerability reporting, store tokens if you want Marketplace / Open
VSX, screenshots of the results table and ImpEx diagnostics, first CI run on Windows and Linux (only macOS was available
locally).
