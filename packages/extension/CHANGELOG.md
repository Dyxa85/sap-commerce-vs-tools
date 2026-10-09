# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/),
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.4] - 2026-10-09

### Changed

- **Java: platform and modules now come from your Ant build** instead of being compiled a second time. The Java server
  (Eclipse JDT) takes only jars as libraries, so _Configure Java_ packs the `classes` folders of the built extensions into
  `.sapcommerce/libs/<extension>.jar` (143 jars in 7 s, 1 s when nothing changed) and lists them together with the existing
  `bin/*.jar`. Your own extensions (`custom`) stay sources, so errors, completion and refactoring for your code are live. An
  extension that Ant has not built (after `ant clean`) falls back to its sources, `bootstrap/gensrc` is used while
  `models.jar` is missing. After an Ant target finished successfully the jars and, if needed, the settings are updated.
  New setting `sapcommerce.java.mode` (`compiled` default, `sources` for the previous behaviour).
- Reason: with all 558 source folders compiled by the Java server, the default 2 GB heap was not enough ("The Java Language
  Server encountered an OutOfMemory error"). Numbers in [docs/java-setup.md](../../docs/java-setup.md).

## [0.1.3] - 2026-10-09

### Changed

- **The Java setup can no longer be missed.** In 0.1.2 it was offered once in a notification that is easy to overlook, and
  users were left with unresolved imports. While a project is found, the Red Hat Java extension is installed and nothing
  is configured, three hints stay: a warning item in the status bar, a clickable entry at the top of the Commerce Project
  view, and a quick fix on the red "cannot be resolved" underlines. They disappear when Java is set up. After the setup
  the status bar says that the build is running (about 3 minutes). The log says why the hint is or is not shown.

## [0.1.2] - 2026-10-09

### Fixed

- **Java: unresolved imports.** _Configure Java for this Project…_ could never write its settings (the Java extension
  declares `java.project.*` for the whole window, we wrote them per folder), and it pointed the Java server at the wrong
  things: the `bin/*.jar` of the 86 of 234 extensions that ship no `src` (platform `core`, `processing`, most modules)
  were missing, as were `backoffice/src`, `backoffice/testsrc` and addon sources. It also offered a "reload" through a
  command that does not exist. Verified against a real 2211 platform and the real Red Hat Java extension: **239 of 239
  imports resolve** in 21 random files, about 3 minutes after the setup.
- The settings `sapcommerce.java.*` are window settings (they logged a warning).

### Added

- A one-time offer to run the Java setup when a project is found, the Java extension is installed and nothing is
  configured (_Don't ask again_ is remembered per workspace).

## [0.1.1] - 2026-10-08

### Added

- **Side bar "SAP Commerce"** (hexagon icon in the activity bar) that gathers the views: **Connections** (list with the
  active one marked; inline edit, test and open-hAC buttons), **Features** (a clickable table of contents of the whole
  extension with the place where each feature also lives), **Commerce Project** and **CCv2**. The two project views moved
  here from the Explorer and explain themselves when empty.
- **Connection settings page** (_Open Connection Settings_): add, edit, test and remove connections on one page, with an
  explanation of what a connection is for. It replaces the chain of input boxes (still available as _Add Connection (Step
  by Step)…_).
- **Walkthrough** _Get started with SAP Commerce VS-Tools_ and a one-time hint after the first start; _New ImpEx File_ and
  _New FlexibleSearch File_ commands; context-menu entries to run SQL (`.sql`) and Groovy (`.groovy`).

- **CCv2 view** in the side bar (explains itself when there is no CCv2 repository; for one with `core-customize/manifest.json`): the repository as it is on
  disk (`core-customize`, `js-storefront`, scripts, …), an outline of `manifest.json` (commerce suite and Solr version,
  extension packs, extensions, properties, config files per persona, aspects with webapps, anything SAP adds later; a click
  jumps to the entry; invalid JSON is reported), and under `hybris` only what a project owns (`config`, `bin/custom`).
  It works on the files only, without a Cloud Portal connection.

### Changed

- **Commerce Project view**: every extension now shows its real folder structure like an IDE (`gensrc`, `resources`, `src`,
  `testsrc`, `build.xml`, `extensioninfo.xml`, …) including the Java sources, with Java packages merged
  (`com/acme/core/service`) and source folders labelled. The former type system / beans / Spring / process / ImpEx
  groups and the dependencies moved into a _Commerce overview_ node below. Build output (`classes`, `eclipsebin`, `bin`)
  is hidden; see `sapcommerce.project.hiddenEntries`. New files appear without a manual refresh.

### Fixed

- A login that was still running while the password or the connection settings changed could put an authenticated
  client back into the cache, so the next request skipped the password prompt. Such a login now starts over.
- `sapcommerce.project.hiddenEntries` is read without a resource and is therefore a window setting (it logged a warning).

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
