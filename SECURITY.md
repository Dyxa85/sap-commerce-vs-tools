# Security policy

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private vulnerability reporting:
[Report a vulnerability](https://github.com/Dyxa85/sap-commerce-vs-tools/security/advisories/new).
You will get an answer as soon as possible; this is a volunteer project without a service-level agreement.

## Design rules for contributors

- Credentials live only in `vscode.SecretStorage`; never in settings, logs, webviews or error messages.
- Webviews use a strict Content-Security-Policy; all data from instances (query results, logs) is escaped.
- Disabling TLS verification is opt-in per connection and clearly flagged in the UI.
- Write operations against connections marked as protected require explicit confirmation.
- No telemetry.
