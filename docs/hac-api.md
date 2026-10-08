# hAC HTTP contract (observed)

How the hAC web UI talks to its backend, as observed on a local **SAP Commerce 2211-jdk21** instance (2026-10-08) by
reading the pages and JavaScript the instance itself serves and by calling the endpoints with a test login.
This is the contract our `hac-client` implements and the mock-hAC reproduces. See [provenance.md](provenance.md).

Not an official, stable API: re-verify per SAP Commerce version. Cross-check with the official hAC documentation on
help.sap.com and the platform JavaDoc when in doubt.

Base URL: `{scheme}://{host}:{port}{contextPath}` – defaults `https://localhost:9002/hac`. Local instances use a
self-signed certificate (per-connection opt-in to skip verification).

## Session and CSRF

1. `GET /login` → sets `JSESSIONID` (path `/hac`, HttpOnly, Secure). The page contains
   `<meta name="_csrf" content="…">` and a form with the same hidden `_csrf` field.
2. `POST /j_spring_security_check` (`application/x-www-form-urlencoded`): `j_username`, `j_password`, `_csrf`.
   Success → `302` to `/hac/`. Failure → redirect to the login page with an error.
3. Every page contains a `_csrf` meta tag. State-changing/AJAX requests send it as header **`X-CSRF-TOKEN`**.
4. Missing/invalid CSRF token or no session on a POST → **HTTP 405** (not 403). The client must treat 405 on these
   endpoints as "re-authenticate / refresh token", retry once, then fail with a clear message.
5. A dead session may answer with the login page (HTML containing the marker `redirect_detection`) instead of JSON.
6. Fetch a fresh token from a page of the target console (e.g. `GET /console/flexsearch`) before the first call.

## Endpoints

All `POST` requests send `X-CSRF-TOKEN` and `Accept: application/json` unless noted.

| Feature                         | Request                                                                                                                                                                                                                                        | Response                                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FlexibleSearch                  | `POST /console/flexsearch/execute` form: `flexibleSearchQuery`, `sqlQuery` (empty when FlexSearch is used), `maxCount`, `user`, `locale`, `dataSource`, `commit` (`true`/`false`)                                                              | JSON `{ query, executionTime, resultCount, exception, resultList: string[][], headers: string[], rawExecution, dataSourceId, exceptionStackTrace, parametersAsString, catalogVersionsAsString }` |
| Raw SQL                         | same endpoint, `flexibleSearchQuery` empty, `sqlQuery` set                                                                                                                                                                                     | same JSON, `rawExecution: true`                                                                                                                                                                  |
| Groovy / BeanShell / JavaScript | `POST /console/scripting/execute` form: `script`, `scriptType` (`groovy`, `beanshell`, `javascript`), `commit`                                                                                                                                 | JSON `{ executionResult, outputText, stacktraceText }`                                                                                                                                           |
| Script save/load/delete         | `POST /console/scripting/save`, `/load`, `/delete`, `/upload`                                                                                                                                                                                  | JSON `{ content, exception… }` (not yet verified, Phase 1b)                                                                                                                                      |
| ImpEx validate                  | `POST /console/impex/import/validate` form: `scriptContent`, `validationEnum` (`IMPORT_STRICT`/`IMPORT_RELAXED`), `encoding`, `maxThreads`, `legacyMode`, `enableCodeExecution`, `distributedMode`, `sldEnabled` (+ hidden `_legacyMode=on` …) | **HTML page**; result in `<span id="validationResultMsg" data-level="notice\|error" data-result="…">`                                                                                            |
| ImpEx import                    | `POST /console/impex/import` same form                                                                                                                                                                                                         | **HTML page**; result in `<span id="impexResult" data-level="…" data-result="…">`                                                                                                                |
| ImpEx import (file)             | `POST /console/impex/import/upload` multipart: `file`, `encoding`, …                                                                                                                                                                           | HTML, same tags                                                                                                                                                                                  |
| PK analyzer                     | `POST /platform/pkanalyzer/analyze` form: `pkString`                                                                                                                                                                                           | JSON `{ pkString, counterBased, pkAsHex, pkAsBinary, pkTypeCode, pkComposedTypeCode, pkClusterId, pkCreationTime, pkCreationDate, bits[], possibleException… }`                                  |
| Log levels                      | page `GET /platform/log4j`; `POST /platform/log4j/changeLevel` form: `loggerName`, `levelName`                                                                                                                                                 | JSON `{ loggers[], levels[], loggerName, levelName }`                                                                                                                                            |
| Instance info                   | `GET /platform/about` (linked from every page)                                                                                                                                                                                                 | not yet inspected                                                                                                                                                                                |

HTML-result endpoints (ImpEx) have no JSON mode: parse the two `<span>` tags (a failed _import_ additionally renders
`<div class="box impexResult quiet"><pre>…</pre></div>` with the unresolved lines and the reason per line); HTML-escape entities in `data-result`.

Other console pages seen in the navigation (candidates for later phases): `console/impex/export`, `console/ldap`,
`platform/extensions`, `platform/config`, `platform/system`, `platform/update`, `platform/init`, `platform/dryrun`,
`platform/jars`, `platform/license`, `monitoring/*` (cache, cluster, cronjobs, database, jmx, memory, performance,
suspendresume, threaddump), `maintain/*` (cleanup, deployments, keys), `tenants`.

## Behaviour notes for the client

- Execution errors in FlexSearch are returned with HTTP 200 and a non-null `exception` object (nested causes with stack
  frames) → map to our own error type, do not rely on the status code.
- `maxCount` caps rows server-side; also show `resultCount` and `executionTime`.
- `commit=false` runs in rollback mode for FlexSearch/SQL/Groovy → default for our UI; `commit=true` only after an explicit
  confirmation on connections marked as protected.
- The `locale` and `dataSource` values come from `<select>` options on the console page (`dataSource` is `master` by default).
- The "user" field defaults to the login user.
- Never log request bodies of the login POST or any password; redact `j_password` and `X-CSRF-TOKEN` everywhere.
