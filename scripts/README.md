# scripts/

Einmal- und Wartungs-Scripts neben dem Bot. Keines läuft zur Laufzeit des Bots; alle werden aus dem
Projekt-Root gestartet (`npm run <alias>` oder `node scripts/<datei>.js`), weil sie `.env` / `.env.dev`
relativ zum Arbeitsverzeichnis lesen. Aufruf und Optionen stehen jeweils im Kopfkommentar des Scripts.

Generierte Daten landen unter `src/config/` (die Generatoren-Ausgaben ziehen mit #428 nach
`src/config/generated/`); der genaue Zielpfad steht im Kopf des Scripts. Generierte Dateien nie von Hand
ändern, sondern das Script erneut laufen lassen.

| Script | Zweck | Ausgabe | npm-Alias | Test |
|---|---|---|---|---|
| `agent-overview.js` | Übersicht der laufenden Agenten je Worktree: Änderungen, Testinstanz, PR, was zu prüfen ist | Terminal; `--html` schreibt `eventhelper-agent-overview.html` ins Temp-Verzeichnis, `--serve` eine lokale Seite | `agents` | ja |
| `build-cla-data.js` | CLA-Referenzdaten (Enchant-Blacklist, Sockel, Schattenresistenz, Consumables) aus `data-sources/cla/` und dem git-ignorierten `clasp clone` der Apps-Script-Quelle | `claData.js` | `data:cla` | nein |
| `build-rpb-data.js` | RPB-Referenzdaten (Konfig-Sheet, Validierung, Spell-Haste, Spell-Icons) aus `data-sources/rpb/` | `rpbData.js` (fehlende Icons fragt es bei Wowhead nach und merkt sie in `data-sources/rpb/spell-icons.json`) | `data:rpb` | nein |
| `check-main-clean.js` | Meldet alles, was den Haupt-Checkout verschmutzt; auch vom Stop-Hook benutzt | Zeilen + Exit-Code 1, still bei sauberem Stand | `check:main` | ja (`test/claude-hooks/`) |
| `fetch-boss-icons.js` | Boss-Icons von Warcraft Logs für die Boss-Tabs der Report-Seite (braucht `WARCRAFTLOGS_API_KEY`) | `src/web-client/public/bosses/*.jpg`, `bossIcons.json` | `data:icons` | nein |
| `fetch-mob-icons.js` | Portraits und Platzhalter-Icons für die Mobs des Raidplan-Katalogs | `src/web-client/public/mobs/*.png`, `mobIcons.json` | `data:icons` | nein (PNG-Codec: ja) |
| `fetch-tbc-loot.js` | Loot-Tabelle Item → Raid/Boss aus AtlasLootClassic | `RAID_LOOT`-Block in `tbcContent.js` | `data:loot` | nein |
| `fetch-tbc-loot-names.js` | Name, Icon und Qualität jedes Items der Loot-Tabelle (nach `fetch-tbc-loot.js`) | `tbcLootNames.js` | `data:loot` | nein |
| `fetch-wowhead-bis.js` | Heiler-BiS-Listen aus den Wowhead-Guides | `wowhead/bisSets.json` | `bis:refresh` | ja |
| `fetch-wowsimcli.js` | Lädt das `wowsimcli`-Binary für die Loot-Council-Simulation (optional) | `bin/`, danach `WOWSIMCLI_PATH` setzen | `setup:wowsimcli` | Versionsabgleich in `test/utils/wowsims/engine.test.js` |
| `fetch-wowsims-data.js` | Item-DB, BiS-Sets und Rotationen aus WoWSims-TBC | `wowsims/items.json`, `wowsims/bisSets.json`, `wowsims/apls/*.json` | `bis:refresh` | Versionsabgleich in `test/utils/wowsims/engine.test.js` |
| `get-drive-token.js` | Einmalig: Google-OAuth-Refresh-Token für die Drive-Kopie holen | Token im Terminal, von Hand in `.env` / `.env.dev` eintragen | – | nein |
| `import-raidhelper-history.js` | Migration: Raid-Helper-Anmeldungen als Spec-Historie importieren; wird mit dem Raid-Helper-Ausstieg gelöscht (`docs/raidhelper-retirement.md`) | `data/settings/spec-history.json` | – | ja |
| `register-commands.js` | Slash-Commands bei Discord registrieren (sammelt die `data` der Befehlsmodule über den Loader) | Discord-API | `register`, `register:global`, `register:clear`, `register:dev` | ja |
| `render-role-swords.js` | Nahkampf-Icon als gekreuzte Schwerter aus den Rollen-Kacheln | `assets/emojis/eh_r<stil>_swords.png` | – | nein |
| `render-ui-emojis.js` | Die flachen UI-Icons der Event-Nachricht zeichnen (eingecheckt) | `assets/emojis/eh_ui_<name>.png` | `emojis:render` | ja (Icon-Liste, `test/web/appEmojis.test.js`) |
| `seed-test-raid.js` | Nur Dev: kompletter Testraid mit 25 Anmeldungen, Setup und Raidplan-Vorlage | Stores unter `data/` der Instanz | `dev:seed` | ja |
| `sync-app-emojis.js` | Fehlende App-Emojis hochladen (macht der Bot beim Start auch) | Discord-API | `emojis:sync` (`-- --dry-run` listet nur) | ja |
| `lib/png.js` | Kleiner PNG-Codec für `fetch-mob-icons.js` | – | – | ja |

## data-sources/

Eingaben der Generatoren, keine Laufzeitdaten: `data-sources/cla/` für `build-cla-data.js`,
`data-sources/rpb/` für `build-rpb-data.js` (CSV-Exporte der CLA-/RPB-Sheets, Herkunft in den READMEs dort).
Die Apps-Script-Klone (`data-sources/*/appsscript/`) sind git-ignoriert.
