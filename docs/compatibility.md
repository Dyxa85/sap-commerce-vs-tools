# Compatibility matrix

| SAP Commerce      | JDK     | Status                                                 |
| ----------------- | ------- | ------------------------------------------------------ |
| 2211-jdk21        | 21      | **Target** (developed and tested against this release) |
| other 2211 builds | 17 / 21 | best effort, not verified                              |
| < 2211            | –       | not supported                                          |

| Editor                       | Status                        |
| ---------------------------- | ----------------------------- |
| VS Code stable               | target                        |
| VS Code Insiders             | best effort                   |
| VSCodium / Cursor (Open VSX) | planned, verified in Phase 13 |

## Databases

FlexibleSearch and SQL run through the hAC, so they work with whatever database the instance uses (HSQLDB, SQL Server,
Oracle, MySQL, PostgreSQL, SAP HANA). For direct access, point a SQL extension of your choice at the JDBC settings in
`config/local.properties` (`db.url`, `db.username`); this extension does not read or store database credentials.
