## What and why

## Checks

- [ ] `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass
- [ ] Extension-host tests pass if the extension changed (`pnpm --filter sap-commerce-vs-tools run test:host`)
- [ ] New behaviour has a test; behaviour that mirrors the hAC/importer was observed, not guessed (`docs/*-behaviour.md`)
- [ ] `CHANGELOG.md` and, if needed, `docs/limitations.md` updated
- [ ] **Clean room:** I did not read, copy or paraphrase source code of other IDE plugins. Sources are listed in `docs/provenance.md`.
