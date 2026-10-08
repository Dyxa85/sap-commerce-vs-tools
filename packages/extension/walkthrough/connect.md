# What a connection is for

A connection points the extension to the **hybris Administration Console (hAC)** of one instance, e.g.
`https://localhost:9002/hac`. It is needed for everything that talks to a running system:

- FlexibleSearch and SQL queries, shown as a table
- Groovy scripts (rolled back by default)
- ImpEx validation and import
- PK analyzer, log levels, and (optional) read-only queries for AI tools

It is **not** needed for the editors, the Commerce Project and CCv2 views, type search and diagrams.

Use **Open Connection Settings**: one page to add, edit, test and remove connections. The password is stored in VS Code's
secret storage, not in your settings. Mark production-like systems as _protected_ to get a confirmation before every write.
