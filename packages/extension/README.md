# SAP Commerce VS-Tools

Developer tools for **SAP Commerce** in VS Code. Talk to the hybris Administration Console (hAC) without leaving the editor.

> **Unofficial.** Not affiliated with, endorsed by or sponsored by SAP SE. "SAP" and "SAP Commerce" are trademarks of SAP SE,
> used here only to describe compatibility. Tested against SAP Commerce **2211-jdk21**.

## Features

- **FlexibleSearch & SQL** – run the selection (or the whole file) against an instance, browse results in a sortable, filterable table, export CSV/JSON.
- **Groovy scripts** – run in rollback mode by default; commit mode needs explicit confirmation.
- **ImpEx** – validate and import the current file or selection; failed imports show the unresolved lines with the reason.
- **ImpEx editor** – highlighting, diagnostics that mirror what the importer really does, completion, hover, outline, macro rename, column-aligning formatter, quick fixes.
- **FlexibleSearch editor** – highlighting, diagnostics, completion, alias rename, formatter; `?parameters` are asked for when you run a query.
- **Project knowledge** – types, attributes, beans and Spring beans of your workspace power completion, hover and go to definition in ImpEx, FlexibleSearch and the commerce XML files (`items`, `beans`, `spring`, business processes).
- **Diagrams** – type inheritance and references, extension dependencies and business processes as pannable, zoomable diagrams; click a node to open its definition.
- **AI tools (MCP)** – let Copilot's agent mode ask for types, attributes, beans and extension dependencies of your project; queries against an instance are opt-in and read-only. See `docs/mcp.md` in the repository.
- **Build and run** – Ant targets (`build`, `clean`, `unittests`, …) as commands and tasks with a problem matcher, start/stop the server (also in debug mode), attach the Java debugger, and generate the settings for the Red Hat Java extension from the extensions your platform loads. See `docs/java-setup.md` in the repository.
- **PK analyzer**, **log-level changes**, and a **history** of your queries and scripts.
- **Several connections** (Local, Dev, Stage …) with a status bar switcher. Mark production-like systems as _protected_.

## Getting started

1. Run **SAP Commerce: Add Connection…** (Command Palette) – e.g. `https://localhost:9002/hac`.
   For a local instance with a self-signed certificate choose _Ignore certificate errors_.
2. Open a file, select a query and run **SAP Commerce: Run FlexibleSearch Query**.
3. The password is requested on first use and stored in VS Code's secret storage – never in your settings.

## Security

- Passwords are stored in VS Code's secret storage, bound to URL + user name.
- TLS verification is on by default; turning it off is per connection and shown in the status bar tooltip.
- Writes (commit mode, import, log levels) ask for confirmation; protected connections always ask.
- Connections from workspace settings are ignored in untrusted workspaces; build and server commands need a trusted workspace.
- `http://` to a remote host asks for confirmation before the password is sent.
- No telemetry.

## Settings

See the _SAP Commerce VS-Tools_ section in Settings: `sapcommerce.connections`, `sapcommerce.query.maxCount`,
`sapcommerce.requestTimeoutSeconds`, `sapcommerce.confirmWrites`, `sapcommerce.impex.*`, `sapcommerce.java.*`,
`sapcommerce.mcp.enableQueries`.

## License

Apache-2.0
