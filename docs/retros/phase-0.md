# Retro – Phase 0 (foundation)

**Went well**

- Monorepo, CI definition, lint/format/typecheck/test/build all green on the first full pass.
- Mock hAC reproduces the observed login flow (CSRF meta tag → form POST → redirect) and is covered by tests.
- Measuring the real platform early gave concrete numbers for the Java decision (ADR 0001).

**Went badly / surprises**

- TypeScript 7 is already current, but `typescript-eslint` supports `<6.1` → pinned TypeScript 6.0.x. Revisit when typescript-eslint catches up.
- Root `pnpm -r` scripts recursed into the root package silently → root scripts now exclude the root explicitly.
- No Red Hat Java extension available locally, so the Java spike is desk research only.

**Change next time**

- Install the Red Hat Java extension before Phase 6 and validate ADR 0001 first thing.
- Verify real hAC endpoint shapes (ImpEx import, FlexSearch, Groovy) against the local instance at the start of Phase 1, before writing the client.

**Open items**

- `publisher` and repository URL in `packages/extension/package.json` are TODO.
- Contact addresses in `CODE_OF_CONDUCT.md` / `SECURITY.md` are TODO.
- Credentials for the local hAC (`https://localhost:9002/hac`) are needed for Phase 1 integration checks → provide via env vars, never commit.
