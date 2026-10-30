# Datenablage (`data/`)

Alles, was der Bot zur Laufzeit festhält, liegt als Datei unter **einem** Verzeichnis: `DATA_DIR` aus
`src/config/paths.js`. Das ist `<repo>/data`, oder der Wert von `EVENTHELPER_DATA_DIR`, wenn er gesetzt ist
(ein relativer Wert gilt ab Repo-Wurzel; Docker-Volume, zweite Instanz mit eigenen Daten). Die editierbaren
JSON-Dateien der Stores liegen in `DATA_DIR/settings/`. Wie ein Store liest und (atomar) schreibt, steht in
[web-admin.md, Abschnitt Stores](web-admin.md#stores-srcstoresjsonstorejs-srcconfigpathsjs-419); neue Pfade immer
über `dataPath(...)` / `settingsPath(name)` bauen.

`data/` ist git-ignoriert und steht nur auf der Platte des Servers (bzw. im Docker-Volume `/app/data`). Nichts
davon lässt sich aus GitHub wiederherstellen.

## Welche Stores cachen

Die großen, ständig gelesenen Dateien hält ihr Store im Speicher (`createJsonStore({ cache: true })`) und liest
sie nur neu, wenn sich mtime, Größe oder Inode ändern (auch eine Änderung von Hand zählt). Das gilt für
`signups.json`, `events.json`, `raider-profiles.json`, `raid-events.json`, `rosters.json`, `characters.json`,
`logs.json` und `loot.json`, außerdem für `config.json`, `attendance-overrides.json`,
`availability-sessions.json`, `dungeon-runs.json`, `guild-bank-stock.json`, `raidhelper-budget.json`, `raidhelper-events.json` und
`user-prefs.json`.

- `read()` gibt eine Kopie heraus (structuredClone der ganzen Datei), die der Aufrufer ändern und zurückschreiben
  darf.
- `peek()` gibt den Cache selbst heraus, tief eingefroren und ohne Kopie. Das ist nur für die lesenden Zugriffe
  eines Stores gedacht, die einzelne Einträge suchen und nur diese kopiert herausgeben (`getSignup`,
  `listSignups`, `getEvent`, `listEvents`, `getProfile`, `getRaidEvent`, …). Dadurch kostet eine Abfrage je
  Event oder Raider nur diesen Eintrag und nicht die ganze Datei; vorher war z. B. die Abwesenheitsübersicht
  quadratisch in der Zahl der Raids (sekundenlang). Nichts Eingefrorenes verlässt einen Store; Schreibpfade
  beginnen immer mit `read()`.
- `raid-events.json` wird nur noch geschrieben, wenn ein Scan wirklich etwas Neues bringt. `updatedAt` ist der
  Zeitpunkt der letzten echten Änderung, nicht des letzten Scans.
- Wer eine dieser Dateien bei laufendem Bot von Hand ändert, braucht keinen Neustart: Die neue mtime genügt.

## Sichern und Wiederherstellen

Der Bot legt selbst Schnappschüsse von `DATA_DIR` an (#691, Teil des Epics #690). Die Kopie außer Haus (#692),
das Wiederherstellen (#693), der Schnappschuss vor dem Deploy (#695) und die Überwachung (#696) bauen auf dem
Verzeichnisaufbau unten auf – er ist ein Vertrag zwischen diesen Teilen und ändert sich nur mit allen zusammen.

### Schnappschüsse (`src/services/backup/`)

| Datei | Aufgabe |
|---|---|
| `snapshot.js` | Ein Schnappschuss (`createSnapshot`), dazu `latestSnapshot(backupDir)`, `listSnapshots`, `readManifest`, `readStatus` für die lesenden Teile |
| `retention.js` | Welche Schnappschüsse bleiben (rein, ohne Platte) |
| `snapshotJob.js` | Der Hintergrund-Job (`backupSnapshots` in `src/web/http/jobs.js`) und `runSnapshot()` für „Jetzt sichern“ |
| `backupConfig.js` | `BACKUP_DIR`, `BACKUP_ENABLED`, Vorgaben und Normalisierung des Einstellungsblocks `backup` |
| `restore.js` | Prüfen (`verifySnapshot`) und Zurückspielen (`restoreSnapshot`) eines Schnappschusses, Kennzahlen eines Datenverzeichnisses (`countDataDir`, mit `countsOf` aus `snapshot.js`); siehe „Wiederherstellen“ unten |

**Ablage** (`BACKUP_DIR`, Env; Standard auf dem Live-Server `/var/backups/pulsebot`, sonst – Windows, Dev-Checkout –
`<repo>/../pulsebot-backups`; immer außerhalb von Repo und `DATA_DIR`, ineinander verschachtelt lehnt der Lauf ab):

```
$BACKUP_DIR/                              Rechte 700
  snapshots/<YYYYMMDD-HHMMSS>-<reason>/   Zeit in UTC; reason: hourly | deploy | manual | pre-restore
    manifest.json                         { version: 1, createdAt, reason, commit, fromCommit?, toCommit?,
                                            files: { "<relpath>": { size, sha256 } }, counts: { ... } }
    data/...                              Spiegel von DATA_DIR
  latest -> snapshots/<neuester>          Symlink; wo das OS keinen erlaubt (Windows ohne Recht), eine Datei
                                          mit dem Inhalt "snapshots/<neuester>" – lesen immer über latestSnapshot()
  status/snapshot.json                    { at, ok, reason, durationMs, bytes, error? } – Ergebnis des letzten Laufs
  .snapshot.lock                          Sperre eines laufenden Schnappschusses (Bot oder Befehl)
  status/offsite.json, offsite-stage/,    gehören der Kopie außer Haus (#692, docs/backup.md)
  server-config/
  status/deploy-snapshot.json             { at, ok, exitCode, attempts, fromCommit, toCommit, error?, result } –
                                          der Schnappschuss vor dem letzten Deploy (deploy.sh, #695)
  status/restore-test.json                { at, ok, durationMs, bytes, snapshot, problems, counts, stores, loop,
                                          error? } – die letzte Wiederherstellungsprobe (#694, docs/backup.md)
  .restore-test-<id>/                     nur während einer Probe: der zurückgespielte Schnappschuss, danach gelöscht
```

**Auf dem Server einmal:** Der Bot muss `BACKUP_DIR` anlegen bzw. beschreiben dürfen. Läuft er nicht als root,
das Verzeichnis vorher für seinen Benutzer anlegen: `install -d -m 700 -o <bot-user> -g <bot-user>
/var/backups/pulsebot`. Sonst scheitert jeder Lauf mit `EACCES` (Logzeile `[backup]`; der Status lässt sich dann
auch nicht schreiben).

Ein Schnappschuss entsteht unter `snapshots/.<name>.part/` und wird erst am Ende umbenannt; erst danach wird
`latest` umgesetzt. Leser ignorieren Namen mit Punkt. Dateien sind 600, Verzeichnisse 700 (unter Windows nur so
weit, wie das OS es kennt). `counts` hält Plausibilitätswerte für das Wiederherstellen: `events`, `signups`,
`rosters`, `raidplans`, `reports`, `raidplanMaps`, `sessions` und `files`.

**Ablauf eines Laufs:**

1. Sperre (`.snapshot.lock`, auch gegen den Befehl in einem anderen Prozess; eine Sperre eines beendeten Prozesses
   oder älter als 2 h gilt als verwaist) und Platz-Wächter: unter **10 %** freiem Speicher auf dem Dateisystem von
   `BACKUP_DIR` entsteht kein Schnappschuss, der Status hält `ok: false` mit Grund fest.
2. `settings/` und `sessions.json` werden **synchron in einem Event-Loop-Tick** kopiert. Alle Stores schreiben
   synchron (`jsonStore.js`: `writeFileSync` + `rename`), dazwischen kann also kein Schreiben landen – der Stand ist
   über alle Dateien hinweg stimmig, besser als ein `cp`/`rsync` von außen. Asynchrone Schreiber unter `settings/`
   gibt es nicht (geprüft für #691). `sessions.json` (`web/http/auth.js`) und `settings/category-names.json`
   (`services/categories/categoryNames.js`) schreiben zwar nicht atomar, aber ebenfalls synchron – für den
   Schnappschuss genügt das.
3. Alles andere (`reports/`, `raidplan-maps/`, `sim/`, …) asynchron Datei für Datei: Stimmen Größe und mtime mit
   der Kopie im vorigen Schnappschuss überein, wird die Datei per **Hardlink** übernommen und ihr sha256 aus dem
   vorigen Manifest gelesen (nicht neu berechnet); sonst wird sie gestreamt kopiert und dabei gehasht, und die Kopie
   behält die mtime des Originals. Hat eine geänderte mtime denselben Inhalt (gleicher sha256), wird die Kopie
   wieder durch einen Hardlink ersetzt. Wo kein Hardlink geht (anderes Dateisystem), bleibt es bei der Kopie.
   Temp-Dateien der Stores (`.*.tmp`) und Symlinks kommen nie mit.
4. `manifest.json` schreiben, `.part` umbenennen, `latest` umsetzen, dann nach der Aufbewahrung aufräumen.
5. `status/snapshot.json` und eine Logzeile (`[backup]`) – auch bei einem Fehler. Ein Fehler wird nie geworfen, ein
   halber `.part`-Ordner wird entfernt (oder spätestens vom nächsten Lauf).

Gemessen (Windows-Entwicklungsrechner, 8 MB in `settings/`, 40 MB Reports, 5 MB Karten): synchroner Teil
32–45 ms, erster Lauf ~330 ms, folgende Läufe ~120 ms (nur `settings/` und `sessions.json` neu kopiert).

**Zeitplan und Aufbewahrung** stehen im Einstellungsblock `backup` von `config.json` (`configSchema.js`; noch
ohne Formular im Menü):

| Feld | Standard | Bedeutung |
|---|---|---|
| `intervalMinutes` | 60 | Abstand der stündlichen Schnappschüsse (15–1440). Der Job prüft jede Minute den neuesten `hourly`-Schnappschuss auf der Platte, ein Neustart löst also keinen zusätzlichen aus |
| `retention.hourlyHours` | 48 | jeder stündliche der letzten 48 Stunden |
| `retention.dailyDays` | 14 | der neueste stündliche je Kalendertag (UTC), die letzten 14 Tage |
| `retention.weeklyWeeks` | 8 | der neueste je ISO-Woche (Mo–So), die letzten 8 Wochen |
| `retention.monthlyMonths` | 12 | der neueste je Kalendermonat, die letzten 12 Monate |
| `retention.deployKeep` | 10 | die neuesten 10 `deploy`-Schnappschüsse |
| `retention.manualKeep` | 10 | die neuesten 10 `manual`-Schnappschüsse |
| `retention.preRestoreKeep` | 10 | die neuesten 10 `pre-restore`-Schnappschüsse |

Der neueste Schnappschuss überhaupt bleibt immer (auf ihn zeigt `latest`).

**An oder aus:** `BACKUP_ENABLED=1` schaltet die stündlichen Schnappschüsse ein, `0` aus. Ohne Wert macht sie nur
die Live-Instanz (`config/runMode.js`); eine Dev- oder Testinstanz legt also nichts an, solange man es nicht
ausdrücklich will (dann am besten mit eigenem `BACKUP_DIR` in ihrer `.env.dev`).

**Von Hand / vor dem Deploy:** `npm run backup:snapshot -- --reason manual` bzw.
`node scripts/backup/snapshot.js --reason deploy --from <sha> --to <sha> [--json]` – dieselbe Logik ohne
laufenden Bot (liest `.env.dev`, sonst `.env`, wie `bot.js`; `BACKUP_ENABLED` gilt hier nicht). Exit-Code 0 =
fertig, 1 = fehlgeschlagen, 2 = falsche Argumente, 3 = ein anderer Schnappschuss läuft gerade.

### Wiederherstellen (#693)

Nie von Hand kopieren, sondern mit dem Befehl. Er prüft vorher und legt einen Rückweg an. Das Runbook für die drei
Fälle (eine Datei, alle Daten, neuer Server) steht in [backup.md](backup.md#wiederherstellen).

```bash
npm run backup:list                                        # Schnappschüsse mit Zeit, Größe, Kennzahlen
npm run backup:restore -- latest --dry-run                 # was sich ändern würde
pm2 stop pulsebot
npm run backup:restore -- <name|latest|pfad> [--only settings/rosters.json]... [--prune]
pm2 start pulsebot
```

- **Prüfung zuerst**: Jede Datei des Manifests muss vorhanden sein, Größe und sha256 müssen stimmen, und jede `*.json`
  muss sich parsen lassen. Sonst ändert sich nichts. Das ist nötig, weil ein Store eine fehlende oder kaputte Datei
  stillschweigend als leer liest.
- **Rückweg**: Vor dem Zurückspielen entsteht ein `pre-restore`-Schnappschuss. `latest` überspringt diese
  Schnappschüsse, damit ein zweiter Aufruf nicht den kaputten Stand zurückholt.
- **Schreiben**: Der Befehl kopiert, statt einen Hardlink zu setzen. Schnappschüsse teilen sich Dateien per
  Hardlink, und `sessions.json` wird an Ort und Stelle geschrieben. Erst wenn alle Kopien gegen das Manifest geprüft
  sind, tauscht ein synchroner `rename`-Durchgang alle Dateien aus. Dabei hält der Befehl die
  Schnappschuss-Sperre (`.snapshot.lock`). Ersetzte Dateien behalten Rechte und Besitzer. Neue sensible Dateien
  (Spalte „Sensibel“ unten) bekommen 600, andere 644, neue Verzeichnisse 700.
- **Nur im Ziel** liegende Dateien bleiben stehen und werden aufgelistet. `--prune` löscht sie.
- Ein Schnappschuss kann auch außerhalb von `BACKUP_DIR` liegen, z. B. von restic zurückgeholt unter
  `<target>/var/backups/pulsebot/offsite-stage/latest`. Es genügen `manifest.json` und `data/`.

### Sonst

- **Ohne die Schnappschüsse** (z. B. vor einem Umzug von Hand): den Ordner `data/` bei gestopptem Bot kopieren.
  Eine Kopie im laufenden Betrieb ist dateiweise konsistent (atomare Writes), aber nicht über Dateien hinweg.
- **Docker**: das Volume sichern, das auf `/app/data` liegt ([deployment.md](deployment.md#docker)).
- Die Sicherung enthält **sensible** Dateien (Tabelle unten, u. a. `config.json` mit API-Schlüsseln und
  `sessions.json`): wie die `.env` behandeln, nicht in ein Ticket, einen Chat oder ein öffentliches Repo legen.
- Ohne Verlust wegwerfbar sind nur die Caches (`sim/results.json`, `settings/characters.json`,
  `settings/category-names.json`); sie füllen sich von selbst wieder. `settings/raid-events.json` gehört seit #737
  nicht mehr dazu: Es hält die Spielversion jedes Raid-Helper-Raids (und die Anmeldungen, die Raid-Helper später
  nicht mehr liefert). Neu gescannt bekäme ein Raid die Version, die seine Kategorie *dann* spielt.

## Dateien

Eigentümer = das Modul, das die Datei schreibt (unter `src/stores/`, wenn nicht anders angegeben; seit #425 liegen alle Stores dort, nicht mehr unter `src/web/`). Sensibel = enthält
Zugangsdaten, Token oder Sitzungen.

| Datei (unter `DATA_DIR`) | Eigentümer | Inhalt | Sensibel |
|---|---|---|---|
| `sessions.json` | `web/http/auth.js` | Web-Sitzungen: sid → `{ id, name, isAdmin, access, csrf, createdAt, adminCheckedAt }` | **ja** (eine sid ist ein Login) |
| `settings/config.json` | `settingsStore.js` | Bot-Einstellungen aus dem Web: Server, Kanäle, Rollen, Rechte, API-Zugänge (u. a. Blizzard-, WCL-v2- und Anthropic-Schlüssel, GitHub-Token der Addon-Downloads), die Addon-Liste (`addonDownloads`), Einstellungen je Discord-Server (`serverSettings`, #917; darin je Server der Raid-Helper-Schlüssel `raidhelper.apiKey`, #927, die Warcraft-Logs-Gilden je Version mit Abruf-Abstand und letztem Ergebnis `wclGuilds`, #922, und die Top-Items je Spielversion `topItems`, #952; die alte globale Liste liegt eine Version lang als `topItemsLegacy`) | **ja** |
| `settings/ingest-tokens.json` | `ingestTokenStore.js` | Token des Loot-Sync-Tools, nur als sha256-Hash, je Token Name, Ersteller, Zeiten, Uploads und der Discord-Server `guildId` (#994; `""` = vor der Server-Trennung erstellt, sieht alle Server) und bei persönlichen Schlüsseln (#1000) die Discord-ID `ownerId` der Person (dann ohne `guildId`; der Schlüssel gilt für die Server, auf denen sie gerade Orga ist) | **ja** (Hashes) |
| `settings/kader.json` | `kaderStore.js` | Kaderplaner je Discord-Server (`v: 2`): von Hand hinzugefügte Accounts, Charakter-Zuweisungen des Planers und die Kader mit Leitung, Fragen, Beispiel-Setups und je Spieler Status samt Verlauf, Wünschen, Gespräch (Antworten, Notiz), Stimmen und Kommentaren; dazu Revisionen (`rev`, `sharedRev`, je Kader/Gespräch/Frage/Zuweisung) und je Kader ein Aktivitäts-Log der letzten 50 Änderungen (nur Typen, Ids, wer, wann — keine Antworten, Notizen, Kommentare). Fehlende Revisionen gelten als 0. Je Kader hält `takeover` die Übernahme nach Discord fest (Roster-, Rollen-, Kategorie- und Kanal-IDs, wer, wann, Status und je Spieler `ok`/`missing`/`failed`; `null` vorher). Die Markierung `decisionsCleared` hält fest, dass alte Entscheidungen außerhalb des Rosters einmal aufgeräumt wurden. Wer gerade im Kader ist, liegt nur im Speicher, nie auf der Platte — intern, verlässt den Kaderplaner nie; siehe [kaderplaner.md](kaderplaner.md) | nein |
| `settings/user-notes.json` | `userNotesStore.js` | Vermerke je Discord-Server und Discord-Konto (#979): `guilds[server][userId] = { name, entries }`, je Eintrag Stufe (Hinweis, Warnung, Shadowban), Grund, Notiz (höchstens 1000 Zeichen), Raids, Ablauf (`null` = nie), geteilt ja/nein, Autor, Archiv-Marke und Verlauf; höchstens 50 Einträge je Person und Server. `hidden[server][entryId]` hält fest, welche geteilten Einträge anderer Server ein Server für sich ausblendet. Nur für den Bereich `vermerke`, nie für die Person, nie im Log; siehe [vermerke.md](vermerke.md) | **ja** (Notizen über Personen) |
| `settings/user-signals.json` | `userSignalsStore.js` | Hinweise aus den Daten für die Vermerke (#982): `guilds[server][userId] = { name, events }`, je Ereignis Art (Abmeldung nach Setzung, kurzfristige Abmeldung, Server verlassen), Raid, Zeitpunkt, Stunden vor dem Start; `ignored[server][userId][kind]` = Ausblenden der Orga. 180 Tage aufbewahrt, höchstens 60 je Person und Server; No-Shows werden nicht gespeichert, sondern aus den Anwesenheits-Korrekturen berechnet. Nur für den Bereich `vermerke`, nie für die Person; siehe [vermerke.md](vermerke.md) | **ja** (Verhalten von Personen) |
| `settings/calendar-tokens.json` | `calendarTokenStore.js` | Abo-Token des Raider-Kalenders, nur als sha256-Hash | **ja** (Hashes) |
| `settings/recruitment.json` | `settingsStore.js` | Recruitment-Vorlagen: `{ templates: [...] }`, je Vorlage `versionId` (#553) | nein |
| `settings/recruitment-posts.json` | `settingsStore.js` | Gepostete Recruitment-Nachrichten (zum späteren Bearbeiten), je Nachricht `versionId` des Bewerben-Knopfs (#553) | nein |
| `settings/raid-templates.json` | `settingsStore.js` | Raid-Vorlagen (Instanz, Größe, Rollen, Zeiten) | nein |
| `settings/notify.json` | `settingsStore.js` | Vorlagen für den Anmelde-Aufruf (Text mit Rollenping): `{ templates: [...] }` | nein |
| `settings/events.json` | `eventStore.js` | Eigene Events: `{ events: [...] }` | nein |
| `settings/signups.json` | `signupStore.js` | Anmeldungen: `{ signups: { [eventId]: { [userId]: signup } } }` | nein |
| `settings/event-series.json` | `eventSeriesStore.js` | Serien je Kategorie, ihre Läufe je Datum, letzter Lauf | nein |
| `settings/reminders-sent.json` | `reminderStore.js` | Welche Erinnerung je Event schon raus ist | nein |
| `settings/availability.json` | `availabilityStore.js` | Ab- und Anwesenheiten der Raider (Zeitraum, Grund bzw. Charakter, je Raid angewandt) und die Panels je Raid-Kategorie samt `links` (Link-Knöpfe je Kategorie, `{ label, url, emoji? }`) und `features` (ausgeschaltete Bereiche je Kategorie, `{ [categoryId]: { nextRaid|attendance|evaluation|guildBank|links: false } }`, fehlend = an, #969); ein Eintrag bleibt bis 120 Tage nach seinem letzten Tag (`availability.js KEEP_DAYS`), weil die Anwesenheit an ihm „Urlaub“ von „Abgemeldet“ unterscheidet (#677) | ja (Abwesenheitsgründe) |
| `settings/availability-sessions.json` | `availabilitySessionStore.js` | Offene Raid-Auswahlen beim Eintragen einer Ab-/Anwesenheit (Zeitraum, gewählte Raids), höchstens zwei Stunden alt | nein (kurzlebig, darf verloren gehen) |
| `settings/guild-bank.json` | `guildBankStore.js` | Gildenbank-Anfragen aus der Raid-Zentrale und die Wartelisten: `{ requests: [{ id, userId, userName, categoryId, item, amount, purpose, status: waiting/open/done/rejected/confirmed/handedOut, reason, createdAt, handledBy, handledByName, handledAt, channelId, messageId, bankKey, itemId, icon, group, characterName, realm, faction, handedOutBy, handedOutByName, handedOutAt, handoutVia, queueRank, fromWaitlist, addedBy, addedByName, recipientCheckedBy, recipientCheckedByName, recipientCheckedAt }] }` (#806: `recipientChecked*` = wer aus der Orga für den Empfänger gebürgt hat — beim Bestätigen, *Geprüft & bestätigen* oder *Im Spiel geprüft*; bleibt beim Lösen, ein neuer Empfänger löscht es; fehlt es an einer vorgemerkten Anfrage von vor #806, gilt `handledBy*`) (#775: `waiting` = Eintrag der Warteliste des Items, `queueRank` = Platz, kleiner zuerst — ein Rest, der seine Portion bekommen hat, bekommt einen neuen höchsten Rang; `fromWaitlist` = nachgerückte offene Anfrage; `addedBy*` = wer aus der Orga ihn angelegt oder importiert hat; `userId` darf bei solchen Einträgen leer sein, dann zählt `characterName`; verknüpft die Orga im Web einen Profil-Charakter, werden `userId`/`userName`/`characterName`/`realm` überschrieben — ob eine Anfrage verknüpft ist, wird nie gespeichert, sondern bei jedem Lesen gegen `raider-profiles.json` und den Beleg des Charakters geprüft) (`bankKey`/`itemId` = Anfrage aus dem Bestand, #633, mit Icon und Gruppe beim Anfragen; `characterName`/`realm`/`faction` = Empfänger im Spiel, Fraktion = die der Bank; `confirmed` zählt als vorgemerkt, `handledBy*` = wer bestätigt hat; `handedOut*` = wer ausgegeben hat, `handoutVia` `discord`/`manual`/`mail`); erledigte fallen 90 Tage nach dem Erledigen weg, wartende, offene und vorgemerkte bleiben; Ablauf in [signups.md](signups.md#gildenbank-srcservicessignupsguildbankjs-storesguildbankstorejs-utilssignupguildbankpostjs-utilssignupguildbankpickjs-commandssignupguildbankjs) | nein |
| `settings/dungeon-runs.json` | `dungeonRunStore.js` | Dungeon-Läufe und Erfolgspunkte aus dem Addon LevelHelper (`POST /api/ingest/levelhelper`): je Lauf Version, Gilde, Dungeon, Zeit, Start, Medaille, Mitglieder (GUID, Name, Klasse), die Addon-Ids aller Meldungen, Uploader und `recordPostedAt`; je Charakter Version, Name, Klasse, Stufe, Erfolgspunkte und Stand; siehe [dungeon-leaderboard.md](dungeon-leaderboard.md) | nein |
| `settings/guild-bank-stock.json` | `guildBankStockStore.js` | Gildenbank-Bestand aus den Addon-Scans (#631): je Bank (Schlüssel Spielversion + Realm + Gilde) `guildId` (Discord-Server, leer = wartet auf Zuordnung), der letzte Scan (Zeitpunkt, Scanner, Gold, Tabs, Menge je Item und Tab), `tabSettings` (ausgeblendete Tabs) und je Item die Einordnung der Orga (`new`/`hide`/`show`/`give`, Reserve, Höchstmenge, `portion` = Portion pro Runde der Warteliste 1–99, 0 = Standard 2, Kategorie, `addedByHand`/`addedAt` bei einem von Hand angelegten Item ohne Scan) samt Name (englisch), Icon, Qualität und Item-Klasse (von Wowhead, zugleich Cache der Nachschlage; `metaVersion` 2 = englische Namen, ältere deutsche werden von selbst neu geholt); dazu `emojis: { [itemId]: { id, name, icon, createdAt } }` — das App-Emoji `gb_<itemId>` jedes ausgebbaren Items (#633, eins je Item über alle Banken, `services/guildbank/itemEmojis.js`); siehe [loot-import.md](loot-import.md#gildenbank-scans-apiingestguildbank) | nein |
| `settings/discord-invites.json` | `discordInviteStore.js` | Die eigenen Einladungen des Bots (#905): `{ links: { ["from:to"]: { code, channelId, createdAt, error, deleted } }, general: { [guildId]: {…} }, channels: { [guildId]: channelId } }` — je Verknüpfung höchstens eine Einladung auf dem Quell-Server, je Server höchstens eine allgemeine, der Kanal der Einladungen (docs/discord-servers.md). Löschen = keine Einladungen mehr, bis jemand in den Einstellungen „Erzeugen“ klickt; die alten Codes bleiben auf Discord und zählen für keine Verknüpfung mehr | nein |
| `settings/member-origins.json` | `memberOriginStore.js` | Herkunft je Mitglied (#905): `{ origins: [{ guildId, userId, inviteCode, linkKey, joinedAt }] }` — über welche Einladung einer Verknüpfung jemand dem Server beitrat (unbekannte Herkunft und Beitritte über die allgemeine Einladung werden nicht gespeichert; die Herkünfte einer entfernten Verknüpfung löscht der nächste Abgleich), die erste bekannte zählt; bleibt nach dem Verlassen stehen, höchstens 20000 Einträge. Löschen = „Beigetreten“ beginnt bei 0 | ja (Discord-IDs mit Beitrittsweg) |
| `settings/talk-overview.json` | `talkOverviewStore.js` | Je Verknüpfung (`from:to`): Kanal, Nachricht und Hash ihrer Raid-Liste | nein |
| `settings/raid-overviews.json` | `raidOverviewStore.js` | Die Raid-Übersichten je Kategorie (`/createoverview`): `{ overviews: [{ guildId, channelId, messageId, categoryId, hash, lastChange }], scannedGuilds: [guildId] }` — mehrere je Kategorie; eine Übersicht des ganzen Servers (`/createoverview scope:server`) steht als `{ guildId, channelId, messageId, categoryId: "", scope: "server", hash, lastChange }` darin, höchstens eine je Kanal; `scannedGuilds` = Server, deren Kanäle nach alten Übersichten durchsucht wurden (docs/discord-servers.md) | nein |
| `settings/orga-signup-notices.json` | `orgaSignupNoticeStore.js` | Hinweis an die Orga bei Anmeldung (#983): `{ events: { [eventId]: { [userId]: at } } }` = wer sich für einen Raid schon einmal angemeldet hat, während der Schalter an war (damit nur die erste Anmeldung eine Zeile bringt); ein Raid fällt weg, sobald alle Marken älter als 90 Tage sind. Enthält nichts über Vermerke; siehe [vermerke.md](vermerke.md) | nein |
| `settings/orga-hubs.json` | `orgaHubStore.js` | Die Orga-Zentrale je Raid-Kategorie: `{ hubs: [{ categoryId, guildId, channelId, messageId, postedAt, postedBy, hash }], links: { [categoryId]: [{ label, url, emoji? }] }, features: { [categoryId]: { newRaid|links|summary: false } } }` — `features` = ausgeschaltete Teile (fehlend = an, #969), `links` sind die bis zu 5 Link-Knöpfe der Orga je Kategorie (`emoji` optional: ein Unicode-Emoji oder `<:name:id>`) (docs/events.md) | nein |
| `settings/role-messages.json` | `roleMessageStore.js` | Rollen-Nachrichten: `{ messages: [{ id, guildSide, channelId, messageId, title, body, imageUrl, color, roles: [{ roleId, emoji, label }], createdBy, createdAt, updatedAt }] }` — der Bot ordnet Reaktionen über die `messageId` zu. Löschen = Knöpfe und Reaktionen der geposteten Nachrichten wirken nicht mehr (docs/role-messages.md) | nein |
| `settings/member-activity.json` | `memberActivityStore.js` | Neu und gegangen auf den konfigurierten Servern für die Discord-Übersicht: `{ entries: [{ guildId, userId, name, at, kind: join/leave, roles: [{ id, name }] }] }` — Rollen nur beim Gehen; 14 Tage, höchstens 2000 Einträge (docs/discord-servers.md „Discord-Übersicht“). Löschen = die Liste beginnt leer | nein |
| `settings/addon-center.json` | `addonCenterStore.js` | Die Addon-Downloadzentrale im Discord: `{ channelId, roleId, versionId, center: { guildId, channelId, messageId, url, postedAt, postedBy, hash } \| null, ping: { channelId, messageId, postedAt } \| null, checkedAt, seen: { [addonId]: { version, previous, newSince, notifiedAt } } }` — Einstellungen (Kanal, Rolle für Update-Pings `roleId`, Spielversion `versionId`: `""` = automatisch aus der Kategorie des Kanals, sonst eine bekannte Versions-ID; alte Dateien ohne Feld = automatisch), die gepostete Nachricht, der letzte Update-Ping (`ping`, wird nach 12 Stunden oder vom nächsten gelöscht), die zuletzt bekannte Version je Addon (`newSince` = Beginn der sieben Tage „NEU“). Alte Dateien können noch `announce` und `updates` (die Update-Meldungen mit Patchnotes) tragen: das wird ignoriert und beim nächsten Schreiben verworfen. Löschen = die Zentrale gilt als nicht gepostet, der nächste Lauf pingt nichts nach (docs/addons.md) | nein |
| `settings/event-loot-system.json` | `eventLootSystemStore.js` | Loot-System je Event (z. B. softres) | nein |
| `settings/event-sheets.json` | `eventSheetStore.js` | Welche Events ins Google-Raidsheet geschrieben wurden | nein |
| `settings/event-softres.json` | `eventSoftresStore.js` | Angelegte softres.it-Listen je Event (Links) | nein |
| `settings/raid-events.json` | `raidEventStore.js` | Schnappschuss gesehener Raid-Helper-Events (Cache) samt `versionId` (#737): die Spielversion, die die Kategorie beim ersten Scan spielte – ein späterer Scan überschreibt sie nicht, ältere Einträge stempelt die Start-Migration einmal; siehe [game-versions.md](game-versions.md) „Version fest an jedem Raid“ | nein |
| `settings/raidhelper-events.json` | `raidhelperEventsStore.js` | Die Raid-Helper-Eventliste (mit Anmeldungen) des letzten Abgleichs, `syncedAt`, letzter Fehler (Cache, #608); seit #927 je Discord-Server unter `servers[guildId]` | nein |
| `settings/raidhelper-budget.json` | `raidhelperBudgetStore.js` | Anfragen an Raid-Helper je Stunde der letzten 24 h, Sperre nach HTTP 429 (#608); seit #927 je Discord-Server unter `servers[guildId]`, eine Sperre gilt nur für diesen Server. Löschen setzt nur den Zähler zurück, nicht den von Raid-Helper | nein |
| `settings/category-names.json` | `services/categories/categoryNames.js` | Letzte bekannte Namen der Discord-Kategorien (Cache) | nein |
| `settings/backup-alerts.json` | `backupAlertStore.js` | Drossel der Sicherungs-Warnung per Discord-DM (#696): je Teil Zustand und Zeitpunkt der letzten Nachricht | nein |
| `settings/channel-archive.json` | `channelArchiveStore.js` | Archiv-Kategorie, Namensschema, Archiv-Log der Kanäle-Seite | nein |
| `settings/raidplans.json` | `raidplanStore.js` | Raidpläne: `{ plans: [...] }` mit Boards je Boss, `publicToken` der Freigabe | nein (der Token öffnet nur die Lese-Ansicht) |
| `settings/raidplan-posts.json` | `raidplanPostStore.js` | Wo der Link zu den Einteilungen je Event gepostet wurde (Kanal, Nachricht, Text) | nein |
| `raidplan-maps/` | `raidplanStore.js` | Hochgeladene Raumkarten (Bilder) je Boss/Instanz/Vorlage | nein |
| `settings/raidplan-templates.json` | `raidplanTemplateStore.js` | Raidplan-Vorlagen, seit #945 je Discord-Server (`serverId`, Kopien mit `originId`); die alte, globale Datei liegt einmalig als `raidplan-templates.json.pre-945` daneben, siehe [raidplan/catalog.md](raidplan/catalog.md) „Bibliothek je Server (#945)“ | nein |
| `settings/raidplan-profiles.json` | `raidplanProfileStore.js` | Taktik-Profile, seit #945 je Discord-Server (`serverId`, gleiche Id auf jedem Server); die alte Datei liegt einmalig als `raidplan-profiles.json.pre-945` daneben | nein |
| `settings/raidplan-catalog.json` | `raidplanCatalogStore.js` | Eigene/überschriebene Mobs und Zauber des Katalogs | nein |
| `settings/loot.json` | `lootStore.js` | Importierter Loot (Gargul/RCLootcouncil/Addon), dazu `deleted`: Schlüssel von Hand gelöschter Einträge, damit kein Import sie zurückbringt | nein |
| `settings/loot-inbox.json` | `lootInboxStore.js` | Addon-Uploads, die noch auf Bestätigung warten, und erledigte Sessions | nein |
| `settings/logs.json` | `logStore.js` | Ausgewertete WCL-Reports (damit keiner zweimal läuft); jeder Log mit seinem Discord-Server (`guildId`, `guildFrom`, `postGuildId`, #917, siehe [discord-servers.md](discord-servers.md#data-per-server-settings-and-assignment-917-epic-926)) | nein |
| `reports/<id>.json` | `reportStore.js` | Die gespeicherten Log-Auswertungen (Report-Seiten `/r/`), jede mit ihrem Discord-Server (`guildId`, #920) | nein |
| `settings/migrations.json` | `migrationMarkStore.js` | Abgeschlossene Einmal-Migrationen beim Start (`{ done: { key: Zeitpunkt } }`, #920: `reportGuilds`). Löschen lässt sie beim nächsten Start einmal erneut laufen (sie sind wiederholbar, kosten nur Startzeit) | nein |
| `settings/logGear.json` | `logGearStore.js` | Aus einem WCL-Report geladenes Gear je Raider | nein |
| `settings/characters.json` | `characterStore.js` | Klasse/Spec je Charakter (Cache aus Loot und Logs) | nein |
| `settings/raider-characters.json` | `raiderCharactersStore.js` | Charakter je Raider und Raid-Kategorie (Orga-Zuordnung) — nur noch für Kategorien ohne Roster; nach der Roster-Migration (#653) bleibt die Datei unverändert liegen, gelesen und geschrieben wird für Kategorien mit Roster `rosters.json` | nein |
| `settings/rosters.json` | `rosterStore.js` | Raid-Roster (#653): `{ rosters: { [id]: { id, guildId, name, categoryId, versionId, roleIds, trialRoleId, managers: { roleIds, userIds }, slots, allowMultipleChars, signupOnly, source, members: { [userId]: { status, since, by, chars, charNames, note, trialUntil } }, history (die letzten 500), createdAt, createdBy } }, migratedCategories }` — höchstens ein Roster je Kategorie; `migratedCategories` = Kategorien, die die Start-Migration schon übernommen hat (ein gelöschtes Roster entsteht nicht neu); `versionId` ist gespeichert, nicht aus der aktuellen Einstellung abgeleitet (#737: beim Anlegen die Version der Kategorie, ein Roster ohne Version stempelt die Start-Migration einmal); `history` hält seit #656 auch Discord-Rollen (`role-given`, `role-taken`, `role-give-failed`, `role-take-failed`) und Änderungen „via Discord“; siehe [roster-profile.md](roster-profile.md#roster-je-kategorie-store) | nein (Notizen der Orga zu Mitgliedern, nur intern) |
| `settings/raider-profiles.json` | `raiderProfileStore.js` | „Mein Profil“: Charaktere (je mit `versionId`, #543, `source` log/armory/manual, `armory: { level, guild, fetchedAt }` = Antwort des Arsenals; `verifiedBy`, `verifiedByName`, `verifiedAt` nur, wenn die Orga den Charakter in der Gildenbank „im Spiel geprüft“ hat — ob ein Charakter bestätigt ist, wird nie gespeichert, sondern bei jedem Lesen aus Logs, Loot, Arsenal und dieser Prüfung abgeleitet, `services/characters/characterEvidence.js`), Specs, je Charakter `professions: [{ id, skill }]` (höchstens zwei Hauptberufe aus dem Regelsatz der Version, `skill` null ohne Obergrenze im Regelsatz) und `wishItems: [{ itemId, name, icon, quality }]` (höchstens zehn, nur Loot-Council-Roster, Name/Icon/Qualität von Wowhead der Version — nur Raider und Orga lesen sie), Wochentage mit `availabilityFrom: { [Tag]: "HH:MM" }` (Viertelstunden, nur für gewählte Tage), Wünsche der Raider | nein |
| `settings/spec-history.json` | `specHistoryStore.js` | Spec-Historie (u. a. aus dem Raid-Helper-Import), je Eintrag `versionId` (#543) | nein |
| `settings/roster-hidden.json` | `rosterHiddenStore.js` | Im Roster ausgeblendete Charaktere | nein |
| `settings/attendance-overrides.json` | `attendanceOverridesStore.js` | Von Hand gesetzte Anwesenheit (#677): `{ overrides: { [eventId]: { [userId]: { status, reason, by, byName, at } } } }` — `status` einer der sechs Codes (`present`, `bench`, `vacation`, `absence`, `noSignup`, `noShow`), `reason` freier Text bis 200 Zeichen; gewinnt immer vor der Automatik, „Automatisch“ löscht den Eintrag ([roster-profile.md](roster-profile.md#anwesenheit-status-je-abend-und-von-hand-korrigieren-677)) | ja (Gründe der Orga) |
| `settings/council-excluded.json` | `councilStore.js` | Raider, mit denen der Loot-Council nicht mehr plant | nein |
| `settings/council-roles.json` | `councilStore.js` | Rolle je Raider, die der Council festlegt (Offspec-Abende) | nein |
| `settings/council-manual-bis.json` | `manualBisStore.js` | Von Hand gepflegte BiS-Listen (#760) für Spielversionen ohne eigene BiS-Daten (Forever): je Version, Spec und Slot bis zu drei Items (das erste BiS, weitere gleichwertig) mit Name/Icon von Wowhead, dazu wer und wann. Die Orga füllt sie im Loot-Council (Tab „BiS-Listen“); fehlt die Datei, gibt es keine Listen | nein |
| `settings/council-profiles.json` | `councilProfilesStore.js` | Loot-Council-Profile (#676): je Profil Name, Gewichtung (wie `council-weights.json`) und Ansicht (Rolle, Tiers, Raids, BiS-Liste, Version), dazu `defaultId` („Standard“), `categories` (Profil einer Kategorie ohne Roster) und `migrated`. Welches Profil ein Roster nutzt, steht im Roster (`lootProfileId`, `rosters.json`). Fehlt die Datei, gilt ein „Standard“ mit den Vorgaben | nein |
| `settings/council-views.json` | `councilStore.js` | Seit #676 nur noch Quelle der einmaligen Umstellung auf Profile (Filter je Raid-Kategorie aus #641); bleibt liegen, wird nicht mehr gelesen | nein |
| `settings/council-weights.json` | `councilWeightsStore.js` | Gewichtung des Loot-Councils aus #668 (Server `global`, je Raid-Kategorie `categories`). Seit #676 nur noch Quelle der einmaligen Umstellung auf Profile (`council-profiles.json`); bleibt liegen, wird nicht mehr gelesen | nein |
| `settings/user-prefs.json` | `userPrefsStore.js` | Einstellungen je Konto (Sprache des Menüs und der persönlichen Bot-Nachrichten) | nein |
| `sim/results.json` | `simStore.js` | Cache der Loot-Council-Simulationen (Schlüssel = Loadout + Binary) | nein |
| `rh-fixture-mode.txt` | `src/utils/raidhelper/fixture.js` | Nur Dev: Modus des Raid-Helper-Stand-ins einer Testinstanz | nein |

Wer einen neuen Store anlegt, trägt seine Datei hier ein. Die Ausgabe von `npm run agents -- --html` landet nicht
mehr in `data/`, sondern im Temp-Verzeichnis (`scripts/README.md`).
