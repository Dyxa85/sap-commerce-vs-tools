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

Settings: `sapcommerce.java.mode`, `sapcommerce.java.includeTests`, `sapcommerce.java.excludeExtensions`,
`sapcommerce.java.maxExtensions`.

### Where the classes come from: your Ant build, or sources (`sapcommerce.java.mode`)

|                  | `compiled` (default)                                                                     | `sources`                                   |
| ---------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| Own extensions   | sources, compiled by the Java server: live errors, completion, refactoring               | sources                                     |
| Platform/modules | result of `ant build`: `bin/*.jar` and the `classes` folders (packed to jars, see below) | sources of all 234 extensions               |
| Memory           | 1.5 GB peak, fits the default 2 GB heap                                                  | 2.4 GB and more, runs out of memory at 2 GB |
| Initial build    | about 2 minutes                                                                          | 4.5 minutes, then minutes of load           |
| Navigation into  | decompiled/class view (no source)                                                        | platform and module sources                 |

**Why not just point the Java server at the Ant output for everything?** Two reasons, both measured:

1. The Java server (Eclipse JDT) accepts only **jars** as libraries. A `classes` folder listed under
   `java.project.referencedLibraries` is silently ignored – an import that lived only in such a folder stayed unresolved
   (`AbstractSystemSetup` of `commerceservices`, 7 of 8 imports). 143 of the 234 extensions have only a `classes` folder
   after `ant build`, no jar. So _Configure Java_ packs each `classes` folder into `.sapcommerce/libs/<extension>.jar`
   (no compression; 143 jars, 92 MB, 7 s the first time, 1 s when nothing changed). The classes inside are exactly what Ant
   compiled, so there are no surprises at the next build.
2. Your **own** extensions are deliberately still sources. A compiled class cannot give you an error while you type, nor
   completion for a method you just added, nor a rename. Ant compiles them as well – that is a second compilation of a
   small amount of code, and it is what makes the editor feel live. They are also what you edit, so they are never stale.

Fallbacks: an extension that Ant has not built (`ant clean`, or a module that was never built) is taken from its sources;
the generated models come from `bootstrap/bin/models.jar` or, while that is missing, from `bootstrap/gensrc`. After an Ant
target finished successfully, the jars (and, if the set of built extensions changed, the settings written by _Configure
Java_) are updated; settings you changed by hand are left alone. Add `.sapcommerce/` to your `.gitignore`.

Limits of `compiled`: the sources of platform and modules are not part of the project, so opening one of them shows
unresolved types in that file, and "Go to Definition" into a platform class lands in the class file, not its source.
Switch to `sources` if you need that and have the memory (set `java.jdt.ls.vmargs` to `-Xmx4G`).

Generated model classes (`bootstrap/gensrc`, extension `gensrc`) exist only after `ant build`; until then references to
`*Model` classes are unresolved in the editor.

### What to expect

1. Run **SAP Commerce: Configure Java for this Project…**. You do not have to find it: while Java is not set up (project
   found, Red Hat Java installed, nothing configured) three things point to it – a **warning item in the status bar**
   ("Java: set up SAP Commerce"), a **clickable entry at the top of the Commerce Project view**, and a **quick fix on the red
   underlines** (lightbulb → "Set up Java for this SAP Commerce project…"). A notification asks once as well. All of them
   disappear when the setup is done. The settings go to `.vscode/settings.json` of the workspace; the Java extension
   declares them for the whole window, so they cannot be written per folder.
2. The Java extension picks them up by itself – no reload, no restart. It then builds the whole project in the
   background. **For a platform with 234 extensions (516 source folders) that took about 3 minutes**; until then imports
   still look unresolved and then they disappear all at once.
3. Types of loaded extensions are resolved from their sources (`src`, `gensrc`, `backoffice/src`, addon sources,
   test sources) or, for the 86 of 234 extensions that ship no `src`, from `bin/*.jar` (platform `core`, `processing`,
   most modules). Libraries come from `lib/`, the platform and Tomcat.

Extensions that are **not** in `localextensions.xml` are not part of the project, so their classes stay unresolved by
design (the platform does not load them either).

### Memory, JDK, tests and the other Java extensions

_Configure Java_ also writes four things that are not about the project (switch off with `sapcommerce.java.manageServer`):

- **Memory.** The Java server's default collector (`ParallelGC`) fills the whole allowed heap with garbage before it
  collects, and never gives it back: with `-Xmx4G` the process grows towards 4 GB although a full collection leaves about
  350 MB of live objects (heap histogram of a running server on a 234-extension project). The setup therefore writes
  `java.jdt.ls.vmargs` with `-XX:+UseG1GC -Xmx1536m` and periodic collections that return unused heap
  (`-XX:G1PeriodicGCInterval`, `-XX:MaxHeapFreeRatio=30`). In `sources` mode the limit is 4 GB.
- **The JDK of the platform.** The Ant build insists on one Java version (`required_java_version` in
  `platform/resources/ant/util.xml`, 21 for 2211-jdk21). Without a configured runtime the Java extension uses the JDK it ships
  (25 in version 1.58) for the project **and for test runs**, so the code is analysed and the tests run on a newer Java than
  the platform runs on. The setup finds the JDK of the required version (`JAVA_HOME`, the usual install folders, SDKMAN) and
  writes it to `java.configuration.runtimes`. If none is found it is only logged.
- **No Gradle/Maven import** (`java.import.gradle.enabled`, `java.import.maven.enabled`). The project is described by the
  settings above; a `build.gradle` somewhere in a CCv2 repository would otherwise make the Java server start Gradle daemons,
  more JVMs of the same JRE.
- **Tests find the platform.** A test started by the Test Runner needs the `resources` folder of `core` on its class path:
  the platform finds its home through `core-items.xml` there (without it: "Can not determine platformhome"). The `resources`
  folders of all loaded extensions are written to `java.test.config`.
- **Quiet tests**: `java.test.config` with `-XX:+EnableDynamicAgentLoading -Xshare:off` silences the Mockito/Byte Buddy
  warnings ("self-attaching", "Sharing is only supported for boot loader classes") that newer JDKs print.

**Other Java extensions** (the _Extension Pack for Java_): _Language Support for Java_ does the work, _Debugger_ and _Test
Runner_ use its project (they work with the setup above). _Maven for Java_ and _Gradle for Java_ only matter if a `pom.xml` or
`build.gradle` is found; they are not needed for SAP Commerce (Ant) and can be disabled for the workspace. Each VS Code window
with a Java project starts its own server, so two windows are two JVMs.

### How it was verified

Against a real SAP Commerce 2211-jdk21 CCv2 project (234 loaded extensions) with the real Red Hat Java extension 1.56,
in a throw-away VS Code profile and a copy-on-write clone of the checkout:

| Situation                                                       | Imports resolved                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Java server running, no Java settings                           | 0 of 8 in the test file                                           |
| `bin/*.jar` of source-less extensions missing (older generator) | core classes unresolved (`SystemSetupParameter`, `PerformResult`) |
| Configure Java at runtime, server already running               | **8 of 8** in the test file after ≈ 2.5 min                       |
| Same, 21 random files (code, tests, web, backoffice, addons)    | **239 of 239** (`sources` mode)                                   |
| `compiled`, class folders listed as libraries                   | 7 of 8: a class of a classes-only module is missing               |
| `compiled`, class folders packed to jars (the default)          | **8 of 8** after ≈ 2 min; restart busy 15 s; 1.47 GB peak         |
| Same, 6 files of own extensions (code, tests, addon)            | **81 of 81**                                                      |

Files of platform modules (6 further files of the sample: 102 of 114 imports) are only partly resolved in `compiled` mode, by design: their own package is not a source folder of the project.

The lab is in `packages/extension/test-java` (not part of CI: it needs a platform, the Java extension and minutes):

```bash
cd packages/extension && node esbuild.java.mjs
LAB_WORKSPACE=/path/to/core-customize LAB_FILE=/path/to/Some.java LAB_CONFIGURE=1 LAB_LS_FIRST=1 \
  LAB_REPORT=/tmp/report.txt node dist-java/run.cjs
```

It copies the installed Java extension into a temporary profile, so your own VS Code is untouched. Run it on a copy of
your checkout (`cp -cR` on macOS is instant): the Java server writes into the workspace.

Not measured: platforms other than 2211-jdk21. Memory (Java server, default 2 GB heap, 234 extensions): `sources` mode ran at
2.4 GB and more with minutes of sustained load (the "OutOfMemory" message), `compiled` mode peaked at 1.47 GB and was idle
15 s after a restart. If it is still too heavy, lower `sapcommerce.java.maxExtensions` or exclude extensions you do not work on.

## Other tools

These work with the standard VS Code extensions; this extension adds no code for them.

- **JUnit**: with the Java settings above, the _Test Runner for Java_ finds tests in `testsrc`. Platform tests that need
  the Spring context must still run through `ant unittests`/`integrationtests` (task above).
- **JRebel**: configured in the server's JVM options (`tomcat.javaoptions` in `local.properties`); nothing to do in the editor.
- **Groovy**: scripts for the hAC console run with _Run Groovy Script_; for Groovy language support install a Groovy extension.
- **Kotlin**: install a Kotlin language extension; Kotlin sources of an extension are not added to the Java settings.
