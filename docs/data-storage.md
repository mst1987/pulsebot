# Datenablage (`data/`)

Alles, was der Bot zur Laufzeit festhält, liegt als Datei unter **einem** Verzeichnis: `DATA_DIR` aus
`src/config/paths.js`. Das ist `<repo>/data`, oder der Wert von `EVENTHELPER_DATA_DIR`, wenn er gesetzt ist
(ein relativer Wert gilt ab Repo-Wurzel; Docker-Volume, zweite Instanz mit eigenen Daten). Die editierbaren
JSON-Dateien der Stores liegen in `DATA_DIR/settings/`. Wie ein Store liest und (atomar) schreibt, steht in
[web-admin.md, Abschnitt Stores](web-admin.md#stores-srcstoresjsonstorejs-srcconfigpathsjs-419); neue Pfade immer
über `dataPath(...)` / `settingsPath(name)` bauen.

`data/` ist git-ignoriert und steht nur auf der Platte des Servers (bzw. im Docker-Volume `/app/data`). Nichts
davon lässt sich aus GitHub wiederherstellen.

## Sichern und Wiederherstellen

- **pm2-Server**: den ganzen Ordner `data/` im Deploy-Verzeichnis sichern (siehe
  [deployment.md](deployment.md#das-zielverzeichnis)), am besten bei gestopptem Bot oder direkt nach einem
  `pm2 stop`, damit keine Datei mitten im Schreiben erwischt wird. Die Stores schreiben atomar (Temp-Datei +
  Umbenennen), eine Kopie im laufenden Betrieb ist also dateiweise konsistent, aber nicht über Dateien hinweg.
- **Docker**: das Volume sichern, das auf `/app/data` liegt ([deployment.md](deployment.md#docker)).
- **Wiederherstellen**: Bot stoppen, `data/` zurückkopieren, Bot starten. Fehlt eine Datei, startet der Store
  mit seinem leeren Standard; eine kaputte (kein JSON) liest er ebenfalls als leer, also vor dem Start prüfen.
- Die Sicherung enthält **sensible** Dateien (Tabelle unten): wie die `.env` behandeln, nicht in ein Ticket, einen
  Chat oder ein öffentliches Repo legen.
- Ohne Verlust wegwerfbar sind nur die Caches (`sim/results.json`, `settings/characters.json`,
  `settings/raid-events.json`, `settings/category-names.json`); sie füllen sich von selbst wieder.

## Dateien

Eigentümer = das Modul, das die Datei schreibt (unter `src/web/`, wenn nicht anders angegeben). Sensibel = enthält
Zugangsdaten, Token oder Sitzungen.

| Datei (unter `DATA_DIR`) | Eigentümer | Inhalt | Sensibel |
|---|---|---|---|
| `sessions.json` | `auth.js` | Web-Sitzungen: sid → `{ id, name, isAdmin, access, csrf, createdAt, adminCheckedAt }` | **ja** (eine sid ist ein Login) |
| `settings/config.json` | `settingsStore.js` | Bot-Einstellungen aus dem Web: Server, Kanäle, Rollen, Rechte, API-Zugänge (u. a. Blizzard-, WCL-v2- und Anthropic-Schlüssel) | **ja** |
| `settings/ingest-tokens.json` | `ingestTokenStore.js` | Token des Loot-Sync-Tools, nur als sha256-Hash | **ja** (Hashes) |
| `settings/calendar-tokens.json` | `calendarTokenStore.js` | Abo-Token des Raider-Kalenders, nur als sha256-Hash | **ja** (Hashes) |
| `settings/recruitment.json` | `settingsStore.js` | Recruitment-Vorlagen: `{ templates: [...] }` | nein |
| `settings/recruitment-posts.json` | `settingsStore.js` | Gepostete Recruitment-Nachrichten (zum späteren Bearbeiten) | nein |
| `settings/raid-templates.json` | `settingsStore.js` | Raid-Vorlagen (Instanz, Größe, Rollen, Zeiten) | nein |
| `settings/notify.json` | `settingsStore.js` | Vorlagen für den Anmelde-Aufruf (Text mit Rollenping): `{ templates: [...] }` | nein |
| `settings/events.json` | `eventStore.js` | Eigene Events: `{ events: [...] }` | nein |
| `settings/signups.json` | `signupStore.js` | Anmeldungen: `{ signups: { [eventId]: { [userId]: signup } } }` | nein |
| `settings/event-series.json` | `eventSeriesStore.js` | Serien je Kategorie, ihre Läufe je Datum, letzter Lauf | nein |
| `settings/reminders-sent.json` | `reminderStore.js` | Welche Erinnerung je Event schon raus ist | nein |
| `settings/talk-overview.json` | `talkOverviewStore.js` | Je Event-Server: Kanal, Nachricht und Hash der Raid-Übersicht | nein |
| `settings/event-loot-system.json` | `eventLootSystemStore.js` | Loot-System je Event (z. B. softres) | nein |
| `settings/event-sheets.json` | `eventSheetStore.js` | Welche Events ins Google-Raidsheet geschrieben wurden | nein |
| `settings/event-softres.json` | `eventSoftresStore.js` | Angelegte softres.it-Listen je Event (Links) | nein |
| `settings/raid-events.json` | `raidEventStore.js` | Schnappschuss gesehener Raid-Helper-Events (Cache) | nein |
| `settings/category-names.json` | `categoryNames.js` | Letzte bekannte Namen der Discord-Kategorien (Cache) | nein |
| `settings/channel-archive.json` | `channelArchiveStore.js` | Archiv-Kategorie, Namensschema, Archiv-Log der Kanäle-Seite | nein |
| `settings/raidplans.json` | `raidplanStore.js` | Raidpläne: `{ plans: [...] }` mit Boards je Boss, `publicToken` der Freigabe | nein (der Token öffnet nur die Lese-Ansicht) |
| `raidplan-maps/` | `raidplanStore.js` | Hochgeladene Raumkarten (Bilder) je Boss/Instanz/Vorlage | nein |
| `settings/raidplan-templates.json` | `raidplanTemplateStore.js` | Raidplan-Vorlagen | nein |
| `settings/raidplan-profiles.json` | `raidplanProfileStore.js` | Taktik-Profile | nein |
| `settings/raidplan-catalog.json` | `raidplanCatalogStore.js` | Eigene/überschriebene Mobs und Zauber des Katalogs | nein |
| `settings/loot.json` | `lootStore.js` | Importierter Loot (Gargul/RCLootcouncil/Addon) | nein |
| `settings/loot-inbox.json` | `lootInboxStore.js` | Addon-Uploads, die noch auf Bestätigung warten, und erledigte Sessions | nein |
| `settings/logs.json` | `logStore.js` | Ausgewertete WCL-Reports (damit keiner zweimal läuft) | nein |
| `reports/<id>.json` | `reportStore.js` | Die gespeicherten Log-Auswertungen (Report-Seiten `/r/`) | nein |
| `settings/logGear.json` | `logGearStore.js` | Aus einem WCL-Report geladenes Gear je Raider | nein |
| `settings/characters.json` | `characterStore.js` | Klasse/Spec je Charakter (Cache aus Loot und Logs) | nein |
| `settings/raider-characters.json` | `raiderCharactersStore.js` | Charakter je Raider und Raid-Kategorie (Orga-Zuordnung) | nein |
| `settings/raider-profiles.json` | `raiderProfileStore.js` | „Mein Profil“: Charaktere, Specs, Wünsche der Raider | nein |
| `settings/spec-history.json` | `specHistoryStore.js` | Spec-Historie (u. a. aus dem Raid-Helper-Import) | nein |
| `settings/roster-hidden.json` | `rosterHiddenStore.js` | Im Roster ausgeblendete Charaktere | nein |
| `settings/council-excluded.json` | `councilStore.js` | Raider, mit denen der Loot-Council nicht mehr plant | nein |
| `settings/council-roles.json` | `councilStore.js` | Rolle je Raider, die der Council festlegt (Offspec-Abende) | nein |
| `settings/user-prefs.json` | `userPrefsStore.js` | Einstellungen je Konto (Sprache des Menüs) | nein |
| `sim/results.json` | `simStore.js` | Cache der Loot-Council-Simulationen (Schlüssel = Loadout + Binary) | nein |
| `rh-fixture-mode.txt` | `src/utils/raidhelper/fixture.js` | Nur Dev: Modus des Raid-Helper-Stand-ins einer Testinstanz | nein |

Wer einen neuen Store anlegt, trägt seine Datei hier ein. Die Ausgabe von `npm run agents -- --html` landet nicht
mehr in `data/`, sondern im Temp-Verzeichnis (`scripts/README.md`).
