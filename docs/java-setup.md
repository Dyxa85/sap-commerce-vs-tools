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

### Not verified

The settings are generated and unit-tested, but they were **not** exercised against a running Red Hat Java language
server (it was not installed on the development machine). Import time, memory use and go-to-definition across the
platform are therefore unmeasured; ADR 0001 stays _Proposed_ until that is done. If the single flat project turns out
too heavy, lower `sapcommerce.java.maxExtensions` or exclude extensions you do not work on.

## Other tools

These work with the standard VS Code extensions; this extension adds no code for them.

- **JUnit**: with the Java settings above, the _Test Runner for Java_ finds tests in `testsrc`. Platform tests that need
  the Spring context must still run through `ant unittests`/`integrationtests` (task above).
- **JRebel**: configured in the server's JVM options (`tomcat.javaoptions` in `local.properties`); nothing to do in the editor.
- **Groovy**: scripts for the hAC console run with _Run Groovy Script_; for Groovy language support install a Groovy extension.
- **Kotlin**: install a Kotlin language extension; Kotlin sources of an extension are not added to the Java settings.
