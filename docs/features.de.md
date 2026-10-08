# Feature-Übersicht: was es kann, wo man es findet, was man dafür braucht

[English](features.md) · [HowTo: in VS Code aktivieren](howto-enable-in-vscode.de.md)

## Wo was zu finden ist

Die Extension hat **drei Orte**. Wenn du etwas suchst, schau zuerst hier:

| Ort                                                                                 | Was dort ist                                                                                                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Seitenleiste → SAP Commerce** (Sechseck-Symbol mit `< >` in der Aktivitätsleiste) | **Connections**, **Features** (klickbares Inhaltsverzeichnis von allem unten), **Commerce Project**, **CCv2**                                           |
| **Der Editor**                                                                      | Sprachunterstützung in ImpEx, FlexibleSearch und den Commerce-XML-Dateien; Schaltflächen in der Titelleiste des Editors; Rechtsklick-Menü; Tastenkürzel |
| **Befehlspalette** (`Cmd/Strg+Shift+P`)                                             | `SAP Commerce` eintippen – jeder Befehl der Extension steht dort                                                                                        |

Außerdem: Die **Statusleiste** zeigt die aktive Verbindung (Klick wechselt sie); **Ausgabe → SAP Commerce** ist das Log
(Geheimnisse sind maskiert); **Einstellungen → nach `sapcommerce` suchen** hat alle Optionen; und **Willkommen →
Walkthroughs → Get started with SAP Commerce VS-Tools** ist eine geführte Tour mit Schaltflächen.

> Kein Sechseck-Symbol zu sehen? Rechtsklick auf die Aktivitätsleiste und **SAP Commerce** anhaken, oder in der
> Befehlspalette **SAP Commerce: Get Started (Walkthrough)** ausführen.

## Wofür ist die hAC-Verbindung?

Die **hAC** (hybris Administration Console, meist `https://localhost:9002/hac`) ist die Web-Konsole einer **laufenden**
SAP-Commerce-Instanz. Die Extension nutzt sie – wie du im Browser – um Dinge auf dieser Instanz auszuführen. Mehr ist eine
_Verbindung_ nicht: die Adresse der hAC, ein Benutzername und ein Passwort, das im Secret Storage von VS Code liegt.

| Braucht eine Verbindung (spricht mit einer laufenden Instanz)   | Geht ohne (liest deine Dateien)                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| FlexibleSearch- und SQL-Abfragen ausführen                      | ImpEx- und FlexibleSearch-Editor: Highlighting, Diagnosen, Vervollständigung, Formatter     |
| Groovy-Skripte ausführen                                        | Suche nach Typen, Attributen und Beans; Typ-Vorschau; Gehe zu Definition                    |
| ImpEx validieren und importieren                                | Unterstützung für items/beans/Spring/Prozess-XML                                            |
| PK-Analyzer, Log-Level                                          | Ansichten Commerce Project und CCv2, Diagramme                                              |
| Lesende Abfragen für KI-Werkzeuge (optional, standardmäßig aus) | Ant-Build, Server starten/debuggen, Java-Setup, KI-Projektwissen (Typen, Extensions, Beans) |

**Einrichten:** Seitenleiste → **Connections** → **+** (oder das Zahnrad), oder Befehlspalette → **SAP Commerce: Open
Connection Settings**. Das ist eine Seite: Name, hAC-Adresse, Benutzer, Passwort, _Test connection_. Produktionsnahe
Systeme als **protected** markieren, dann fragt jede schreibende Aktion nach. Mehrere Verbindungen (Local, Dev, Stage …)
sind möglich; die mit dem Punkt ist aktiv – eine andere anklicken oder das Statusleisten-Element anklicken wechselt sie.

## Funktionen nach Bereich

„Braucht“ nennt, was vorhanden sein muss, damit die Funktion geht.

### Auf einer Instanz ausführen

| Funktion                  | Was sie tut                                                                                                                        | Wo                                                                                                          | Braucht    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------- |
| **Run FlexibleSearch**    | Führt die Auswahl (oder die Datei) aus; Zeilen als sortier- und filterbare Tabelle, Export CSV/JSON; `?parameter` werden abgefragt | `Cmd/Strg+Enter`; ▶-Schaltfläche in der Titelleiste einer `.flexibleSearch`-/`.fxs`-Datei; Features-Ansicht | Verbindung |
| **Run SQL**               | Reines SQL gegen die Datenbank der Instanz                                                                                         | Rechtsklick in einer `.sql`-Datei; Befehlspalette                                                           | Verbindung |
| **Run Groovy (Rollback)** | Führt ein Skript aus und rollt alles zurück; die _Commit_-Variante fragt vorher                                                    | Rechtsklick in einer `.groovy`-Datei; Befehlspalette                                                        | Verbindung |
| **Validate ImpEx**        | Lässt die hAC die Datei oder Auswahl validieren                                                                                    | `Cmd/Strg+Alt+V`; ✓-Schaltfläche in der Titelleiste einer `.impex`-Datei                                    | Verbindung |
| **Import ImpEx…**         | Importiert nach Bestätigung; fehlgeschlagene Zeilen mit Grund                                                                      | Titelleiste / Rechtsklick in einer `.impex`-Datei                                                           | Verbindung |
| **Analyze PK**            | Sagt, zu welchem Item ein PK gehört                                                                                                | Befehlspalette                                                                                              | Verbindung |
| **Change log level…**     | Listet die Logger der Instanz und ändert einen                                                                                     | Befehlspalette                                                                                              | Verbindung |
| **History**               | Frühere Abfragen, Skripte und Imports erneut öffnen                                                                                | Befehlspalette → _Show History_                                                                             | –          |
| **Open hAC in browser**   | Öffnet die Konsole                                                                                                                 | Inline-Schaltfläche in der Ansicht Connections                                                              | Verbindung |

### Code schreiben

| Funktion                                             | Was sie tut                                                                                                                                                                                                              | Wo                                                                                                             | Braucht             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------- |
| **ImpEx-Editor**                                     | Highlighting; Diagnosen wie beim echten Importer (unbekannte Typen/Attribute, fehlende Unique-Spalten, Makros …); Vervollständigung; Hover; Gliederung; Makro umbenennen; Formatter, der Spalten ausrichtet; Quick Fixes | Jede `.impex`-Datei; _New ImpEx File_ in der Features-Ansicht                                                  | Projekt (für Typen) |
| **FlexibleSearch-Editor**                            | Highlighting; Warnungen vor dem, was in der hAC bricht (`--`-Kommentare, `;` am Ende, `LIMIT`); Alias-Vervollständigung und Umbenennen; Formatter                                                                        | `.flexibleSearch`-, `.fxs`-, `.flexsearch`-Dateien                                                             | Projekt (für Typen) |
| **items.xml / beans.xml / spring.xml / Prozess-XML** | Diagnosen, Vervollständigung für Typen, Attribute, Bean-IDs, Hover, Gehe zu Definition über Extensions hinweg und in Java-Quelltexte, Gliederung                                                                         | Öffnet automatisch bei Dateien `*-items.xml`, `*-beans.xml`, `*-spring.xml`, `*-process.xml` deiner Extensions | Projekt             |

_Projekt_ heißt: Der geöffnete Ordner enthält das Verzeichnis `hybris` (oder du setzt `sapcommerce.project.roots`).
Ungespeicherte Änderungen einer `items.xml` werden sofort berücksichtigt.

### Das Projekt erkunden

| Funktion                                 | Was sie tut                                                                                                                                                                                           | Wo                                               | Braucht                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| **Ansicht Commerce Project**             | Platform, Module und Custom-Extensions in Ladereihenfolge; jede mit ihren echten Ordnern und Dateien und einem Knoten _Commerce overview_ (Typsystem, Beans, Spring, Prozesse, ImpEx, Abhängigkeiten) | Seitenleiste → Commerce Project                  | Projekt                                              |
| **Ansicht CCv2**                         | Das Repository (`core-customize`, `js-storefront`, …) und eine Gliederung der `manifest.json` (Versionen, Extension-Packs, Extensions, Properties, Config je Persona, Aspects, Webapps)               | Seitenleiste → CCv2                              | ein CCv2-Repository (`core-customize/manifest.json`) |
| **Go to Type, Attribute or Enum Value…** | Sucht Typen, Enums, Relationen, Attribute, Enum-Werte und Beans                                                                                                                                       | `Cmd/Strg+Alt+T`                                 | Projekt                                              |
| **Show Type**                            | Vorschau: Vererbung, Attribute, Untertypen, Relationen                                                                                                                                                | Rechtsklick auf einen Typnamen; Befehlspalette   | Projekt                                              |
| **Typ-Diagramm**                         | Vererbung und Referenzen um einen Typ; verschieben, zoomen, Knoten anklicken                                                                                                                          | Rechtsklick in einer `items.xml`; Befehlspalette | Projekt                                              |
| **Extension-Abhängigkeitsdiagramm**      | Custom-Extensions und was sie brauchen, oder Abhängigkeiten/Abhängige einer Extension                                                                                                                 | Befehlspalette                                   | Projekt                                              |
| **Business-Process-Diagramm**            | Der Prozess als Graph, beim Speichern aktualisiert                                                                                                                                                    | Rechtsklick in einer `*-process.xml`             | Projekt                                              |
| **Gehe zu Definition**                   | `Cmd/Strg+Klick` auf Typ, Attribut, Bean-ID oder `class="…"`                                                                                                                                          | In ImpEx, FlexibleSearch und den XML-Dateien     | Projekt                                              |
| **Show Index Information**               | Wie viele Extensions, Typen und Beans indiziert wurden                                                                                                                                                | Befehlspalette                                   | Projekt                                              |

### Bauen, starten, debuggen

| Funktion                                 | Was sie tut                                                                                          | Wo                                                                                                             | Braucht                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Run Ant Target…**                      | `build`, `clean`, `unittests` oder ein eigenes Target mit `-D`-Properties; `initialize` fragt vorher | Befehlspalette; auch _Terminal → Task ausführen_ (`sapcommerce.ant`); Compilerfehler erscheinen unter Probleme | Projekt, vertrauter Workspace                                 |
| **Start / Stop Server**, **Debug-Modus** | Startet die Platform mit ihrem eigenen Skript                                                        | Befehlspalette; Task (`sapcommerce.server`)                                                                    | Projekt, vertrauter Workspace                                 |
| **Attach Debugger to Server**            | Hängt sich an den Port aus deiner `local.properties` (Standard 8000)                                 | Befehlspalette                                                                                                 | Erweiterung _Debugger for Java_                               |
| **Configure Java for this Project…**     | Schreibt `java.project.*` aus den Extensions, die die Platform lädt                                  | Befehlspalette                                                                                                 | _Language Support for Java™ by Red Hat_, vertrauter Workspace |

### KI-Werkzeuge

| Funktion                      | Was sie tut                                                                                                                           | Wo                                                                                         | Braucht                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------- |
| **MCP-Server „SAP Commerce“** | Gibt dem Agent-Modus von Copilot (oder einem anderen MCP-Client) lesendes Wissen: Extensions, Abhängigkeiten, Typen, Attribute, Beans | Befehlspalette → _MCP: List Servers_ → SAP Commerce → Start                                | Projekt, VS Code 1.101+ |
| **Lesende Abfragen für KI**   | Werkzeuge `flexible_search` und `sql_query`; nur ein `SELECT`, nie committet                                                          | Einstellung `sapcommerce.mcp.enableQueries` (Benutzer-Settings); bei jedem Start bestätigt | Verbindung              |

## Einstellungen

Einstellungen → nach `sapcommerce` suchen. Am ehesten brauchst du: `sapcommerce.project.roots` (wo `hybris` liegt),
`sapcommerce.confirmWrites`, `sapcommerce.query.maxCount`, `sapcommerce.project.hiddenEntries`, `sapcommerce.java.*` und
`sapcommerce.*.diagnostics.severity` (einzelne Diagnosen abschwächen oder abschalten). Die vollständige Liste steht im
[HowTo](howto-enable-in-vscode.de.md#8-einstellungen).

## Wenn etwas fehlt

| Du siehst                                               | Weil                                         | Mach                                                                |
| ------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| Commerce Project meldet „No SAP Commerce project found“ | Der geöffnete Ordner enthält kein `hybris/`  | Ordner mit `hybris/` öffnen oder `sapcommerce.project.roots` setzen |
| CCv2 meldet „No CCv2 repository found“                  | Es gibt keine `core-customize/manifest.json` | Den Repository-Ordner öffnen                                        |
| Ein Abfrage-Befehl fragt nach einer Verbindung          | Keine aktive Verbindung                      | Seitenleiste → Connections → +                                      |
| ImpEx zeigt keine Typ-Vervollständigung                 | Kein Projekt-Index                           | Siehe _Commerce Project_; **Show Index Information** ausführen      |
| Build-/Server-/Java-Befehle tun nichts                  | Der Workspace ist nicht vertraut             | **Manage Workspace Trust**                                          |
| Kein Sechseck-Symbol in der Aktivitätsleiste            | Das Symbol ist ausgeblendet                  | Rechtsklick auf die Aktivitätsleiste → **SAP Commerce** anhaken     |
