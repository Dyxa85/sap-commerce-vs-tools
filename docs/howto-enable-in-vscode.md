# HowTo: enable SAP Commerce VS-Tools in VS Code

[Deutsch](howto-enable-in-vscode.de.md)

This guide takes you from nothing to a working setup: install the extension, connect it to your hAC, and try every
feature once. It takes about ten minutes.

## 1. Requirements

| You need                                                    | Notes                                                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **VS Code 1.101 or newer**                                  | Also works in editors based on it if they allow VSIX files (VSCodium, Cursor); only VS Code is tested |
| A SAP Commerce project                                      | Target is `2211-jdk21`. The folder you open must contain the `hybris` directory (or a parent of it)   |
| A reachable hAC (optional)                                  | Needed for running queries, scripts and imports. All editor features work without it                  |
| _Optional:_ Java, Ant                                       | Ant comes with the platform (`bin/platform/apache-ant`); Java 21 for running the server               |
| _Optional:_ **Language Support for Java™ by Red Hat**       | Only for Java navigation (step 6)                                                                     |
| _Optional, for building from source:_ Node.js ≥ 20 and pnpm | Not needed when you install the release file                                                          |

## 2. Install

### Option A – from a release file (recommended)

1. Open the [latest release](https://github.com/Dyxa85/sap-commerce-vs-tools/releases/latest) and download
   `sap-commerce-vs-tools-<version>.vsix`.
2. In VS Code open the **Extensions** view (`Cmd+Shift+X` / `Ctrl+Shift+X`), click the `⋯` menu at the top and choose
   **Install from VSIX…**, then select the file.
   From a terminal instead:

   ```bash
   code --install-extension sap-commerce-vs-tools-<version>.vsix
   ```

3. VS Code may ask whether to trust the publisher. The extension runs entirely on your machine and sends nothing anywhere
   except to the hAC URLs you configure.

### Option B – build it yourself

```bash
git clone https://github.com/Dyxa85/sap-commerce-vs-tools.git
cd sap-commerce-vs-tools
pnpm install
pnpm --filter sap-commerce-vs-tools run package
code --install-extension packages/extension/sap-commerce-vs-tools-*.vsix
```

The package step runs the type checks of the build, bundles the extension, the language server and the MCP server,
and writes the third-party notices into the file.

### Option C – run it from source (for development)

Open the repository folder in VS Code, run `pnpm install`, then press `F5` (**Run Extension**). It builds first and opens an
_Extension Development Host_ window on the synthetic fixture project with the extension loaded.

### Check that it is installed

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run **SAP Commerce: About**. A message with the target
version appears. If the command is missing, reload the window (**Developer: Reload Window**).

## 3. Open your project

1. **File → Open Folder…** and choose the folder that contains `hybris/` (a CCv2 `core-customize` folder works, so does the
   `hybris` folder itself).
2. Click **Trust** when VS Code asks whether you trust the authors of the folder. Without trust the extension runs in a
   limited mode: no workspace connections, no build or server commands.
3. After a few seconds the **Commerce Project** view appears in the Explorer: platform, modules and your custom extensions
   in load order. Each extension shows its real folders and files (`src`, `gensrc`, `resources`, `build.xml`, …); the
   **Commerce overview** node below them lists type system, beans, Spring, processes, ImpEx and the dependencies. If the
   view does not appear, set the path explicitly:

   ```jsonc
   // .vscode/settings.json
   { "sapcommerce.project.roots": ["hybris"] }
   ```

   (relative to the first workspace folder, or absolute). **SAP Commerce: Show Index Information** reports how many
   extensions, item types and beans were indexed.

If the folder is a **CCv2 repository** (it contains `core-customize/manifest.json`), a second view **CCv2** appears:
the repository structure (`core-customize`, `js-storefront`, …) and an outline of `manifest.json` – click an entry to jump
to it in the file. Platform and extensions stay in **Commerce Project**.

The editor features (ImpEx, FlexibleSearch, items/beans/Spring/process XML, diagrams) now work – no connection required.

## 4. Connect to your hAC

1. Command Palette → **SAP Commerce: Add Connection…**
2. Enter a name (`Local`, `Dev`, …), the hAC URL (`https://localhost:9002/hac`), your user name, and whether to ignore
   certificate errors. For a local instance with a self-signed certificate choose **Ignore certificate errors**; do not
   do that for remote systems.
3. Mark production-like systems as **protected**: every write then asks for confirmation.
4. Run **SAP Commerce: Test Connection**. VS Code asks for the password once and stores it in its secret storage (bound to
   URL and user name). It never goes into your settings, logs or the repository.

The active connection is shown in the status bar; click it (or **Select Connection…**) to switch.
Plain `http://` to a remote host asks for an explicit confirmation before the password is sent.

## 5. Try the features

| Do this                                                                                                  | What happens                                                                  |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Create `test.flexibleSearch` containing `SELECT {pk}, {code} FROM {Language}` and press `Cmd/Ctrl+Enter` | Result table with sorting, filter, paging, CSV/JSON export                    |
| Same with **Run SQL Query**                                                                              | Raw SQL against the instance's database                                       |
| Create `test.impex`, type `INSERT_UPDATE Product;code[unique=true]` and start a data line                | Highlighting, completion for types and attributes, diagnostics while you type |
| `Cmd/Ctrl+Alt+V` in an ImpEx file                                                                        | **Validate ImpEx** on the instance; **Import ImpEx…** imports (asks first)    |
| **Run Groovy Script (Rollback)** in any editor (selection, or the whole file)                            | Runs on the instance, rolled back; the Commit variant asks first              |
| `Cmd/Ctrl+Alt+T`                                                                                         | **Go to Type, Attribute or Enum Value…** across all loaded extensions         |
| Put the cursor on a type name, **Show Type**                                                             | Preview with inheritance, attributes, subtypes, relations                     |
| **Show Type Diagram**, **Show Extension Dependency Diagram**                                             | Diagram panel: drag to pan, wheel to zoom, **Fit**, click a node to open it   |
| Open a business process XML, **Show Business Process Diagram**                                           | Process graph, refreshed when you save                                        |
| Ctrl/Cmd+click on a type, attribute, bean id or `class="…"` in XML or ImpEx                              | Jumps to the definition, also in other extensions                             |
| **Analyze PK**, **Change Log Level…**, **Show History**                                                  | Utilities of the hAC from the editor                                          |

Files with the extensions `.impex`, `.fxs`, `.flexsearch` and `.flexibleSearch` get the languages automatically; for any
other file use **Change Language Mode** in the status bar.

## 6. Build, run and debug (optional)

- **SAP Commerce: Run Ant Target…** lists `build`, `clean`, `unittests`, … or takes your own target with `-D` properties.
  The same targets are VS Code tasks of type `sapcommerce.ant` (**Terminal → Run Task**), and compiler errors appear in the
  Problems panel. `initialize` asks first because it drops all data.
- **Start Server** / **Start Server in Debug Mode** / **Stop Server**, then **Attach Debugger to Server** (needs the
  _Debugger for Java_ extension, part of the Java extension pack). The port is read from your `local.properties` or the
  platform's `project.properties` (default 8000).
- **Configure Java for this Project…** (needs _Language Support for Java™ by Red Hat_): writes `java.project.*` into your
  workspace-folder settings from the extensions the platform loads. It asks first and warns about `pom.xml`,
  `build.gradle` or `.project` at the folder root, which make the Java extension ignore the settings. Generated model
  classes appear after the first `ant build`. Tune with `sapcommerce.java.includeTests`,
  `sapcommerce.java.excludeExtensions` and `sapcommerce.java.maxExtensions`. This part is **not yet verified** against a
  running Java language server, see [java-setup.md](java-setup.md).

## 7. Let AI tools use your project (optional)

VS Code lists a server called **SAP Commerce** when the workspace contains a project: Command Palette →
**MCP: List Servers** → **SAP Commerce** → **Start Server**. In Copilot's agent mode the tools `list_extensions`,
`find_types`, `describe_type`, `extension_graph` and `get_extension` are then available. They only read your files.

Queries against an instance (`flexible_search`, `sql_query`) are off by default. To allow them set
`sapcommerce.mcp.enableQueries` in your **user** settings; VS Code then asks for confirmation each time the server starts.
Only a single `SELECT` is passed on, nothing is committed, and the results are visible to the AI model – do not enable this
for systems with data that must not be shared. Details: [mcp.md](mcp.md).

## 8. Settings

Open **Settings** and search for `sapcommerce`.

| Setting                                                                                                                                    | Default                      | Meaning                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------- |
| `sapcommerce.connections`                                                                                                                  | `[]`                         | Connections (no passwords)                                                    |
| `sapcommerce.query.maxCount`                                                                                                               | `200`                        | Row limit for queries                                                         |
| `sapcommerce.requestTimeoutSeconds`                                                                                                        | `60`                         | Timeout of hAC requests                                                       |
| `sapcommerce.confirmWrites`                                                                                                                | `true`                       | Ask before commit, import and log-level changes                               |
| `sapcommerce.impex.validation`                                                                                                             | `IMPORT_STRICT`              | Validation mode used for ImpEx validate/import                                |
| `sapcommerce.impex.diagnostics.severity`, `sapcommerce.flexsearch.…`, `sapcommerce.items.…`, `sapcommerce.beans.…`, `sapcommerce.spring.…` | `{}`                         | Change or switch off single diagnostics, e.g. `{"impex.macro.unused": "off"}` |
| `sapcommerce.impex.format.*`, `sapcommerce.flexsearch.format.*`                                                                            | on                           | Formatter options                                                             |
| `sapcommerce.project.roots`                                                                                                                | `[]`                         | `hybris` directories when auto-detection is not enough                        |
| `sapcommerce.project.showUnloadedExtensions`                                                                                               | `false`                      | Also list extensions that are not in `localextensions.xml`                    |
| `sapcommerce.project.hiddenEntries`                                                                                                        | `.git`, `classes`, `/bin`, … | Files/folders hidden inside extensions (`/name` = top level only)             |
| `sapcommerce.java.*`                                                                                                                       | see above                    | Java setup                                                                    |
| `sapcommerce.mcp.enableQueries`                                                                                                            | `false`                      | Allow read-only queries for AI tools (user settings only)                     |

## 9. Troubleshooting

| Symptom                                    | Fix                                                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| "self-signed certificate" / TLS error      | Edit the connection and enable **Ignore certificate errors** (local systems only)                                                        |
| Login fails repeatedly                     | The stored password is dropped after a rejected login; you are asked again. Check the user in the hAC                                    |
| "Unexpected login page"                    | The URL is not the hAC. It ends in `/hac` (or your custom context path)                                                                  |
| Commerce Project view is empty             | Open the folder containing `hybris/`, or set `sapcommerce.project.roots`; check **Show Index Information**                               |
| No completion or "unknown type" everywhere | The index has no project. Same as above; the language server starts when you open an ImpEx, FlexibleSearch or commerce XML file          |
| Types of your own extension are unknown    | The extension must be listed in `localextensions.xml`; see **Show / Hide Extensions That Are Not Loaded**                                |
| Build/server commands do nothing           | The workspace must be trusted (**Manage Workspace Trust**)                                                                               |
| Anything else                              | **SAP Commerce: Show Log** (secrets are masked), then [open an issue](https://github.com/Dyxa85/sap-commerce-vs-tools/issues/new/choose) |

## 10. Update and uninstall

Install a newer VSIX over the old one (Option A). To remove: Extensions view → **SAP Commerce VS-Tools** → **Uninstall**.
Removing a connection (**Edit / Remove Connection…**) also deletes its stored password.
