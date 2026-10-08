# HowTo: SAP Commerce VS-Tools in VS Code aktivieren

[English](howto-enable-in-vscode.md)

Diese Anleitung führt von null zu einem funktionierenden Setup: Extension installieren, mit der hAC verbinden und jede
Funktion einmal ausprobieren. Dauer: etwa zehn Minuten.

## 1. Voraussetzungen

| Du brauchst                                           | Hinweise                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **VS Code 1.101 oder neuer**                          | Auf VS Code basierende Editoren (VSCodium, Cursor) sollten mit VSIX-Dateien gehen; getestet ist nur VS Code |
| Ein SAP-Commerce-Projekt                              | Zielversion `2211-jdk21`. Der geöffnete Ordner muss das Verzeichnis `hybris` enthalten (oder darin liegen)  |
| Eine erreichbare hAC (optional)                       | Für Abfragen, Skripte und Imports. Alle Editor-Funktionen gehen auch ohne                                   |
| _Optional:_ Java, Ant                                 | Ant liegt der Platform bei (`bin/platform/apache-ant`); Java 21 zum Starten des Servers                     |
| _Optional:_ **Language Support for Java™ by Red Hat** | Nur für die Java-Navigation (Schritt 6)                                                                     |
| _Optional, zum Selbstbauen:_ Node.js ≥ 20 und pnpm    | Nicht nötig, wenn du die Release-Datei installierst                                                         |

## 2. Installieren

### Variante A – aus der Release-Datei (empfohlen)

1. Öffne das [neueste Release](https://github.com/Dyxa85/sap-commerce-vs-tools/releases/latest) und lade
   `sap-commerce-vs-tools-<version>.vsix` herunter.
2. In VS Code die **Erweiterungen**-Ansicht öffnen (`Cmd+Shift+X` / `Strg+Shift+X`), oben das Menü `⋯` anklicken und
   **Aus VSIX installieren…** wählen, dann die Datei auswählen. Alternativ im Terminal:

   ```bash
   code --install-extension sap-commerce-vs-tools-<version>.vsix
   ```

3. VS Code fragt eventuell, ob du dem Herausgeber vertraust. Die Extension läuft komplett lokal und sendet nichts außer an
   die hAC-URLs, die du einrichtest.

### Variante B – selbst bauen

```bash
git clone https://github.com/Dyxa85/sap-commerce-vs-tools.git
cd sap-commerce-vs-tools
pnpm install
pnpm --filter sap-commerce-vs-tools run package
code --install-extension packages/extension/sap-commerce-vs-tools-*.vsix
```

### Variante C – aus dem Quelltext starten (zur Entwicklung)

Repository-Ordner in VS Code öffnen, `pnpm install` ausführen und `F5` drücken (**Run Extension**). Es wird zuerst gebaut,
dann öffnet sich ein _Extension Development Host_ mit dem synthetischen Fixture-Projekt und der geladenen Extension.

### Prüfen, ob es installiert ist

Befehlspalette öffnen (`Cmd+Shift+P` / `Strg+Shift+P`) und **SAP Commerce: About** ausführen. Es erscheint eine Meldung mit
der Zielversion. Fehlt der Befehl, das Fenster neu laden (**Developer: Reload Window**).

## 3. Projekt öffnen

1. **Datei → Ordner öffnen…** und den Ordner wählen, der `hybris/` enthält (ein CCv2-Ordner `core-customize` geht, der
   `hybris`-Ordner selbst auch).
2. Auf **Vertrauen** klicken, wenn VS Code fragt, ob du den Autoren des Ordners vertraust. Ohne Vertrauen läuft die
   Extension eingeschränkt: keine Workspace-Verbindungen, keine Build- und Server-Befehle.
3. Nach wenigen Sekunden erscheint im Explorer die Ansicht **Commerce Project** mit Platform, Modulen und deinen Custom-Extensions
   in Ladereihenfolge. Jede Extension zeigt ihre echten Ordner und Dateien (`src`, `gensrc`, `resources`, `build.xml`, …); der
   Knoten **Commerce overview** darunter listet Typsystem, Beans, Spring, Prozesse, ImpEx und die Abhängigkeiten. Falls die
   Ansicht fehlt, den Pfad ausdrücklich setzen:

   ```jsonc
   // .vscode/settings.json
   { "sapcommerce.project.roots": ["hybris"] }
   ```

   (relativ zum ersten Workspace-Ordner oder absolut). **SAP Commerce: Show Index Information** zeigt, wie viele Extensions,
   Item-Typen und Beans indiziert wurden.

Die Editor-Funktionen (ImpEx, FlexibleSearch, items/beans/Spring/Prozess-XML, Diagramme) laufen jetzt – ohne Verbindung.

## 4. Mit der hAC verbinden

1. Befehlspalette → **SAP Commerce: Add Connection…**
2. Name (`Local`, `Dev`, …), hAC-URL (`https://localhost:9002/hac`), Benutzername und die Frage nach Zertifikatsfehlern
   angeben. Bei einer lokalen Instanz mit selbstsigniertem Zertifikat **Ignore certificate errors** wählen – nicht bei
   entfernten Systemen.
3. Produktionsnahe Systeme als **protected** markieren: Jede schreibende Aktion fragt dann nach.
4. **SAP Commerce: Test Connection** ausführen. VS Code fragt einmal nach dem Passwort und legt es im Secret Storage ab
   (gebunden an URL und Benutzer). Es landet nie in Settings, Logs oder im Repository.

Die aktive Verbindung steht in der Statusleiste; ein Klick darauf (oder **Select Connection…**) wechselt sie.
Unverschlüsseltes `http://` zu einem entfernten Host verlangt vor dem Senden des Passworts eine ausdrückliche Bestätigung.

## 5. Funktionen ausprobieren

| Mach das                                                                                    | Ergebnis                                                                               |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `test.flexibleSearch` mit `SELECT {pk}, {code} FROM {Language}` anlegen, `Cmd/Strg+Enter`   | Ergebnistabelle mit Sortierung, Filter, Seiten, CSV-/JSON-Export                       |
| Dasselbe mit **Run SQL Query**                                                              | Reines SQL gegen die Datenbank der Instanz                                             |
| `test.impex` anlegen, `INSERT_UPDATE Product;code[unique=true]` tippen, Datenzeile beginnen | Highlighting, Vervollständigung für Typen und Attribute, Diagnosen beim Tippen         |
| `Cmd/Strg+Alt+V` in einer ImpEx-Datei                                                       | **Validate ImpEx** auf der Instanz; **Import ImpEx…** importiert (fragt vorher)        |
| **Run Groovy Script (Rollback)** in beliebigem Editor (Auswahl oder ganze Datei)            | Läuft auf der Instanz mit Rollback; die Commit-Variante fragt vorher                   |
| `Cmd/Strg+Alt+T`                                                                            | **Go to Type, Attribute or Enum Value…** über alle geladenen Extensions                |
| Cursor auf einen Typnamen, **Show Type**                                                    | Vorschau mit Vererbung, Attributen, Untertypen, Relationen                             |
| **Show Type Diagram**, **Show Extension Dependency Diagram**                                | Diagramm: ziehen zum Verschieben, Mausrad zum Zoomen, **Fit**, Klick öffnet den Knoten |
| Business-Process-XML öffnen, **Show Business Process Diagram**                              | Prozessgraph, wird beim Speichern aktualisiert                                         |
| Ctrl/Cmd+Klick auf Typ, Attribut, Bean-ID oder `class="…"` in XML oder ImpEx                | Springt zur Definition, auch in anderen Extensions                                     |
| **Analyze PK**, **Change Log Level…**, **Show History**                                     | Hilfsmittel der hAC direkt im Editor                                                   |

Dateien mit den Endungen `.impex`, `.fxs`, `.flexsearch` und `.flexibleSearch` bekommen die Sprache automatisch; bei anderen
Dateien **Sprachmodus ändern** in der Statusleiste verwenden.

## 6. Bauen, starten, debuggen (optional)

- **SAP Commerce: Run Ant Target…** listet `build`, `clean`, `unittests`, … oder nimmt ein eigenes Target mit `-D`-Properties.
  Dieselben Targets sind VS-Code-Tasks vom Typ `sapcommerce.ant` (**Terminal → Task ausführen**); Compilerfehler erscheinen
  im Problems-Panel. `initialize` fragt vorher, weil es alle Daten löscht.
- **Start Server** / **Start Server in Debug Mode** / **Stop Server**, danach **Attach Debugger to Server** (braucht die
  Erweiterung _Debugger for Java_). Der Port kommt aus deiner `local.properties` oder der `project.properties` der Platform
  (Standard 8000).
- **Configure Java for this Project…** (braucht _Language Support for Java™ by Red Hat_): schreibt `java.project.*` in die
  Settings des Workspace-Ordners, abgeleitet aus den Extensions, die die Platform lädt. Es fragt vorher und warnt bei
  `pom.xml`, `build.gradle` oder `.project` im Ordner-Root, weil die Java-Extension die Settings dann ignoriert. Generierte
  Model-Klassen gibt es erst nach dem ersten `ant build`. Feinjustage mit `sapcommerce.java.includeTests`,
  `sapcommerce.java.excludeExtensions` und `sapcommerce.java.maxExtensions`. Dieser Teil ist **noch nicht gegen einen
  laufenden Java-Language-Server geprüft**, siehe [java-setup.md](java-setup.md).

## 7. KI-Werkzeuge nutzen lassen (optional)

VS Code listet einen Server **SAP Commerce**, sobald der Workspace ein Projekt enthält: Befehlspalette →
**MCP: List Servers** → **SAP Commerce** → **Start Server**. Im Agent-Modus von Copilot stehen dann `list_extensions`,
`find_types`, `describe_type`, `extension_graph` und `get_extension` bereit. Sie lesen nur deine Dateien.

Abfragen gegen eine Instanz (`flexible_search`, `sql_query`) sind standardmäßig aus. Zum Erlauben
`sapcommerce.mcp.enableQueries` in den **Benutzer**-Settings setzen; VS Code fragt dann bei jedem Serverstart nach. Es wird
nur ein einzelnes `SELECT` durchgelassen, nichts wird committet, und die Ergebnisse sieht das KI-Modell – nicht für Systeme
mit Daten aktivieren, die nicht geteilt werden dürfen. Details: [mcp.md](mcp.md).

## 8. Einstellungen

In den **Einstellungen** nach `sapcommerce` suchen.

| Einstellung                                                                                                                                | Standard                     | Bedeutung                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------- |
| `sapcommerce.connections`                                                                                                                  | `[]`                         | Verbindungen (ohne Passwörter)                                                                |
| `sapcommerce.query.maxCount`                                                                                                               | `200`                        | Zeilenlimit für Abfragen                                                                      |
| `sapcommerce.requestTimeoutSeconds`                                                                                                        | `60`                         | Timeout der hAC-Anfragen                                                                      |
| `sapcommerce.confirmWrites`                                                                                                                | `true`                       | Vor Commit, Import und Log-Level-Änderung nachfragen                                          |
| `sapcommerce.impex.validation`                                                                                                             | `IMPORT_STRICT`              | Validierungsmodus für ImpEx Validate/Import                                                   |
| `sapcommerce.impex.diagnostics.severity`, `sapcommerce.flexsearch.…`, `sapcommerce.items.…`, `sapcommerce.beans.…`, `sapcommerce.spring.…` | `{}`                         | Schweregrad einzelner Diagnosen ändern oder abschalten, z. B. `{"impex.macro.unused": "off"}` |
| `sapcommerce.impex.format.*`, `sapcommerce.flexsearch.format.*`                                                                            | an                           | Formatter-Optionen                                                                            |
| `sapcommerce.project.roots`                                                                                                                | `[]`                         | `hybris`-Verzeichnisse, wenn die Erkennung nicht reicht                                       |
| `sapcommerce.project.showUnloadedExtensions`                                                                                               | `false`                      | Auch Extensions zeigen, die nicht in `localextensions.xml` stehen                             |
| `sapcommerce.project.hiddenEntries`                                                                                                        | `.git`, `classes`, `/bin`, … | In Extensions ausgeblendete Dateien/Ordner (`/name` = nur oberste Ebene)                      |
| `sapcommerce.java.*`                                                                                                                       | siehe oben                   | Java-Setup                                                                                    |
| `sapcommerce.mcp.enableQueries`                                                                                                            | `false`                      | Lesende Abfragen für KI-Werkzeuge erlauben (nur Benutzer-Settings)                            |

## 9. Fehlersuche

| Symptom                                          | Lösung                                                                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| „self-signed certificate“ / TLS-Fehler           | Verbindung bearbeiten und **Ignore certificate errors** aktivieren (nur lokale Systeme)                                                        |
| Login schlägt immer wieder fehl                  | Nach einem abgelehnten Login wird das gespeicherte Passwort verworfen und neu abgefragt. Benutzer in der hAC prüfen                            |
| „Unexpected login page“                          | Die URL ist nicht die hAC. Sie endet auf `/hac` (oder deinen Context-Pfad)                                                                     |
| Ansicht Commerce Project ist leer                | Ordner mit `hybris/` öffnen oder `sapcommerce.project.roots` setzen; **Show Index Information** prüfen                                         |
| Keine Vervollständigung / überall „unknown type“ | Der Index hat kein Projekt. Wie oben; der Language Server startet beim Öffnen einer ImpEx-, FlexibleSearch- oder Commerce-XML-Datei            |
| Typen der eigenen Extension unbekannt            | Die Extension muss in `localextensions.xml` stehen; siehe **Show / Hide Extensions That Are Not Loaded**                                       |
| Build-/Server-Befehle tun nichts                 | Der Workspace muss vertraut sein (**Manage Workspace Trust**)                                                                                  |
| Sonstiges                                        | **SAP Commerce: Show Log** (Geheimnisse sind maskiert), dann [Issue öffnen](https://github.com/Dyxa85/sap-commerce-vs-tools/issues/new/choose) |

## 10. Aktualisieren und entfernen

Neues VSIX über das alte installieren (Variante A). Entfernen: Erweiterungen-Ansicht → **SAP Commerce VS-Tools** →
**Deinstallieren**. Beim Entfernen einer Verbindung (**Edit / Remove Connection…**) wird auch ihr gespeichertes Passwort gelöscht.
