# ADR 0001 – Java project model for the Red Hat Java language server

- **Status:** Proposed (desk research + measurements; **not yet validated with a running JDT LS**)
- **Date:** 2026-10-08
- **Deciders:** project maintainers
- **Revisit in:** Phase 6 prototype (first task of that phase)

## Context

Java navigation, completion and diagnostics in VS Code come from the Red Hat Java extension (Eclipse JDT LS).
It knows Maven, Gradle and Eclipse projects, or an "invisible project" configured through settings.
SAP Commerce uses none of Maven/Gradle for its extension layout: it is an Ant-based multi-extension platform.
We have to make JDT LS understand the platform + custom extensions without shipping SAP artefacts.

### Measurements from a real local platform (2211-jdk21, CCv2-style `core-customize`)

Observed read-only on the maintainer's machine:

| Metric                                               | Value                                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Extension directories containing `extensioninfo.xml` | 504 (platform + modules + custom)                                                                                                                            |
| Extensions in `localextensions.xml`                  | a subset (typically 100–250 loaded)                                                                                                                          |
| Jars reachable (following symlinks)                  | 1,509 files, 1,158 unique names                                                                                                                              |
| Java source files on disk                            | ~27,000                                                                                                                                                      |
| On-disk size of `bin/`                               | ~440 MB                                                                                                                                                      |
| Per-extension source roots                           | `src`, `gensrc`, `testsrc`, `web/src` (+ `resources` as resource root)                                                                                       |
| Per-extension libs                                   | `lib/*.jar`, `web/webroot/WEB-INF/lib/*.jar`                                                                                                                 |
| Platform libs                                        | `platform/ext/*/lib/*.jar`, `platform/bootstrap/bin/*.jar` (incl. generated `models.jar`)                                                                    |
| Existing Eclipse metadata                            | Some custom extensions carry an Ant-generated `.classpath` (no `.project`); it references the platform as project `/platform` and uses `eclipsebin/` outputs |
| JDK                                                  | 21                                                                                                                                                           |

Generated model classes (`gensrc`, `models.jar`) exist only after a platform build.

## Options

**A. One Eclipse project per extension** – generate `.project` + `.classpath` per extension, with project references.
Accurate per extension, but hundreds of JDT projects → high memory/startup cost; needs a `platform` project; many files written into the user's tree.

**B. Generated Gradle/Maven wrapper project** – generate a `build.gradle`/`pom.xml` model.
Introduces a foreign build system into the repo, resolves poorly against local jars, and surprises users.

**C. Single "invisible project" driven by settings** – set `java.project.sourcePaths`, `java.project.referencedLibraries`
(globs of jars), `java.project.outputPath` in workspace settings (a block managed by our extension).
One flat classpath, which mirrors how the platform's server classpath works. No build files written.

## Decision (proposed)

Use **Option C** as the default; keep **Option A** as an opt-in fallback ("per-extension projects") if C does not scale
or the workspace root already contains build files that disable the invisible-project mode.

Rationale: lowest footprint, no files in source folders, easy to regenerate and diff, matches the flat server classpath.

## Consequences / risks to verify in the Phase 6 prototype

1. Invisible-project mode only activates when the opened folder has **no** `pom.xml`/`build.gradle`/`.project` at its root → detect and warn.
2. ~500–1,000 source roots and ~1,500 jars in one project: measure JDT LS memory, initial import time, completion latency.
   Mitigation: _lazy import_ – only extensions from the resolved `localextensions.xml` closure (Phase 4), configurable allow/deny list.
3. Name clashes across web contexts (same class name in different webapps) and conflicting jar versions → IDE-only ambiguity; document, optionally exclude per extension.
4. `gensrc`/`models.jar` missing before the first build → show a "build needed" notice (Phase 6 Ant tasks).
5. Must write settings **without clobbering** user settings: only a clearly marked, regenerated key set; preview/diff before writing.
6. The extension must not require the Red Hat Java extension for non-Java features (hAC, ImpEx, type system); make it an optional dependency.

## Validation plan

Prototype with a script that emits the settings block from the extension model, open the real platform in VS Code with
Red Hat Java installed, and record: import time, RAM, correctness of Go-to-Definition into platform classes
(e.g. a service interface → implementation in a custom extension), behaviour with/without `gensrc`.
Update this ADR to **Accepted** or **Superseded** with the numbers.
