# Feature guide: what it does, where to find it, what it needs

[Deutsch](features.de.md) · [How to enable it in VS Code](howto-enable-in-vscode.md)

## Where things are

The extension has **three places**. If you look for something, look here first:

| Place                                                                     | What is in it                                                                                                                                   |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Side bar → SAP Commerce** (hexagon icon with `< >` in the activity bar) | **Connections**, **Features** (a clickable table of contents of everything below), **Commerce Project**, **CCv2**                               |
| **The editor**                                                            | Language support in ImpEx, FlexibleSearch and the commerce XML files; buttons in the editor title bar; the right-click menu; keyboard shortcuts |
| **Command Palette** (`Cmd/Ctrl+Shift+P`)                                  | Type `SAP Commerce` – every command of the extension is listed there                                                                            |

Also: the **status bar** shows the active connection (click to switch); **Output → SAP Commerce** is the log
(secrets are masked); **Settings → search `sapcommerce`** has all options; and **Welcome → Walkthroughs → Get started
with SAP Commerce VS-Tools** is a guided tour with buttons.

> Don't see the hexagon icon? Right-click the activity bar and make sure **SAP Commerce** is ticked, or run
> **SAP Commerce: Get Started (Walkthrough)** from the Command Palette.

## What the hAC connection is for

The **hAC** (hybris Administration Console, usually `https://localhost:9002/hac`) is the web console of a **running**
SAP Commerce instance. The extension uses it – like you would in the browser – to run things on that instance. That is
all a _connection_ is: the address of the hAC, a user name, and a password kept in VS Code's secret storage.

| Needs a connection (talks to a running instance)          | Works without one (reads your files)                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Run FlexibleSearch and SQL queries                        | ImpEx and FlexibleSearch editors: highlighting, diagnostics, completion, formatter     |
| Run Groovy scripts                                        | Type, attribute and bean search; type preview; go to definition                        |
| Validate and import ImpEx                                 | items/beans/Spring/business-process XML support                                        |
| PK analyzer, log levels                                   | Commerce Project and CCv2 views, diagrams                                              |
| Read-only queries for AI tools (optional, off by default) | Ant build, server start/debug, Java setup, AI project tools (types, extensions, beans) |

**Set it up:** side bar → **Connections** → **+** (or the gear), or Command Palette → **SAP Commerce: Open Connection
Settings**. It is one page: name, hAC address, user, password, _Test connection_. Mark production-like systems as
**protected** so every write asks first. Several connections (Local, Dev, Stage …) are fine; the one with the dot is
the active one – click another to switch, or click the status bar item.

## Features by area

"Needs" lists what must be there for the feature to work.

### Run on an instance

| Feature                   | What it does                                                                                                         | Where                                                                                           | Needs      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------- |
| **Run FlexibleSearch**    | Runs the selection (or the file); rows as a sortable, filterable table, export CSV/JSON; `?parameters` are asked for | `Cmd/Ctrl+Enter`; ▶ button in the title bar of a `.flexibleSearch` / `.fxs` file; Features view | connection |
| **Run SQL**               | Raw SQL against the instance's database                                                                              | Right-click in a `.sql` file; Command Palette                                                   | connection |
| **Run Groovy (rollback)** | Runs a script and rolls everything back; _Commit_ variant asks first                                                 | Right-click in a `.groovy` file; Command Palette                                                | connection |
| **Validate ImpEx**        | Lets the hAC validate the file or selection                                                                          | `Cmd/Ctrl+Alt+V`; ✓ button in the title bar of an `.impex` file                                 | connection |
| **Import ImpEx…**         | Imports after you confirm; failed lines are listed with the reason                                                   | Title bar / right-click in an `.impex` file                                                     | connection |
| **Analyze PK**            | Says which item a PK belongs to                                                                                      | Command Palette                                                                                 | connection |
| **Change log level…**     | Lists the instance's loggers and changes one                                                                         | Command Palette                                                                                 | connection |
| **History**               | Re-open earlier queries, scripts and imports                                                                         | Command Palette → _Show History_                                                                | –          |
| **Open hAC in browser**   | Opens the console                                                                                                    | Inline button in the Connections view                                                           | connection |

### Write code

| Feature                                              | What it does                                                                                                                                                                                           | Where                                                                                                                | Needs               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **ImpEx editor**                                     | Highlighting; diagnostics that follow the real importer (unknown types/attributes, missing unique columns, macros …); completion; hover; outline; macro rename; column-aligning formatter; quick fixes | Any `.impex` file; _New ImpEx File_ in the Features view                                                             | project (for types) |
| **FlexibleSearch editor**                            | Highlighting; warnings for what breaks in the hAC (`--` comments, trailing `;`, `LIMIT`); alias completion and rename; formatter                                                                       | `.flexibleSearch`, `.fxs`, `.flexsearch` files                                                                       | project (for types) |
| **items.xml / beans.xml / spring.xml / process XML** | Diagnostics, completion for types, attributes, bean ids, hover, go to definition across extensions and into Java sources, outline                                                                      | Opens automatically for files named `*-items.xml`, `*-beans.xml`, `*-spring.xml`, `*-process.xml` of your extensions | project             |

_Project_ means: the opened folder contains the `hybris` directory (or you set `sapcommerce.project.roots`).
Unsaved edits of an `items.xml` are picked up immediately.

### Explore the project

| Feature                                  | What it does                                                                                                                                                                            | Where                                          | Needs                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| **Commerce Project view**                | Platform, modules and custom extensions in load order; each with its real folders and files and a _Commerce overview_ node (type system, beans, Spring, processes, ImpEx, dependencies) | Side bar → Commerce Project                    | project                                            |
| **CCv2 view**                            | The repository (`core-customize`, `js-storefront`, …) and an outline of `manifest.json` (versions, extension packs, extensions, properties, config per persona, aspects, webapps)       | Side bar → CCv2                                | a CCv2 repository (`core-customize/manifest.json`) |
| **Go to Type, Attribute or Enum Value…** | Searches types, enums, relations, attributes, enum values and beans                                                                                                                     | `Cmd/Ctrl+Alt+T`                               | project                                            |
| **Show Type**                            | Preview: inheritance, attributes, subtypes, relations                                                                                                                                   | Right-click a type name; Command Palette       | project                                            |
| **Type diagram**                         | Inheritance and references around a type; pan, zoom, click a node                                                                                                                       | Right-click in an `items.xml`; Command Palette | project                                            |
| **Extension dependency diagram**         | Custom extensions and what they require, or dependencies/dependents of one extension                                                                                                    | Command Palette                                | project                                            |
| **Business process diagram**             | The process as a graph, refreshed on save                                                                                                                                               | Right-click in a `*-process.xml`               | project                                            |
| **Go to definition**                     | `Cmd/Ctrl+click` on a type, attribute, bean id or `class="…"`                                                                                                                           | In ImpEx, FlexibleSearch and the XML files     | project                                            |
| **Show Index Information**               | How many extensions, types and beans were indexed                                                                                                                                       | Command Palette                                | project                                            |

### Build, run, debug

| Feature                                 | What it does                                                                                    | Where                                                                                               | Needs                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Run Ant Target…**                     | `build`, `clean`, `unittests`, or your own target with `-D` properties; `initialize` asks first | Command Palette; also _Terminal → Run Task_ (`sapcommerce.ant`); compiler errors appear in Problems | project, trusted workspace                                 |
| **Start / Stop Server**, **Debug mode** | Starts the platform with its own script                                                         | Command Palette; Run Task (`sapcommerce.server`)                                                    | project, trusted workspace                                 |
| **Attach Debugger to Server**           | Attaches to the port from your `local.properties` (default 8000)                                | Command Palette                                                                                     | _Debugger for Java_ extension                              |
| **Configure Java for this Project…**    | Writes `java.project.*` settings from the extensions your platform loads                        | Command Palette                                                                                     | _Language Support for Java™ by Red Hat_, trusted workspace |

### AI tools

| Feature                       | What it does                                                                                                               | Where                                                                             | Needs                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------- |
| **MCP server "SAP Commerce"** | Gives Copilot's agent mode (or another MCP client) read-only knowledge: extensions, dependencies, types, attributes, beans | Command Palette → _MCP: List Servers_ → SAP Commerce → Start                      | project, VS Code 1.101+ |
| **Read-only queries for AI**  | `flexible_search` and `sql_query` tools; one `SELECT` only, never committed                                                | Setting `sapcommerce.mcp.enableQueries` (user settings); confirmed on every start | connection              |

## Settings

Settings → search `sapcommerce`. The ones you are most likely to need: `sapcommerce.project.roots` (where `hybris` is),
`sapcommerce.confirmWrites`, `sapcommerce.query.maxCount`, `sapcommerce.project.hiddenEntries`,
`sapcommerce.java.*`, and `sapcommerce.*.diagnostics.severity` (turn single diagnostics down or off). The full list is
in the [HowTo](howto-enable-in-vscode.md#8-settings).

## If something is missing

| You see                                               | Because                                          | Do                                                                 |
| ----------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| Commerce Project says "No SAP Commerce project found" | The folder you opened does not contain `hybris/` | Open the folder with `hybris/`, or set `sapcommerce.project.roots` |
| CCv2 says "No CCv2 repository found"                  | There is no `core-customize/manifest.json`       | Open the repository folder                                         |
| A query command asks for a connection                 | No active connection                             | Side bar → Connections → +                                         |
| ImpEx shows no type completion                        | No project index                                 | See _Commerce Project_; run **Show Index Information**             |
| Build/server/Java commands do nothing                 | The workspace is not trusted                     | **Manage Workspace Trust**                                         |
| No hexagon icon in the activity bar                   | The icon is hidden                               | Right-click the activity bar → tick **SAP Commerce**               |
