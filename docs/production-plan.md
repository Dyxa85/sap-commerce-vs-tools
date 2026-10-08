# Produktionsplan: SAP Commerce VS-Tools 1.0

Ergänzt [PLAN.md](../PLAN.md) (Feature-Roadmap) um die **Definition of Done für ein produktionsreifes Release**
und die konkrete Umsetzungsreihenfolge in Arbeitspaketen (WP). Jedes WP endet mit dem Phase-Gate aus PLAN.md 0.4.

## 1. Definition of Done für 1.0

**Funktional**

- Alle Features aus der Parity-Matrix (PLAN.md §2) sind ☑ oder als ✖ mit Begründung in `docs/limitations.md` dokumentiert.
- Gegen eine echte SAP-Commerce-Instanz (2211-jdk21) verifiziert: hAC-Aktionen, Typsystem-Index der echten Platform.

**Qualität**

- CI grün (Linux/macOS/Windows): Format, Lint, Typecheck, Unit-, Integrations- und Extension-Host-Tests.
- Unit-Coverage der Kernlogik (Parser, Client, Index) ≥ 80 %.
- Keine bekannten P0/P1-Bugs. Fuzz-/Property-Tests für alle Parser.
- Performance-Budget: Aktivierung < 500 ms, ImpEx-Diagnose 50k Zeilen < 1 s, Index voller Platform < 10 s kalt.

**Sicherheit & Datenschutz**

- Passwörter nur im SecretStorage; Redaktion in Logs/Fehlern getestet.
- Webviews mit strikter CSP und Escaping; keine `eval`/Remote-Skripte.
- TLS-Prüfung standardmäßig an, Abschalten nur per Verbindung und sichtbar markiert.
- Schreibende Aktionen (Commit-Modus, Import, Logger) auf „geschützten“ Verbindungen nur nach Bestätigung.
- Keine Telemetrie. Dependency-Audit sauber, Lizenzen kompatibel mit Apache-2.0.

**Veröffentlichung**

- Verpackbar (`vsce package`), Release-Workflow für Marketplace + Open VSX (mit Dry-Run geprüft).
- README (EN) mit Quickstart, Feature-Übersicht, Limitations; CHANGELOG; Issue-/PR-Templates; Marken-Disclaimer.
- Clean-Room-Audit: `docs/provenance.md` vollständig.

## 2. Arbeitspakete (Reihenfolge)

| WP  | Inhalt                                                                                                                                        | PLAN-Phase | Abhängig von |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------ |
| 1   | `core/hac`: HTTP-Client (Cookies, CSRF, 405-Retry, TLS-Option), FlexSearch/SQL, Groovy, ImpEx validate/import, PK-Analyzer, Logger            | 1, 11      | –            |
| 2   | Extension: Verbindungen (Settings + SecretStorage), Statusleiste, Befehle, Ergebnis-Webview, History, geschützte Verbindungen, Output-Channel | 1          | 1            |
| 3   | Extension-Host-Tests + Packaging-Check (`vsce package`) → **erstes nutzbares MVP**                                                            | 0/1        | 2            |
| 4   | ImpEx: Parser, TextMate, Language Server (Diagnose, Semantic Tokens, Folding, Outline, Hover, Format, Completion), Snippets                   | 2          | 3            |
| 5   | FlexibleSearch, Polyglot Query, ACL: Parser + Sprachfeatures; Ausführen aus dem Editor                                                        | 3          | 4            |
| 6   | Platform-Modell: `localextensions.xml`, `extensioninfo.xml`, Abhängigkeitsgraph, Tree-View „Commerce Project“                                 | 4          | 3            |
| 7   | Typsystem + Bean-System: Parser, Index, Navigation/Hover/Completion in XML, ImpEx, FlexSearch; Previews; Suche                                | 5          | 4, 5, 6      |
| 8   | Java-Setup (ADR 0001 validieren), Ant-Tasks, Debug-Attach, Run/Stop                                                                           | 6          | 6            |
| 9   | Spring-Beans-Index/Navigation, FlexSearch-in-Java, Process-XML + Diagramme (Type System, Module, Business Process)                            | 7, 8, 9    | 7            |
| 10  | CCv2 (Cloud-Portal-API), Solr-Konsole, Cockpit-NG-XML                                                                                         | 10, 11     | 3            |
| 11  | MCP-Server (Typsystem, FlexSearch/SQL read-only, Extension-Graph)                                                                             | 12         | 7            |
| 12  | Gesamtprüfung (Parity-Matrix beweisen, Echt-Test, Plattformen), Korrekturen                                                                   | 13         | 1–11         |
| 13  | Retrospektive → Refactoring-Liste                                                                                                             | 14         | 12           |
| 14  | Production-Hardening: Refactoring, Bundle-Größe, Docs, Release-Pipeline, Packaging, Changelog                                                 | 15         | 13           |
| 15  | Release-Vorbereitung 1.0 + `ROADMAP.md` (neue Ideen einplanen)                                                                                | 16         | 14           |

Reihenfolge-Logik: zuerst das, was sofort nutzbar und risikoarm ist (WP1–3), dann Sprachen (4–5), dann Wissen über das Projekt (6–7), dann riskantes (8) und Zusatzfeatures (9–11).

## 3. Arbeitsweise pro WP

1. Beobachten statt raten: Verhalten an der echten Instanz/Platform prüfen (nur Sprach-/Dateiformate und Endpunkte; **nie** fremder Plugin-Code).
2. Tests zuerst für Parser/Client, dann UI.
3. Phase-Gate (PLAN.md 0.4): Tests/CI, Provenance, Doku, Changelog, Mini-Retro, Matrix.
4. Ehrliche Statusführung: Was nicht verifiziert werden konnte, steht im Changelog/ADR als „nicht verifiziert“.

## 4. Bekannte Grenzen (werden in `docs/limitations.md` geführt)

- Model-Debugger mit Lazy Evaluation (IntelliJ-spezifisch) → nur Teilersatz, falls machbar.
- Cross-Language-Refactoring auf IntelliJ-Niveau → eigene Rename-Provider mit Grenzen.
- Java-Navigation hängt von Red Hat Java und generierten Models (Build nötig) ab.
