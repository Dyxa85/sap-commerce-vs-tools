# Retrospective – first complete version

Written after all phases of [PLAN.md](../../PLAN.md) that could be done without external accounts or systems.

## What went well

- **Observing instead of guessing.** Every feature that mirrors the hAC or the importer was derived from probes against a
  real instance (`docs/*-behaviour.md`). That found things no documentation says: macros are substituted textually with the
  longest defined prefix, `--` comments and a trailing `;` break FlexibleSearch, the `405` on a stale session, rows without
  a header are import errors. The analyzers therefore report what the importer really does.
- **Running analyzers over a real corpus.** About 1,400 real project files (ImpEx, items, beans, Spring, processes) were
  used read-only. Almost every analyzer produced false positives on the first run; fixing them (or demoting them to hints)
  is what makes the diagnostics trustworthy. Findings that belong to SAP-owned extensions are shown as hints.
- **A pure `core`.** No `vscode` import means parsers, type system, layout and the MCP server are all testable without an
  editor; the 426 unit tests run in about a second.
- **Host tests against the real editor.** 57 tests run in VS Code 1.141 (and again against the minified bundle), which found
  integration problems unit tests cannot see.
- **Security as a design input.** Credential binding to URL + user, no redirects, strict CSP, validated process arguments,
  confirmation for every write and for AI queries — decided early, reviewed at the end (`docs/security-review.md`).

## What went badly or was found late

- **The typecheck gate hid failures** for a while: output was grepped instead of judging the exit code. Fixed (`--no-bail`,
  judge by exit code), and a deliberate error confirmed it now fails. Rule: gates are exit codes, never text.
- **Two real bugs were only visible when looking at the result.** The diagram was invisible when the webview had no size at
  load time, and long edges ran across unrelated nodes. Unit tests and host tests passed; a browser pane found both.
  Lesson: anything visual needs a look, not only an assertion.
- **A security gap found in the final review**: `http://` to a remote host sent the password without any warning.
- **The live comparison found three real type-system errors late** (relations that are not `Link`, missing `…POS`
  attributes, case-insensitive type codes), although the parser had passed ≈215 real files without complaint: consistency
  checks on the input cannot show that the _model_ matches the platform. Comparing with the running system first would have
  avoided 337 wrongly typed relation types.
- **Tooling surprises** that cost time: Prettier re-wrapping made scripted patches silently not apply (view the formatted
  code, assert the pattern was found); BSD `sed` has no `\b`; a quadratic regex in the formatter (2.3 s on 1.5 MB, now 14 ms).
- **Things I could not verify** (listed in `docs/parity.md`): the Java setup against a Java language server, Copilot agent
  mode with the MCP server, a real `ant build` from the task, Windows and Linux, CCv2, Solr.

## Decisions to keep

- Single flat "invisible project" for Java as the default, per-extension projects as the fallback (ADR 0001, unvalidated).
- No ACL and no Polyglot editor: no public specification, and copying another plugin's format is exactly what a clean room avoids.
- Layout and SVG are produced in the language server; the webview only pans and zooms.
- MCP queries are opt-in, per-start confirmation, read-only guard plus rollback — the guard is a keyword check, so a
  least-privilege hAC user is still the real protection.

## Refactoring done as a result

- Removed historical aliases (`ImpexSchema`, `ImpexSettings`); one `TypeSchema` everywhere.
- `LanguageService` routing by language id or file suffix is the single entry point for all XML dialects.
- Layout gained virtual nodes for edges that span layers; `PositionedEdge.points` is now documented as anchor points.
- Packaging: minified bundles (extension 561 KB, server 360 KB, MCP 400 KB), third-party notices generated into the VSIX,
  `.vscodeignore` verified by installing the VSIX into a throw-away profile.

## What I would do differently

- Start the Java validation first (the biggest unknown stayed unknown to the end).
- Keep a short "how do I look at it" script per visual feature from day one (the demo page generator used here should live in the repo).
- Put the fuzz test in before the parsers got complicated; it found nothing now, which is a result, but it would have
  caught the quadratic cases earlier.

## Open items (all need the maintainer)

Publisher id, repository URL, contact addresses, store tokens, screenshots, first Windows/Linux CI run — see
[docs/release.md](../release.md). Ideas that came up are in [ROADMAP.md](../../ROADMAP.md).
