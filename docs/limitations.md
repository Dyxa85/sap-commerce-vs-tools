# Known limitations

Things this extension deliberately does not do (yet) or cannot do in VS Code, and why.

## Not implemented

| Feature                                                          | Status          | Reason                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ACL language (`.acl`)**                                        | not planned     | `.acl` is a file format of another IDE plugin, not a SAP Commerce format. There is no public specification and reproducing it would mean copying that plugin's syntax. User rights are supported **inside ImpEx** (`$START_USERRIGHTS` blocks are recognised and not flagged). |
| **Polyglot Query language**                                      | not implemented | No public syntax specification was found and the hAC has no console to execute it, so behaviour cannot be verified. Will be added if sample queries / documentation are provided.                                                                                              |
| **Debugger value renderers for model classes (lazy evaluation)** | not possible    | The VS Code Java debugger offers no custom type-renderer API. A "show model as table" helper command is planned instead (Phase 11 spike).                                                                                                                                      |
| **Cross-language refactoring** (rename a type everywhere)        | limited         | VS Code cannot make the Java language server aware of `items.xml`/ImpEx. Own rename providers are offered per file type.                                                                                                                                                       |

## Behaviour to know

- The hAC console cannot bind query parameters. `?name` placeholders are replaced by SQL literals before sending; values you type are quoted automatically unless they are numbers, `NULL`, booleans or already quoted.
- `--` comments, a trailing `;` and `LIMIT` break FlexibleSearch queries in the hAC. The editor warns about them; `--` comments and the trailing `;` are removed when you run the query.
- ImpEx validation in the hAC is weaker than the import itself. The language server reports many problems the validator accepts (unknown mode, surplus cells, undefined macros, missing unique columns), based on observed import behaviour (see `docs/impex-behaviour.md`).
- Type- and attribute-aware features need the project index, which is built from the `items.xml` files of the loaded extensions. Without a SAP Commerce project in the workspace they stay silent instead of guessing.
- Spring `class="…"` navigation works where the Java source is part of a loaded extension; classes that only exist in JARs cannot be opened.
- Java support depends on the Red Hat Java extension. It was validated against it on one real 2211 platform (`docs/java-setup.md`); the first build of a whole platform takes a few minutes.
