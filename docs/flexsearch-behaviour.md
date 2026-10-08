# FlexibleSearch behaviour observed on a real instance (2211-jdk21)

Derived by sending probe queries to the maintainer's own hAC (FlexibleSearch console endpoint) and reading the error
messages. This is the ground truth for the parser and diagnostics. No third-party source code was consulted.

| Query / feature                                               | Result on the instance                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `SELECT {pk} FROM {Language}`                                 | ok                                                                                                                 |
| `{l:pk}` with `FROM {Language AS l}`                          | ok                                                                                                                 |
| `FROM {Language l}` (alias without `AS`)                      | **error** – "no composed type with code Language l found"                                                          |
| `{x:pk}` with unknown alias                                   | **error** – "cannot find (visible) type for alias x"                                                               |
| `{Language:pk}` with `FROM {Language}`                        | ok – the type name works as alias                                                                                  |
| `{pk}` while the type has an alias (`{Language AS l}`)        | ok                                                                                                                 |
| `{l:nosuch}`                                                  | error – "cannot search unknown field … within type Language"                                                       |
| Unknown type                                                  | error – "no composed type with code … found"                                                                       |
| Lower-case keywords                                           | ok                                                                                                                 |
| `/* … */` comment                                             | ok                                                                                                                 |
| `-- …` line comment                                           | **error** – "parameter index out of range" (the hAC appends conditions after the query, the comment swallows them) |
| Trailing `;`                                                  | **error** – "unexpected token: WHERE"                                                                              |
| `LIMIT 1`                                                     | **error** – "unexpected token: WHERE"                                                                              |
| Missing `FROM`                                                | error – "Missing FROM clause"                                                                                      |
| Unbalanced `{`                                                | error – "missing '}' for '{'"                                                                                      |
| Unterminated `'string`                                        | error – "malformed string"                                                                                         |
| `?param` without a value                                      | error – "missing values for [param]" (the console cannot bind parameters)                                          |
| `{{ SELECT … }}` subselect                                    | ok                                                                                                                 |
| `{l:name[en]}` and `{l:name[en]:o}`                           | ok                                                                                                                 |
| `JOIN` / `LEFT JOIN … ON {a:x} = {b:y}` inside the FROM brace | ok                                                                                                                 |
| `{Language!}` (exclude subtypes)                              | ok                                                                                                                 |
| `{l.isocode}` (dot instead of colon)                          | ok                                                                                                                 |
| Naked `SELECT … UNION SELECT …`                               | error – each query must be wrapped in `{{ … }}`                                                                    |
| `FROM {a AS x},{b AS y}` (comma separated braces)             | ok (found in real project code)                                                                                    |
