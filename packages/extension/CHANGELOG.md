# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/),
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Commerce Project view**: every extension now shows its real folder structure like an IDE (`gensrc`, `resources`, `src`,
  `testsrc`, `build.xml`, `extensioninfo.xml`, …) including the Java sources, with Java packages merged
  (`com/acme/core/service`) and source folders labelled. The former type system / beans / Spring / process / ImpEx
  groups and the dependencies moved into a _Commerce overview_ node below. Build output (`classes`, `eclipsebin`, `bin`)
  is hidden; see `sapcommerce.project.hiddenEntries`. New files appear without a manual refresh.

## [0.1.0] - 2026-10-08

First release candidate.

### Added

- **ImpEx language support**: syntax highlighting (TextMate + semantic tokens), diagnostics matched to the real importer
  (unknown mode, rows without header, surplus cells, missing unique columns, undefined/unused macros, duplicate columns,
  unbalanced quotes/brackets, …), completion (headers, modifiers, macros), hover, outline, folding, macro
  go-to-definition/references/rename, column-aligning formatter, quick fixes, snippets.
- **FlexibleSearch language support**: highlighting, diagnostics (alias without `AS`, unknown aliases, `--` comments,
  trailing `;`, `LIMIT`, unwrapped `UNION`, …), completion for aliases/attributes/keywords, hover, alias
  rename/references, formatter, outline, folding, quick fixes. Queries with `?parameters` ask for values when run.
- **Commerce Project view** in the Explorer: platform, modules and custom extensions of the workspace in load order, their
  type-system / beans / Spring / process / ImpEx files, dependencies and dependents; problems in `localextensions.xml`
  and missing or circular `requires-extension` entries appear in the Problems panel.
- **Type system**: ImpEx and FlexibleSearch now know types, attributes, enum values and relations. Unknown types and
  attributes are reported with suggestions, completion offers real attributes and enum values, hover shows type
  information, and Ctrl/Cmd+click jumps to the definition in the `items.xml`. _Go to Type, Attribute or Enum Value…_
  (Ctrl/Cmd+Alt+T) and _Show Type_ (preview with inheritance, attributes, subtypes, relations). Unsaved edits of an
  `items.xml` are picked up immediately.
- **Commerce XML**: `*-items.xml`, `*-beans.xml`, `*-spring.xml` and business process definitions get diagnostics,
  completion, hover, go to definition (also across extensions and into Java sources), outline and quick fixes. Beans and
  item types share one search and one preview.
- **Diagrams**: _Show Type Diagram_ (inheritance and references, click to navigate), _Show Extension Dependency Diagram_
  (custom extensions, dependencies or dependents of one extension, or everything) and _Show Business Process Diagram_
  (stays in sync when the file is saved). Pan, zoom and fit; follows the editor theme.
- **Build and run**: Ant targets (`build`, `clean`, `unittests`, …) as commands and as `sapcommerce.ant` tasks with a
  problem matcher for `javac` errors; start the server (normally or in debug mode), stop it, and attach the Java debugger
  to the port configured in the platform. _Configure Java for this Project…_ writes the Red Hat Java settings from the
  loaded extensions (not yet validated against a running Java language server, see `docs/java-setup.md`).
- **MCP server for AI tools** (needs VS Code 1.101+): extensions, dependencies, types, enums, relations and beans of your
  project as read-only tools. Optional read-only FlexibleSearch/SQL against the active connection, off by default and
  confirmed on every start. See `docs/mcp.md`.
- Language server shared by both languages; it starts only when such a file is opened.

- hAC connections (settings + secret storage for passwords), status bar entry, connection wizard.
- Run FlexibleSearch and SQL queries, Groovy scripts (rollback/commit) and validate/import ImpEx from the editor.
- Results panel with sorting, filtering, paging, CSV/JSON export.
- PK analyzer, log level changes, query/script history.
- Confirmation for writes; protected connections.
