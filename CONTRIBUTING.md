# Contributing

Thanks for helping! Please read the clean-room rules first – they protect the project legally.

## Clean-room rules (mandatory)

We re-implement the **behaviour** of existing SAP Commerce IDE tooling without copying it.

**Allowed sources**

- Public feature descriptions (READMEs, marketplace pages, release-note titles, screenshots)
- Official SAP documentation (help.sap.com) and the XSD/config files of _your own_ platform installation
- Using other tools as a normal end user and describing what they do (black-box behaviour)
- Your own experiments against a running instance

**Forbidden**

- Reading, copying or porting source code of other SAP Commerce IDE plugins (in particular the
  EPAM IntelliJ plugin: `*.kt`, `*.java`, `*.bnf`, `*.flex`, test data, icons, UI strings)
- Pasting grammars, parser rules, messages or icons from such projects
- Contributing code if you have read the source of the corresponding feature in a forbidden project
  (ask a maintainer – someone else can implement that part)
- Adding SAP-owned files (e.g. `items.xsd`, platform JARs) to the repository

**Document your sources** in [docs/provenance.md](docs/provenance.md) when adding a feature or grammar.

## Developer Certificate of Origin

Sign off every commit (`git commit -s`). By doing so you certify the [DCO 1.1](https://developercertificate.org/)
and additionally confirm that your contribution contains no code taken from the forbidden sources above.

## Workflow

1. Open an issue (or comment on an existing one) before larger work.
2. Branch from `main`, use [Conventional Commits](https://www.conventionalcommits.org/).
3. `pnpm lint && pnpm typecheck && pnpm test` must pass.
4. Add tests for new behaviour; update docs and `docs/provenance.md`.
5. Open a pull request using the template.

## Code style

TypeScript `strict`, Prettier (`pnpm format`), ESLint. No telemetry, no secrets in settings or logs.
