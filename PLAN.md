# Projektplan: SAP Commerce VS-Tools

> Open-Source-Extension für VS Code (und kompatible Editoren wie VSCodium/Cursor via Open VSX),
> die den Funktionsumfang bekannter SAP-Commerce-IDE-Tooling **eigenständig und Clean-Room** nachbaut.
> Stand: 2026-10-08 · Dieses Dokument wird pro Phase aktualisiert.

## Fortschritt

| Phase                              | Status                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 0 Fundament                        | ☑ (`docs/retros/phase-0.md`)                                                                                           |
| 0b Java-Spike                      | ◐ Desk-Research; ADR 0001 _Proposed_ – Validierung mit Red Hat Java steht aus                                          |
| 1 Instanz-Anbindung (hAC)          | ☑ gegen echte hAC verifiziert                                                                                          |
| 2–3 ImpEx, FlexibleSearch          | ☑ (ACL/Polyglot ✖, begründet)                                                                                          |
| 4 Platform-Modell, Project-Tree    | ☑                                                                                                                      |
| 5 Typsystem, Bean-System, Previews | ☑                                                                                                                      |
| 6 Java-Setup, Build, Run, Debug    | ◐ Tasks/Server/Attach/Settings-Generator fertig, nicht gegen Java-LS validiert                                         |
| 7 Spring/Java                      | ◐ spring.xml fertig; Klassen in JARs nicht auflösbar                                                                   |
| 8–9 Diagramme, Business Processes  | ☑ (im Browser-Pane geprüft, nicht im echten Webview)                                                                   |
| 10–11 CCv2, Solr, Cockpit NG       | ☐ → `ROADMAP.md` (brauchen Token/Instanz zum Verifizieren)                                                             |
| 12 MCP                             | ◐ Server fertig; Copilot-Agent-Modus nicht getestet; keine CCv2-Tools                                                  |
| 13 Gesamtprüfung                   | ☑ `docs/parity.md`, `docs/security-review.md`, Fuzz-/Performance-Messungen, Clean-Room-Audit                           |
| 14 Retrospektive                   | ☑ `docs/retros/final.md`                                                                                               |
| 15 Refactoring/Production-Ready    | ☑ Bundles minifiziert, VSIX geprüft, Release-Workflow, Templates                                                       |
| 16 Release 1.0 & Backlog           | ◐ `ROADMAP.md`, `docs/release.md` fertig; Repo/Publisher gesetzt; Store-Tokens und Screenshots fehlen (nur Maintainer) |

## Entscheidungen (geklärt am 2026-10-08)

- Lizenz: **Apache-2.0**
- Name: **SAP Commerce VS-Tools** (Hinweis: enthält die Marke „SAP“ → Disclaimer im README/Marketplace, vor 1.0 juristisch prüfen)
- Testinstanz: `https://localhost:9002/hac` (lokale Platform). Zugangsdaten konfiguriert der Nutzer selbst in den Projekt-Einstellungen der Extension (Passwort im SecretStorage). Keine Env-Variablen, nichts im Repo.
- hAC-Endpunkte werden **nicht** aus fremdem Quelltext abgeleitet, sondern an der eigenen Instanz beobachtet (Clean-Room, siehe `docs/provenance.md`).
- Zielversion: **SAP Commerce 2211-jdk21**

---

## 0. Leitplanken

### 0.1 Clean-Room-Regeln (rechtlich sauber)

Das EPAM-Plugin steht unter LGPL-3.0/GPL-3.0. Wer davon Code oder Grammatiken übernimmt, erzeugt ein abgeleitetes Werk.
Wir bauen deshalb **ausschließlich Verhalten und Funktionsumfang** nach:

1. **Erlaubte Quellen:** öffentliche Feature-Beschreibungen (README, Marketplace-Seite, Changelog-Titel, Screenshots),
   offizielle SAP-Dokumentation (help.sap.com), die XSDs/Dateien der **eigenen** SAP-Commerce-Installation,
   eigenes Ausprobieren des IntelliJ-Plugins als Anwender (Black-Box-Verhalten), eigene Tests gegen eine echte Instanz.
2. **Verbotene Quellen:** Quelltext des EPAM-Repos (`*.kt`, `*.java`, `*.bnf`, `*.flex`, Testdaten, Icons, Texte/Messages 1:1).
   Wer den Quelltext gelesen hat, schreibt den entsprechenden Teil nicht.
3. **Eigene Grammatiken** für ImpEx, FlexibleSearch, Polyglot Query, ACL: abgeleitet aus SAP-Doku und eigenen Beispieldateien.
4. **Eigene Namen, Icons, Texte, Farben.** Kein Kopieren von UI-Strings.
5. **Herkunftsprotokoll:** `docs/provenance.md` – pro Feature/Grammatik kurz notieren, woraus es abgeleitet wurde.
6. **Beiträge Dritter:** `CONTRIBUTING.md` verlangt Bestätigung (DCO `Signed-off-by`), dass der Beitrag keinen EPAM-Quelltext enthält.
7. **SAP-Artefakte nicht ausliefern:** `items.xsd`, `beans.xsd`, Platform-JARs werden zur Laufzeit aus der Installation des Nutzers gelesen.
8. **Marken:** „SAP“/„Hybris“ nur beschreibend („for SAP Commerce“), Disclaimer „nicht von SAP affiliiert“, kein SAP-Logo.

> Hinweis: Keine Rechtsberatung. Vor dem 1.0-Release einmal kurz juristisch gegenlesen lassen (v. a. Marken/Namen).

### 0.2 Technische Entscheidungen (Defaults, jederzeit änderbar)

| Thema           | Entscheidung                                                                                              | Begründung                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Lizenz          | **Apache-2.0** (Alternative: MIT)                                                                         | Erlaubt durch Clean-Room; Patentklausel, Firmen-freundlich    |
| Sprache         | **TypeScript** (strict)                                                                                   | Standard für VS-Code-Extensions                               |
| Repo            | **pnpm-Monorepo**                                                                                         | Trennung Extension / Language-Server / Core-Libs / MCP-Server |
| Sprach-Features | **LSP** (`vscode-languageserver`), eigener Prozess                                                        | Performance, Wiederverwendbarkeit (z. B. auch für MCP/CLI)    |
| Parser          | handgeschriebener fehlertoleranter Recursive-Descent-Parser (alternativ Chevrotain)                       | Gute Fehlerwiederherstellung für Completion bei kaputtem Code |
| Highlighting    | TextMate-Grammatik (Basis) + Semantic Tokens (präzise)                                                    | Funktioniert sofort + kontextsensitiv                         |
| Build           | `esbuild`, `tsc --noEmit`                                                                                 | schnell, kleine Bundles                                       |
| Tests           | `vitest` (Unit), `@vscode/test-electron` (Integration), Mock-hAC-Server, Playwright optional für Webviews |                                                               |
| Qualität        | ESLint, Prettier, Changesets, Conventional Commits                                                        |                                                               |
| CI              | GitHub Actions: Linux/macOS/Windows-Matrix                                                                |                                                               |
| Publish         | `vsce` (VS Marketplace) + `ovsx` (Open VSX)                                                               |                                                               |
| Telemetrie      | **keine**                                                                                                 | Vertrauen in Enterprise-Umfeld                                |
| Secrets         | `vscode.SecretStorage` für Passwörter/Tokens                                                              | nie in `settings.json`                                        |
| i18n            | Englisch zuerst; Texte über `vscode-nls`/`l10n`-Bundle                                                    | Deutsch später                                                |

### 0.3 Repo-Struktur (Ziel)

```
/
├─ packages/
│  ├─ extension/        # VS-Code-Extension (UI, Commands, Views, Webviews)
│  ├─ language-server/  # LSP: ImpEx, FlexSearch, Polyglot, ACL, XML-Semantik
│  ├─ core/             # Platform-/Typesystem-Modell, Index, hAC-Client (UI-frei)
│  ├─ mcp-server/       # MCP-Server (später)
│  └─ test-fixtures/    # Eigene, synthetische Mini-Platform + Beispiel-Dateien
├─ tools/mock-hac/      # Mock-hAC für Tests/Demo
├─ docs/                # provenance.md, architecture.md, user guide
└─ PLAN.md
```

### 0.4 Phase-Gate (gilt am Ende JEDER Phase)

- [ ] Alle Akzeptanzkriterien der Phase erfüllt und demonstrierbar
- [ ] Unit-/Integrationstests grün, Coverage der neuen Logik ≥ 80 %
- [ ] CI grün auf Linux, macOS, Windows
- [ ] `docs/provenance.md` aktualisiert (Clean-Room-Nachweis)
- [ ] Nutzerdoku + CHANGELOG-Eintrag
- [ ] Mini-Retro (15 min, Notiz in `docs/retros/phase-N.md`): Was lief gut, was schlecht, was ändern wir?
- [ ] Parity-Matrix (Abschnitt 2) aktualisiert

---

## 1. Phasenübersicht

| #   | Phase                                  | Ergebnis                                            | Aufwand* | Risiko                  |
| --- | -------------------------------------- | --------------------------------------------------- | -------- | ----------------------- |
| 0   | Fundament                              | Repo, CI, Lizenz, Mock-hAC, Fixtures                | S        | niedrig                 |
| 1   | Instanz-Anbindung (hAC)                | ImpEx/FlexSearch/SQL/Groovy ausführen, Verbindungen | M        | niedrig                 |
| 2   | ImpEx-Sprachunterstützung              | Highlighting, Diagnostics, Completion, Format       | L        | mittel                  |
| 3   | FlexibleSearch, Polyglot Query, ACL    | Weitere Sprachen                                    | M        | mittel                  |
| 4   | Platform- & Extension-Modell           | Erkennung, Modul-Explorer, `localextensions.xml`    | M        | mittel                  |
| 5   | Type System & Bean System              | Index, XML-Support, Navigation, Previews            | L        | mittel                  |
| 6   | Java-Projekt-Setup & Build/Run/Debug   | Classpath für JDT LS, Ant-Tasks, Attach             | L        | **hoch** (Spike zuerst) |
| 7   | Spring-/Java-Integration               | Bean-Navigation, FlexSearch in Java-Strings, Models | L        | mittel–hoch             |
| 8   | Visualisierung                         | Diagramme Type System / Module                      | M        | niedrig                 |
| 9   | Business Processes                     | Process-XML-Support + Diagramm                      | M        | niedrig                 |
| 10  | Cloud (CCv2)                           | Builds/Deployments/Umgebungen                       | M        | mittel (API-Zugang)     |
| 11  | Weitere Instanz-Tools                  | Logger, Solr, PK-Analyzer, Cockpit/Backoffice-XML   | M        | niedrig                 |
| 12  | KI/MCP                                 | MCP-Server (Typesystem, FlexSearch, …)              | S–M      | niedrig                 |
| 13  | **Gesamtprüfung & Korrektur**          | Alle Features gegen Parity-Matrix verifiziert       | M        | –                       |
| 14  | **Retrospektive**                      | Gesamtrückblick, Entscheidungen                     | S        | –                       |
| 15  | **Refactoring & Production-Readiness** | Veröffentlichbare Qualität                          | M        | –                       |
| 16  | **Release 1.0 & Backlog**              | Veröffentlichung, Roadmap v1.x/2.0                  | S        | –                       |

*S ≈ Tage, M ≈ 1–3 Wochen, L ≈ 3–6 Wochen (grobe Orientierung bei Teilzeit-Entwicklung mit KI-Unterstützung).

Reihenfolge-Logik: Zuerst, was **unabhängig, nützlich und risikoarm** ist (1–3), damit früh ein veröffentlichungsfähiger Nutzen entsteht.
Dann das Fundament für Wissens-Features (4–5). Das riskante Java-Thema (6) wird früh als **Spike** (Phase 0b) entschärft, aber erst später ausgebaut.

---

## 2. Parity-Matrix (Feature-Checkliste)

Grundlage: öffentlich beschriebener Funktionsumfang des IntelliJ-Plugins (README) + unsere Erweiterungen.
Status-Spalte wird laufend gepflegt: ☐ offen · ◐ teilweise · ☑ fertig · ✖ nicht machbar (dokumentiert)

| #   | Feature                                                | Phase | Status | Anmerkung                                                                                                                                            |
| --- | ------------------------------------------------------ | ----- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Projekt-/Extension-Import inkl. Abhängigkeitsauflösung | 4, 6  | ◐      | Extension-Graph, Ladereihenfolge und Java-Settings-Generator fertig; Java-Import nicht gegen JDT LS validiert (ADR 0001)                             |
| F2  | Eclipse-/Maven-/Gradle-Extensions neben Platform       | 4, 6  | ◐      | Extensions aller Layouts werden erkannt; Java-Settings aus geladenen Extensions (nicht gegen JDT LS validiert)                                       |
| F3  | Modul-Gruppierung über Konfiguration                   | 4     | ◐      | Gruppen Platform/Modules/Custom/Other im Baum; frei definierbare Gruppen → ROADMAP                                                                   |
| F4  | Kompilieren/Build aus der IDE                          | 6     | ☑      | Ant-Targets als Befehle/Tasks, javac-Problem-Matcher, Server start/debug/stop; Task-Provider per Host-Test geprüft, Ant-Lauf selbst nicht ausgeführt |
| F5  | Erweiterter Debugger für Model-Klassen (Lazy Eval)     | 11    | ✖      | Debug-API erlaubt keine Custom-Renderer (docs/limitations.md); „Model als Tabelle“ → ROADMAP                                                         |
| F6  | Suche über Type- und Bean-System                       | 5     | ☑      | Go to Type/Attribut/Enum-Wert/Bean (Typ- und Bean-System)                                                                                            |
| F7  | Kotlin-Unterstützung (kotlinnature)                    | 6     | ◐      | Doku in docs/java-setup.md (Kotlin-Extension nötig)                                                                                                  |
| F8  | ImpEx-Editor (Highlight, Validierung, Format, Go-to)   | 2     | ☑      | Verhalten an der Instanz gemessen; 456 Real-Dateien geprüft; User-Rights-Blöcke nur erkannt                                                          |
| F9  | ACL-Editor                                             | 3     | ✖      | Format gehört zu einem anderen Plugin, keine öffentliche Spezifikation – User-Rights in ImpEx werden erkannt (docs/limitations.md)                   |
| F10 | FlexibleSearch-Editor                                  | 3     | ☑      | Verhalten an der Instanz gemessen; typ-/attributbewusst                                                                                              |
| F11 | Polyglot-Query-Editor                                  | 3     | ✖      | Keine öffentliche Syntax-Spezifikation / kein Ausführungs-Endpunkt (docs/limitations.md)                                                             |
| F12 | XML-Editoren: items.xml                                | 5     | ☑      | items.xml: Diagnose, Navigation, Vervollständigung, Hover, Outline, Quick Fixes; gegen 215 echte Dateien geprüft                                     |
| F13 | XML-Editoren: beans.xml                                | 5     | ☑      | beans.xml: Diagnose, Navigation, Vervollständigung, Hover; Bean-Index                                                                                |
| F14 | XML-Editoren: cockpitng-Konfiguration                  | 11    | ☐      | → ROADMAP                                                                                                                                            |
| F15 | XML-Editoren: Deployment-Konfigs                       | 5     | ◐      | Deployment/Spring-Konfigs: spring.xml (Beans, Overrides, Aliase, Java-Klassen) fertig; Deployment-XML folgt                                          |
| F16 | CCv2 CI/CD-Integration                                 | 10    | ◐      | CCv2-Ansicht (Repo-Struktur, manifest.json-Gliederung) fertig und getestet; Cloud-Portal-API (Builds/Deployments) → ROADMAP, braucht Token           |
| F17 | Remote-Groovy-Ausführung                               | 1     | ☑      | gegen echte hAC verifiziert                                                                                                                          |
| F18 | Solr-Query-Ausführung                                  | 11    | ☐      | → ROADMAP (braucht Solr-Instanz)                                                                                                                     |
| F19 | hAC-API-Integration (ImpEx, FlexSearch, SQL, …)        | 1     | ☑      | gegen echte hAC verifiziert                                                                                                                          |
| F20 | Logger-Konfiguration pro Instanz                       | 11    | ☑      | `sapcommerce.logger.set`; Kontrakt an echter Instanz gelesen, Änderung nur gegen Mock getestet                                                       |
| F21 | Diagramm: Business Process                             | 9     | ☑      | Prozess-XML-Editor + Diagramm (Webview, Zoom/Pan, Klick springt in die Datei); Host-Tests                                                            |
| F22 | Diagramm: Type System                                  | 8     | ☑      | Typ-Diagramm (Vererbung, Referenzen, Klick navigiert); Host-Tests                                                                                    |
| F23 | Diagramm: Modul-Abhängigkeiten                         | 8     | ☑      | Extension-Abhängigkeitsdiagramm (custom/alle/Abhängigkeiten/Abhängige); Host-Tests                                                                   |
| F24 | Type-System-Preview                                    | 5     | ☑      | Typ-Vorschau (Webview)                                                                                                                               |
| F25 | Bean-System-Preview                                    | 5     | ☑      | Bean-Vorschau im selben Panel wie die Typ-Vorschau                                                                                                   |
| F26 | Erweiterter Project-Tree                               | 4     | ☑      | Eigene Ansicht „Commerce Project“ in der Seitenleiste „SAP Commerce“                                                                                 |
| F27 | Spring-Unterstützung (Bean-Navigation)                 | 7     | ◐      | spring.xml: Bean-Navigation, Overrides, Java-Klassen aus Quellen; Klassen in JARs nicht auflösbar (limitations)                                      |
| F28 | JUnit-Integration                                      | 6     | ◐      | Doku in docs/java-setup.md (Java Test Runner; Platform-Tests über ant)                                                                               |
| F29 | JRebel-Kompatibilität                                  | 6     | ◐      | Doku in docs/java-setup.md                                                                                                                           |
| F30 | Groovy-Unterstützung (Projekt)                         | 6     | ◐      | Doku in docs/java-setup.md; hAC-Groovy-Ausführung existiert (F17)                                                                                    |
| F31 | Datenbank-Tools-Integration                            | 11    | ◐      | SQL über hAC (F19); Hinweise in docs/compatibility.md; kein Code                                                                                     |
| F32 | MCP-/KI-Tools (Typesystem, FlexSearch, CCv2)           | 12    | ◐      | MCP-Server (docs/mcp.md); Copilot-Agent-Modus ungetestet; keine CCv2-Tools                                                                           |
| F33 | PK-Analyzer                                            | 11    | ☑      | gegen echte hAC verifiziert                                                                                                                          |

Zusätzliche Features aus der Vorgängerextension (vscode-hybris-tools): ImpEx validieren/importieren, Groovy/Beanshell, FlexSearch/SQL, PK-Analyzer – abgedeckt durch F17, F19, F33.

---

## 3. Phasen im Detail

### Phase 0 – Fundament & Clean-Room-Setup (S)

**Aufgaben**

- Repo anlegen, Monorepo-Gerüst, TypeScript-strict, ESLint/Prettier, Changesets
- LICENSE (Apache-2.0), `NOTICE`, `CONTRIBUTING.md` (inkl. DCO + Clean-Room-Klausel), `CODE_OF_CONDUCT.md`, `SECURITY.md`
- `docs/provenance.md` (Vorlage), `docs/architecture.md` (Skizze)
- CI-Matrix (Linux/macOS/Windows), Extension-Tests im Headless-Modus
- **Mock-hAC** (`tools/mock-hac`): Login (CSRF-Token, Session-Cookie), ImpEx-Import/Validate, FlexSearch, SQL, Groovy – deterministische Antworten
- **Fixtures**: eigene synthetische Mini-Platform (3–4 Extensions, `localextensions.xml`, `items.xml`, `beans.xml`, Beispiel-ImpEx) – **selbst geschrieben**
- Entscheidung: Projektname, Extension-ID, Publisher, Logo (eigenes)

**Spike 0b (parallel, zeitboxed 2–3 Tage): Java-Classpath**

- Frage: Wie bringen wir die Platform (hunderte Extensions, `bootstrap/bin`, `ext/*/lib`, generierte Models) in JDT LS?
- Varianten: (a) `.project`/`.classpath` pro Extension generieren, (b) Gradle/Maven-Wrapper-Metadaten generieren, (c) `java.project.referencedLibraries` + `sourcePaths`
- Ergebnis: Entscheidungsdokument `docs/adr/0001-java-project-model.md`

**Akzeptanz**: CI grün, Mock-hAC läuft, leere Extension aktivierbar, ADR zu Java liegt vor.

---

### Phase 1 – Instanz-Anbindung (hAC) (M)

Features: F17, F19 (+ Teile F33)

**Aufgaben**

- `core/hac-client`: Login, CSRF, Session-Handling, Timeouts, SSL-Optionen (inkl. selbstsignierter Zertifikate, explizit opt-in), Fehlerklassifizierung
- Verbindungsverwaltung: mehrere Instanzen/Umgebungen (lokal, dev, stage), Profile in Settings, Secrets im SecretStorage, aktive Verbindung in Statusleiste
- Befehle: ImpEx **validieren** und **importieren** (aktuelle Datei/Selektion), FlexibleSearch ausführen, SQL ausführen, Groovy/Beanshell ausführen (Commit-Modus wählbar), Scripts aus Datei
- Ergebnisdarstellung: Webview-Tabelle (sortier-/filter-/exportierbar als CSV/JSON), Output-Channel für Logs, Verlauf (History) letzter Abfragen
- Sicherheitsabfragen bei Schreibaktionen auf nicht-lokalen Umgebungen (konfigurierbar, z. B. „Prod markiert → Warnung“)

**Akzeptanz**

- Alle Aktionen gegen Mock-hAC automatisiert getestet; manuell gegen echte Instanz verifiziert (Checkliste in `docs/qa/phase1.md`)
- Passwörter tauchen nie in Logs/Settings auf (Test)
- Große Ergebnismengen (≥100k Zeilen) werden paginiert/virtualisiert

---

### Phase 2 – ImpEx-Sprachunterstützung (L)

Feature: F8

**Aufgaben**

- Sprach-ID `impex`, Dateiendung `.impex`, Language-Configuration (Kommentare, Klammern)
- TextMate-Grammatik (Basis-Highlighting)
- Eigener fehlertoleranter Parser: Header (`INSERT`, `INSERT_UPDATE`, `UPDATE`, `REMOVE`), Modifier, Attribute, Macros (`$var=`), Zeilenfortsetzung, Dokument-IDs, `#%`-Beanshell-Zeilen, Zellwerte, Referenzen, Übersetzer (`translator`), `lang`, `unique`
- LSP-Features: Diagnostics (Syntax, Spaltenanzahl-Mismatch, unbekannte Modifier), Semantic Tokens (Spalte↔Header-Zuordnung), Folding (Blöcke), Outline, Hover (Macros auflösen), Code Actions (z. B. Spalten angleichen)
- **Formatter**: Spalten ausrichten (an/aus, konfigurierbar), Trailing-Whitespace
- Snippets, Spalten-Highlighting (Alternating Column Tint)
- _Typesystem-abhängige_ Completion (Typ-/Attributnamen) wird erst in Phase 5 angedockt – hier schon Extension-Point einbauen

**Akzeptanz**

- Eigene Korpus-Tests: ≥ 100 synthetische ImpEx-Beispiele (gültig/ungültig) mit Erwartungswerten
- Parser verliert bei Fehlern nicht den Rest des Dokuments (Fuzz-/Property-Tests)
- Datei mit 50.000 Zeilen: Diagnostics < 1 s nach Edit (inkrementell/gedrosselt)

---

### Phase 3 – FlexibleSearch, Polyglot Query, ACL (M)

Features: F9, F10, F11

**Aufgaben**

- FlexibleSearch (`.flexibleSearch`/`.fxs`): Parser für `SELECT … FROM {Type AS t JOIN …} WHERE {t:attr} …`, `{{ subselect }}`, `?param`, Sprachsyntax `[en]`, `LEFT JOIN`, `UNION`
- Diagnostics, Highlighting, Formatter, Completion (Keywords/Funktionen; Typ-/Attributnamen später über Phase 5)
- Ausführen direkt aus dem Editor (Phase 1) inkl. Parameterabfrage für `?param`
- Polyglot Query: eigene Sprache + Ausführung (hAC/PGQ-Endpoint, soweit zugänglich)
- ACL (Access Control Lists, `.acl`): Grammatik, Highlighting, Validierung

**Akzeptanz**: eigener Testkorpus je Sprache; Ausführung aus Editor getestet gegen Mock-hAC.

---

### Phase 4 – Platform- & Extension-Modell (M)

Features: F1 (Teil), F2, F3, F26

**Aufgaben**

- Platform-Erkennung (`platform/`, `config/localextensions.xml`, `env.properties`, Mehrfach-Workspaces)
- Parser für `localextensions.xml` (`<extension dir>`, `<extension name>`, `<path dir autoload>`), `extensioninfo.xml` (`requires-extension`, `coremodule`, `webmodule`, `backoffice`…)
- Auflösung der Extension-Menge inkl. transitiver Abhängigkeiten, Zyklen-Erkennung, Fehlermeldungen
- Modul-Gruppierung per Konfiguration (z. B. Custom / Platform / Config / Third-Party, per Glob)
- **Eigener Tree-View** „Commerce Project“: Extensions → Module (core/web/backoffice) → relevante Dateien (`*-items.xml`, `*-beans.xml`, `*-spring.xml`, `project.properties`, ImpEx-Ordner)
- File-Watcher: Änderungen an `localextensions.xml`/`extensioninfo.xml` aktualisieren das Modell
- Unterstützung von Maven-/Gradle-/Eclipse-Extensions im Ordnerlayout (Erkennung, Kennzeichnung)

**Akzeptanz**: Fixture-Platform wird korrekt aufgelöst; Fehlerfälle (fehlende Extension, Zyklus) erzeugen Diagnostics in `localextensions.xml`.

---

### Phase 5 – Type System & Bean System (L)

Features: F6, F12, F13, F15, F24, F25 (+ Typesystem-Completion für Phase 2/3)

**Aufgaben**

- `core/typesystem`: Parser für `*-items.xml` (Item-Typen, Attribute, Relationen, Enums, Collections, Maps, Deployments/Typecodes, Persistence, Indizes, Custom Properties), Vererbung/Overrides, Merge über Extension-Reihenfolge
- `core/beansystem`: Parser für `*-beans.xml` (Beans, Enums, Properties, Hints, Vererbung)
- Persistenter, inkrementeller Index (Datei-Hash-basiert, Worker-Thread/LSP-Prozess)
- XML-Support: Schema-Validierung über XSDs aus der Installation (Zuordnung per Katalog/Setting; Abhängigkeit zur XML-Extension prüfen vs. eigene Validierung), eigene semantische Diagnostics (unbekannter Supertyp, doppelte Typcodes, Relation ohne Gegenseite, Attribut-Typ unbekannt), Completion (Typen, Attribute, Enums), Hover, Go-to-Definition, Find-References
- Typesystem-Wissen in ImpEx/FlexSearch andocken: Typ-/Attributnamen-Completion, Validierung, Go-to-Definition (ImpEx-Spalte → `items.xml`)
- **Suche** (Quick-Pick): „Go to Type/Bean/Attribute“
- **Previews**: Webview mit aufgelöstem Typ (inkl. geerbter Attribute, Herkunfts-Extension, Relationen)
- Deployment-/Tabellen-Info (Typecode, Tabelle, Spaltenname) am Typ

**Akzeptanz**

- Aus Fixture-Platform korrekt gemergtes Typsystem; Gegenprobe durch Vergleich mit Live-Typsystem einer echten Instanz (Skript, das hAC-Typinfo abruft und diffed)
- Index-Aufbau einer vollen Platform (~500 Extensions-XMLs) < 10 s kalt, inkrementelles Update < 200 ms

---

### Phase 6 – Java-Projekt-Setup, Build, Run, Debug (L, hohes Risiko)

Features: F1 (Rest), F4, F7, F28, F29, F30

**Aufgaben** (Umsetzung gemäß ADR 0001 aus Spike 0b)

- Befehl „Projekt für Java vorbereiten“: erzeugt/aktualisiert Projektmetadaten (Classpath, Source-Roots, Library-Pfade inkl. `bootstrap/bin`, `ext/*/lib`, `web/webroot/WEB-INF/lib`, generierte Model-/Gen-Ordner), idempotent, mit Vorschau/Diff
- Umgang mit Platform-Build-Artefakten (Models werden vom Build erzeugt → Hinweis/Auto-Trigger `ant build`)
- Ant-Integration: Tasks-Provider (`ant clean all`, `ant build`, `ant server`, `ant yunitinit`, `ant updatesystem` …), Environment-Setup (`setantenv`), Fortschritt/Problem-Matcher für Compiler-Fehler
- Start/Stop der lokalen Platform, Log-Ansicht, Debug-Attach-Konfiguration (JDWP-Port aus `tomcat`-Config lesen), Hot-Swap-Hinweise, JRebel-Hinweise/Konfig
- Test-Integration: JUnit über Java Test Runner (Classpath-abhängig), Platform-Integrationstests via `ant`-Target
- Groovy/Kotlin: Nur Setup-Unterstützung (`kotlinnature`-Erkennung, Source-Roots) + Doku, Sprachservices von bestehenden Extensions
- Performance-Strategie: Lazy-Import (nur genutzte Extensions in den Classpath), konfigurierbar

**Akzeptanz**: Auf Fixture + realer Platform: Java-Navigation in Extension-Code funktioniert (Go-to-Definition in Platform-Klassen), Debug-Attach klappt, Build-Fehler erscheinen im Problems-Panel. Speicherverbrauch dokumentiert.

---

### Phase 7 – Spring- & Java-Integration (L)

Feature: F27 (+ Querbezüge)

**Aufgaben**

- Spring-XML-Index (`*-spring.xml`): Beans, Aliase, Parent-Beans, `ref`, `class`, Property-Namen, Profile/Overrides über Extension-Reihenfolge
- Navigation: XML ↔ Java-Klasse, Bean-Referenzen, Find-References für Beans, Diagnostics (unbekannte Bean-Referenz, unbekannte Klasse)
- Generierte Model-Klassen ↔ `items.xml` (Go-to-Type vom Model aus)
- FlexibleSearch in Java-Strings: TextMate-Injection fürs Highlighting + eigene Provider (Completion/Diagnostics) auf Java-Dokumenten für erkannte Muster (`FlexibleSearchQuery`, `"SELECT {…} FROM {…}"`)
- Cross-Language-Rename (Typ/Attribut ↔ `items.xml`, ImpEx, FlexSearch) als **eigener** Rename-Provider mit Vorschau – Grenzen dokumentieren

**Akzeptanz**: Navigation und Diagnostics funktionieren auf Fixture; bekannte Grenzen gegenüber IntelliJ stehen in `docs/limitations.md`.

---

### Phase 8 – Visualisierung (M)

Features: F22, F23

**Aufgaben**

- Gemeinsame Diagramm-Webview-Basis (Cytoscape/D3 – Lizenz prüfen, nur kompatible), Zoom/Pan, Suche, Export SVG/PNG, Theme-Anpassung (Dark/Light)
- Type-System-Diagramm: Vererbung, Relationen, Filter nach Extension/Typ, „Umgebung eines Typs“
- Modul-Abhängigkeits-Diagramm: Extension-Graph aus Phase 4, Hervorhebung von Zyklen/Platform vs. Custom
- Klick auf Knoten → Navigation zur Definition

**Akzeptanz**: Große Graphen (≥ 500 Knoten) bleiben bedienbar; Tastatur-Bedienbarkeit/A11y-Basis.

---

### Phase 9 – Business Processes (M)

Feature: F21

**Aufgaben**

- Parser für `*-process.xml` (Aktionen, Transitionen, Wait/Split/End, Aliase)
- Diagnostics (unbekannte Aktions-Bean, fehlende Transition, nicht erreichbare Knoten), Navigation zur Spring-Bean (Phase 7)
- Diagramm (Phase-8-Basis), Layout links→rechts, Klick-Navigation
- Completion für Aktions-Beans

**Akzeptanz**: Fixture-Process wird korrekt visualisiert; Fehlerfälle werden gemeldet.

---

### Phase 10 – Cloud (CCv2) (M)

Feature: F16

**Aufgaben**

- Authentifizierung per API-Token (SecretStorage), Subscription-/Umgebungsauswahl
- Tree-View: Umgebungen, Builds, Deployments, Status; Aktionen: Build starten, Deploy, Logs abrufen, Fortschritt beobachten
- `manifest.json`-Support (Schema, Validierung, Completion)
- Fehlerkommunikation bei abgelaufenem Token/Rechten; Rate-Limits beachten
- Zugriff nur auf explizite Nutzeraktion, Sicherheitsbestätigung bei Deploys

**Akzeptanz**: Gegen aufgezeichnete API-Mocks getestet; echter Test mit eigenem CCv2-Zugang (siehe offene Entscheidungen).

---

### Phase 11 – Weitere Instanz- & Editor-Tools (M)

Features: F5 (Spike), F14, F18, F20, F31, F33

**Aufgaben**

- Logger-Verwaltung pro Instanz (Logger lesen, Level setzen, Favoriten, Reset)
- Solr: Query-Ausführung gegen Solr-Instanz (Cores, Query, Ergebnisansicht)
- PK-Analyzer (Typecode/Item-Info aus PK)
- Cockpit-NG/Backoffice-XML-Support: Schemas, Completion für Widgets/Editoren, Navigation zu Typen
- DB-Integration: Kompatibilität/Empfehlung (z. B. SQL-Extensions), Export der Verbindungsdaten
- **Spike F5**: Lässt sich „Model-Ansicht beim Debuggen“ über Debug-Adapter-Tracker und Evaluate-Aufrufe annähern (z. B. Befehl „Model als Tabelle anzeigen“)? Ergebnis: umsetzen oder als ✖ dokumentieren

**Akzeptanz**: jeweilige Features gegen Mock bzw. echte Instanz getestet.

---

### Phase 12 – KI/MCP (S–M)

Feature: F32

**Aufgaben**

- `packages/mcp-server`: Tools für Typesystem-Abfragen, Bean-System, FlexSearch-/SQL-Ausführung (mit Row-Limit & Read-only-Default), Extension-Graph, optional CCv2-Status
- Registrierung in VS Code als MCP-Server-Provider (falls API verfügbar) + Standalone-CLI-Start für andere Clients
- Sicherheitskonzept: nur lesende Tools standardmäßig, Schreibaktionen opt-in, Umgebungs-Whitelist, keine Credentials in Tool-Ausgaben

**Akzeptanz**: Tools mit MCP-Inspector getestet; Dokumentation der Konfiguration.

---

### Phase 13 – Gesamtprüfung & Korrektur (M)

> Ziel: Jede Zeile der Parity-Matrix wird **geprüft und bewiesen**, nicht angenommen.

**Aufgaben**

1. **Feature-Audit:** Pro Matrix-Zeile F1–F33: Demo-Skript + automatisierter Test + Doku-Link. Status auf ☑ oder dokumentiertes ✖.
2. **Echt-Test:** Komplette Durchlaufprüfung gegen eine reale SAP-Commerce-Instanz/-Platform (Checkliste `docs/qa/full-regression.md`).
3. **Cross-Platform:** Windows / macOS / Linux (Pfadlogik, Shell-Aufrufe, `ant`-Wrapper, Zeilenenden).
4. **Kompatibilität:** VS Code (Stable + Insiders), VSCodium, Cursor; Remote-SSH/Dev-Container/WSL.
5. **Performance:** Benchmarks (Index, Parser, Startzeit, RAM) – Budget einhalten: Aktivierung < 500 ms, Idle-RAM der Extension < 200 MB bei voller Platform.
6. **Robustheit:** Fuzz-Tests Parser, Netzwerkfehler, kaputte XML, riesige Dateien, parallele Verbindungen.
7. **Security-Review:** Credentials-Handling, Webview-CSP, Command-Injection (Ant/Shell), SSRF-Aspekte bei konfigurierbaren URLs, Dependency-Audit.
8. **Accessibility/UX:** Tastaturbedienung, Kontrast in Webviews, konsistente Befehlsnamen.
9. **Fehlerbehebung:** Alle gefundenen Defekte priorisieren und beheben (P0/P1 vor Release, P2 ins Backlog).
10. **Clean-Room-Audit:** Provenance-Datei vollständig? Keine fremden Texte/Icons? Dependency-Lizenzen (`license-checker`) kompatibel mit Apache-2.0?

**Akzeptanz**: Matrix vollständig bewertet, keine offenen P0/P1, Regressionsliste grün.

---

### Phase 14 – Retrospektive (S)

**Ablauf (Workshop-Stil, 1 Tag, Ergebnis in `docs/retros/final.md`)**

- Rückblick: Plan vs. Realität (Aufwand, Reihenfolge, Risiken eingetreten?)
- Architektur-Review: Was würden wir heute anders schneiden? Wo ist technische Schuld?
- Nutzer-Sicht: Durchgehendes „Erster-Eindruck“-Test (Installation → erste Abfrage → erster Typ-Lookup) mit 2–3 externen Testern
- Prozess: Was hat Clean-Room gekostet/gebracht? Test-Strategie ausreichend?
- Ergebnis: priorisierte **Refactoring-Liste** (Phase 15) und **Ideen-Liste** (Phase 16)

---

### Phase 15 – Refactoring & Production-Readiness (M)

**Code**

- Refactorings aus der Retro (Modulgrenzen, doppelte Logik, API-Konsistenz)
- Fehlerbehandlung & Logging vereinheitlichen, Telemetrie bleibt aus
- Bundle-Größe minimieren (esbuild, Tree-Shaking, lazy Activation Events)
- Settings-Schema aufräumen, Migrationen für Konfiguration (Versionierung)
- Public-API/Extension-API klar abgrenzen (falls andere Extensions andocken sollen)

**Qualität**

- Coverage-Ziele, Mutation-Tests optional für Parser
- Dependabot/Renovate, `npm audit` in CI, SBOM

**Veröffentlichung**

- README mit GIFs/Screenshots, Quickstart, Troubleshooting, Limitations (Vergleich zu IntelliJ ehrlich)
- Marketplace-Metadaten (Kategorien, Keywords, Icon, Galerie-Banner), Open-VSX-Eintrag
- Release-Pipeline: Tag → Build → Test → `vsce publish` + `ovsx publish` → GitHub Release mit Changelog
- Issue-/PR-Templates, Discussions, Roadmap-Datei, Support-Policy, SemVer-Regeln
- Namens-/Marken-Check final, Disclaimer im README
- Pre-Release-Kanal (Marketplace Pre-Release) für Beta-Tester

**Akzeptanz**: „Frische Maschine“-Test: Installation aus VSIX/Marketplace, Quickstart funktioniert ohne Vorwissen; Release-Pipeline lief mindestens einmal als Dry-Run.

---

### Phase 16 – Release 1.0 & Backlog-Planung (S)

- 1.0 veröffentlichen, Ankündigung (SAP Community, Reddit, LinkedIn, GitHub Topics)
- Feedback-Kanäle öffnen (Issues/Discussions)
- **Ideen-Backlog** aus Retro + Nutzerfeedback bewerten (Wert × Aufwand × Risiko) und in `ROADMAP.md` einplanen
- Vorläufige Kandidaten: weitere Sprach-Server-Features (Rename/Refactoring), Backoffice-Wizards/Widget-Designer-Hilfen, Test-Daten-Generator, ImpEx-Diff/Export-Assistent (Daten → ImpEx), Performance-Profiling-Helfer, Dev-Container/Docker-Setups für Commerce, Telemetrie-freie Nutzungsstatistik (opt-in), Unterstützung für Composable Storefront (Angular/Spartacus) Workflows

---

## 4. Risikoregister

| Risiko                                                         | Wirkung          | Gegenmaßnahme                                                            |
| -------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------ |
| Java-Classpath/JDT-LS skaliert nicht bei voller Platform       | Hoch             | Spike 0b, Lazy-Import, ADR, ggf. reduzierte Funktionalität dokumentieren |
| Kein Zugriff auf echte SAP-Commerce-Instanz/-Lizenz zum Testen | Hoch             | Mock-hAC + eigene Fixtures; Zugang früh klären (siehe unten)             |
| Versehentliche Übernahme von EPAM-Code/-Texten                 | Hoch (rechtlich) | Clean-Room-Regeln, Provenance, DCO, Review-Checkliste                    |
| hAC-/CCv2-APIs ändern sich zwischen Versionen                  | Mittel           | Versions-Matrix (2205, 2211, 2305 …), Adapter-Schicht, Tests je Version  |
| Parser-Aufwand für ImpEx unterschätzt (Edge Cases)             | Mittel           | Früher Korpus, Property-/Fuzz-Tests, iteratives Ausbauen                 |
| Scope-Creep                                                    | Mittel           | Parity-Matrix als Scope-Anker, Neues → Backlog statt Einbau              |
| Einzelentwickler-Risiko (Bus-Faktor)                           | Mittel           | gute Doku, ADRs, Contributor-Guide, früh Mitstreiter suchen              |
| Webview-Sicherheit (XSS über Query-Ergebnisse)                 | Mittel           | strikte CSP, Escaping, Tests                                             |
| Marken-/Namensstreit                                           | Niedrig–Mittel   | neutraler Name, Disclaimer, juristischer Blick                           |

---

## 5. Offene Entscheidungen

1. ~~Lizenz~~ → Apache-2.0 ✔
2. ~~Projektname~~ → SAP Commerce VS-Tools ✔
3. ~~Testzugang~~ → lokale hAC ✔ (Zugangsdaten für Integrationstests fehlen noch)
4. ~~Zielversion~~ → 2211-jdk21 ✔
5. **Offen (nur Maintainer):** Marketplace-/Open-VSX-Publisher bestätigen (aktuell `dyxa85`), Store-Tokens, Screenshots – siehe `docs/release.md`. Repository: `github.com/Dyxa85/sap-commerce-vs-tools`.
6. **Offen:** Mitwirkende / Tempo (alleine mit KI-Unterstützung angenommen).

---

## 6. Nächste konkrete Schritte

1. Maintainer: Punkte aus `docs/release.md` (Vulnerability Reporting aktivieren, Tokens, Screenshots), erster CI-Lauf auf Windows/Linux.
2. Java-Setup gegen Red Hat Java validieren (ADR 0001), danach auf _Accepted_ setzen oder ersetzen.
3. Weiter mit `ROADMAP.md`.
