# Java, build and debugging

What the extension does for Java development, what it leaves to other extensions, and what is **not yet verified**.

## Build and server (verified against a 2211 platform on disk)

The platform builds with Ant. `setantenv` has to be _sourced_ in `bin/platform` before `ant` runs (it sets `ANT_HOME`,
`ANT_OPTS` and `PATH`), so every task runs `. ./setantenv.sh && ant <target>` there (`setantenv.bat` on Windows).

- **SAP Commerce: Run Ant Target…** lists the usual targets (`build`, `clean`, `all`, `customize`, `updatesystem`,
  `unittests`, …) or takes your own target with `-D` properties. `initialize` asks for confirmation because it drops data.
- The same targets are available as tasks of type `sapcommerce.ant` (Terminal → Run Task, or in `tasks.json`):

  ```json
  {
    "type": "sapcommerce.ant",
    "target": "unittests",
    "args": ["-Dtestclasses.extensions=acmecore"]
  }
  ```

  Only plain target names and `-Dkey=value` arguments are accepted; nothing is passed through a shell unchecked.

- `javac` errors printed by Ant (`[javac] File.java:12: error: …`) appear in the Problems panel.
- **Start Server** / **Start Server in Debug Mode** run `hybrisserver.sh` (`hybrisserver.bat`); **Stop Server** ends the task.
- **Attach Debugger to Server** attaches the Java debugger to the JDWP port. It reads `tomcat.debugjavaoptions` from
  `config/local.properties` and the platform's `project.properties` (default 8000).

Build, server and Java commands are disabled in untrusted workspaces.

## Java navigation (needs the Red Hat Java extension)

**SAP Commerce: Configure Java for this Project…** writes `java.project.sourcePaths`,
`java.project.referencedLibraries` and `java.project.outputPath` into the workspace-folder settings, derived from the
extensions the platform really loads ([ADR 0001](adr/0001-java-project-model.md), option C). Only directories that exist
are listed. The command asks first, warns when the settings were changed by hand since the last run, and warns when a
`pom.xml`/`build.gradle`/`.project` at the folder root would make the Java extension ignore them.

Settings: `sapcommerce.java.includeTests`, `sapcommerce.java.excludeExtensions`, `sapcommerce.java.maxExtensions`.

Generated model classes (`bootstrap/gensrc`, extension `gensrc`) exist only after `ant build`; until then references to
`*Model` classes are unresolved in the editor.

### What to expect

1. Run **SAP Commerce: Configure Java for this Project…** (or answer the offer that appears once when a project is found
   and the Java extension is installed). The settings go to `.vscode/settings.json` of the workspace; the Java extension
   declares them for the whole window, so they cannot be written per folder.
2. The Java extension picks them up by itself – no reload, no restart. It then builds the whole project in the
   background. **For a platform with 234 extensions (516 source folders) that took about 3 minutes**; until then imports
   still look unresolved and then they disappear all at once.
3. Types of loaded extensions are resolved from their sources (`src`, `gensrc`, `backoffice/src`, addon sources,
   test sources) or, for the 86 of 234 extensions that ship no `src`, from `bin/*.jar` (platform `core`, `processing`,
   most modules). Libraries come from `lib/`, the platform and Tomcat.

Extensions that are **not** in `localextensions.xml` are not part of the project, so their classes stay unresolved by
design (the platform does not load them either).

### How it was verified

Against a real SAP Commerce 2211-jdk21 CCv2 project (234 loaded extensions) with the real Red Hat Java extension 1.56,
in a throw-away VS Code profile and a copy-on-write clone of the checkout:

| Situation                                                       | Imports resolved                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Java server running, no Java settings                           | 0 of 8 in the test file                                           |
| `bin/*.jar` of source-less extensions missing (older generator) | core classes unresolved (`SystemSetupParameter`, `PerformResult`) |
| Configure Java at runtime, server already running               | **8 of 8** in the test file after ≈ 2.5 min                       |
| Same, 21 random files (code, tests, web, backoffice, addons)    | **239 of 239**                                                    |

The lab is in `packages/extension/test-java` (not part of CI: it needs a platform, the Java extension and minutes):

```bash
cd packages/extension && node esbuild.java.mjs
LAB_WORKSPACE=/path/to/core-customize LAB_FILE=/path/to/Some.java LAB_CONFIGURE=1 LAB_LS_FIRST=1 \
  LAB_REPORT=/tmp/report.txt node dist-java/run.cjs
```

It copies the installed Java extension into a temporary profile, so your own VS Code is untouched. Run it on a copy of
your checkout (`cp -cR` on macOS is instant): the Java server writes into the workspace.

Not measured: memory use of the Java server, and platforms other than 2211-jdk21. If the flat project turns out too heavy,
lower `sapcommerce.java.maxExtensions` or exclude extensions you do not work on.

## Other tools

These work with the standard VS Code extensions; this extension adds no code for them.

- **JUnit**: with the Java settings above, the _Test Runner for Java_ finds tests in `testsrc`. Platform tests that need
  the Spring context must still run through `ant unittests`/`integrationtests` (task above).
- **JRebel**: configured in the server's JVM options (`tomcat.javaoptions` in `local.properties`); nothing to do in the editor.
- **Groovy**: scripts for the hAC console run with _Run Groovy Script_; for Groovy language support install a Groovy extension.
- **Kotlin**: install a Kotlin language extension; Kotlin sources of an extension are not added to the Java settings.
