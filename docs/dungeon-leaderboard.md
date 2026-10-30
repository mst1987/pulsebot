# Dungeon-Bestzeiten (LevelHelper)

Endnutzer-Sicht: [guide-web-admin.md](guide-web-admin.md#dungeon-bestzeiten) und [guide-discord.md](guide-discord.md) (`/bestzeiten`).

Das WoW-Addon **LevelHelper** (eigenes Repo, WoW Forever) misst Dungeon-Läufe von Gruppen, vergibt Medaillen (Gold/Silber/Bronze) und kennt die Erfolgspunkte jedes Charakters. Das **Sync-Tool** (eventhelper-addon) liest seine SavedVariables und lädt sie hier hoch. Alles gilt **je Spielversion** (#741): jeder Lauf und jeder Charakter trägt die `versionId` der Installation, aus der er kam.

## Upload: `POST /api/ingest/levelhelper`

Gleiche Anmeldung wie die anderen Ingest-Routen (Bearer-Token aus `ingestTokenStore`, `auth: "token"`, keine Sitzung). Format `levelhelper-runs` v1, Parser `src/utils/dungeons/levelHelperUpload.js`:

```
{ format: "levelhelper-runs", v: 1, versionId: "forever", guild: "Pulse", uploader: { account: "405280973#1" },
  runs: [{ id, dungeon, seconds, start, instance, medal, members: [{ guid, name, class }], at }],
  characters: [{ guid, name, realm, class, level, points, count, golds, at }] }
```

- **Prüfung:** alles wird geprüft; passt ein Feld nicht, wird der **ganze** Request mit 400 `parse_failed` abgelehnt, die Meldung nennt das Feld (`runs[3].seconds: 30 liegt nicht zwischen 60 und 14400`). Grenzen: höchstens 500 Läufe und 200 Charaktere je Request, `seconds` 60..14400, `medal` gold/silver/bronze/null, 1..5 Mitglieder, Zeiten in Unix-Sekunden, `versionId` eine bekannte Spielversion, `v` höher als 1 wird abgelehnt. Das Sync-Tool lässt weg, was der Server ablehnen würde. Eine Lauf-Id darf Text oder ganze Zahl sein; `guild`, `uploader`, `instance`, `medal`, `at`, `realm`, `guid` dürfen fehlen.
- **Antwort:** `{ ok: true, versionId, runs: { added, merged, skipped }, characters: { updated } }` (im üblichen `{ data }`-Umschlag). `merged` = ein schon gespeicherter Lauf hat sich geändert, `skipped` = derselbe Lauf noch einmal ohne Neues.
- **Derselbe Lauf** (`services/dungeons/dungeonRuns.js`): gleiche Addon-Id, oder gleicher Dungeon + gleiche Gruppe (Mitglieder per GUID, sonst per Name in Kleinbuchstaben) + Start höchstens 120 s auseinander. Zusammenführen: schnellste Zeit, wenn die Zeiten höchstens 10 s auseinanderliegen (die bessere Medaille dazu; weiter auseinander ändert die gespeicherte Zeit nicht), Mitglieder vereinigt, frühester Start. Nie über Versionen hinweg.
- **Charaktere:** je Version per GUID, sonst per Name; ein älterer Stand (`at`) ändert nichts.

## Speicher

`src/stores/roster/dungeonRunStore.js`, `data/settings/dungeon-runs.json` (siehe [data-storage.md](data-storage.md)). Höchstens 20 000 Läufe, darüber fallen die ältesten heraus.

## Auswertung

`src/services/dungeons/dungeonBoard.js`, für die Seite und den Bot dieselbe:

- **Je Dungeon:** die zehn schnellsten Läufe (gleiche Zeit: der frühere zuerst), Zahl der Läufe und Gold-Läufe, Bestzeit.
- **Gesamtwertung:** je Spieler die Medaillen aller seiner Läufe (Gold vor Silber vor Bronze), die Dungeons mit Gold, die Läufe. Ein Mitglied ohne GUID zählt zum GUID-Spieler gleichen Namens.
- **Erfolgspunkte:** die Charaktere nach Punkten.
- Klassen: das Klassen-Token des Addons (`PALADIN`, `DEATHKNIGHT`) wird über den Regelsatz der Version zur Klasse mit Farbe und Icon.

## Web: Seite „Dungeon-Bestzeiten“

`/roster/dungeons`, ein Unterpunkt der Roster-Familie (`menu.json` `sub: true`, Gruppe Gilde – jede Gruppe hat schon vier Einträge, deshalb keine eigene Zeile). Orga mit `roster` sieht die Icon-Leiste Roster · Dungeon-Bestzeiten (auch auf der Roster-Übersicht), ein Mitglied mit nur `signup` bekommt im Menü die Zeile „Dungeon-Bestzeiten“ selbst. `GET /api/dungeons?version=` (Bereich `roster` oder `signup`) antwortet für genau eine Version (`resolveVersionQuery`), `otherVersions` nennt für die leere Seite die Versionen mit Daten. Drei Reiter, alle Tabellen sortierbar; Medaillen als kleines quadratisches Feld mit Wort (`--medal-gold/-silver/-bronze` in `tokens.css`). Code: `src/web-client/src/pages/dungeons/`.

## Discord

- **`/bestzeiten [dungeon]`** (`src/commands/lookup/bestzeiten.js`, Gruppe `raids`, jeder): ephemere Karte in der Sprache des Lesers – mit Dungeon die fünf schnellsten Läufe, ohne die Gesamtwertung (Top 5). Autovervollständigung aus den gespeicherten Dungeon-Namen der Version; Version wie bei allen Abfragen (`commandVersion.js`). Texte in `config/botText/de/dungeons.js`.
- **Neue Gildenrekorde posten** (`services/dungeons/dungeonRecords.js`, Einstellung `config.dungeonRecords = { post, channelId }`, Einstellungen → Module → Dungeon-Bestzeiten, **aus** als Standard): nach einem Upload geht ein Gold-Lauf, der jetzt der schnellste seines Dungeons ist, als Karte in den Kanal (Server-Sprache). Nur Läufe der letzten drei Tage, höchstens drei je Upload, jeder Lauf einmal (`recordPostedAt`), nichts für eine ausgeblendete Version.
