# Provenance log (clean-room evidence)

For every feature, grammar or data format, record **what it was derived from**. Reviewers check this
file on every pull request. Allowed sources are listed in [CONTRIBUTING.md](../CONTRIBUTING.md).

Rule of thumb: if the only source you can name is another plugin's source code, do not merge it.

## Statement about the initial feature list

The feature scope in [PLAN.md](../PLAN.md) was derived from the **public README and release-note
headings** of the existing IntelliJ plugin and the public description of `vscode-hybris-tools`.
No source code of either project was read for this purpose.

## Log

| Date       | Area                                        | Derived from                                                                                                                                               | Author  |
| ---------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 2026-10-08 | hAC login flow (mock + later client)        | Observing the public login page (`GET /hac/login`: CSRF meta tag, form fields, redirect) of the author's own local instance                                | initial |
| 2026-10-08 | Fixture platform (`packages/test-fixtures`) | Written from scratch from general knowledge of the public file formats (`localextensions.xml`, `extensioninfo.xml`, `items.xml`, `beans.xml`, process XML) | initial |

| 2026-10-08 | hAC endpoints and payloads (`docs/hac-api.md`) | Pages and JavaScript served by the maintainer's own local instance (after login with the instance's default dev account, authorised by the maintainer), plus test calls against that instance (read-only queries, rollback-mode script, ImpEx validation, comment-only import). Official SAP hAC documentation / JavaDoc as cross-check. Source code of other IDE plugins was explicitly **not** consulted. | initial |

| 2026-10-08 | ImpEx parser, diagnostics, formatter (`packages/core/src/languages/impex`) | Probe scripts against the maintainer's own instance (validation endpoint, no-op `UPDATE` imports, one throw-away item that was removed again), see `docs/impex-behaviour.md`; public SAP community descriptions of ImpEx syntax; real-world ImpEx files of the maintainer's project used **read-only as a test corpus** (not copied into the repository). | initial |
| 2026-10-08 | FlexibleSearch parser, diagnostics, formatter (`packages/core/src/languages/flexsearch`) | Probe queries against the maintainer's own hAC, see `docs/flexsearch-behaviour.md`; real queries from the maintainer's project Java sources used read-only as a test corpus. | initial |
| 2026-10-08 | TextMate grammars (ImpEx, FlexibleSearch), snippets, language configuration | Written from scratch from the syntax rules above. | initial |
| 2026-10-08 | Decision: no ACL language, no Polyglot Query | No public specification; `.acl` is another plugin's own format. Documented in `docs/limitations.md`. | initial |

| 2026-10-08 | Platform model (`packages/core/src/platform`): `localextensions.xml`, `extensioninfo.xml`, scan paths, load order | Public file formats; verified against the maintainer's running instance: the computed set of loaded extensions is identical to the list the hAC shows on `/platform/extensions` (234 = 234), including symlinked `bin/modules`. | initial |
| 2026-10-08 | Type system (`packages/core/src/typesystem`): items.xml parser, merge, inheritance, relations | Public items.xml format; consistency-checked on the maintainer's 215 real items files (0 unresolved supertypes). Implicit `GenericItem` supertype, relation ends as attributes of the opposite type and relation types as importable types were derived from the data and from import behaviour. Live comparison with `ComposedType`/`AttributeDescriptor` of the running instance done afterwards (`docs/typesystem-verification.md`): 999 of 1,004 types identical, the rest explained by extensions that are not in the checkout; it found three rules (many-to-many-only `Link`, `…POS` attributes, case-insensitive type codes) that were then fixed. | initial |

| 2026-10-08 | Bean system, Spring XML, business process XML (`packages/core/src/beans`, `spring`, `processes`) | Public file formats (`*-beans.xml`, `*-spring.xml`, process definition schema); consistency-checked read-only on the maintainer's 196 beans files, 497 Spring files and 28 process files (false positives found this way were removed). No code of other plugins was read. | initial |
| 2026-10-08 | Graph layout and SVG rendering (`packages/core/src/graph`) | Written from scratch; layered layout (cycle removal, longest-path layering, barycenter ordering) is textbook graph drawing. | initial |
| 2026-10-08 | Ant/server invocation and Java settings (`packages/core/src/build`, `java`) | Read-only look at the maintainer's platform: `build.xml` target names, `setantenv.sh/.bat`, `hybrisserver.sh`, `project.properties` (`tomcat.debugjavaoptions`), directory layout of extensions. Red Hat Java setting names from its public documentation. See `docs/java-setup.md`. | initial |

| 2026-10-08 | MCP server (`packages/mcp-server`) | Public MCP specification and the MIT-licensed `@modelcontextprotocol/sdk`; tools are thin views on the project model written for this project. | initial |

<!-- Add one row per feature/grammar. Example:
| 2026-11-02 | ImpEx grammar | help.sap.com "ImpEx Syntax" + own sample files | name |
-->
