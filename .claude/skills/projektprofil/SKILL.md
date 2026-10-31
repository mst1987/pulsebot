---
name: projektprofil
description: Projektprofil EventHelper / PulseBot für das Agenten-Team claude-crew — Repo, Worktree und Testinstanz, Tests, Commit, PR und Merge (Merge = Deploy), UI-Prüfung, Live-Zugang, Spieldaten, Design, Projektfallen. Wird in die claude-crew-Agenten vorgeladen.
---

# Projektprofil EventHelper / PulseBot

Wegweiser mit den Werten, die ein Agent sofort braucht. Ausführlich: `CLAUDE.md` (Workflow, Tests,
Konventionen), die pfadgebundenen Regeln in `.claude/rules/` (laden beim Lesen passender Dateien) und
das Bereichswissen in `docs/` (Index in `CLAUDE.md`). Neues Bereichswissen gehört nach `docs/`,
dateigebundene Regeln nach `.claude/rules/` — nicht hierher und nicht in `CLAUDE.md`.

## Repo

- Hauptcheckout `D:\programming\eventhelper`, Default-Branch `main` (`dev` wird nur synchron gehalten,
  nie davon abzweigen), Remote `mst1987/pulsebot` (**öffentlich** — keine Hosts oder Schlüssel einchecken).
- Stack: Node ≥ 22 (`.nvmrc` 22), CommonJS-Bot ohne TypeScript, discord.js 14, eigener HTTP-Router
  (`src/web/http/`), JSON-Stores unter `data/` (git-ignoriert, keine DB, keine Migrationen — Store-
  Migrationen laufen beim Start, `src/stores/settings/settingsMigration.js`). Web-Admin: React + Vite + TS in
  `src/web-client/`, gebaut nach `dist/`.
- Verwandt: `D:\programming\eventhelper-addon` (`mst1987/eventhelper-addon`, öffentlich: Lua-Addon
  EventHelperSync + Node-Sync-Tool). Wire-Format `eventhelper-loot` — eine Änderung braucht beide
  Repos (`Export.lua` ↔ `src/utils/loot/lootImport.js`, `EH_VERSION`). Release-Tags dort nur nach
  Absprache (Auto-Update an alle Nutzer).

## Worktree und Testinstanz

- Pflicht für jede Änderung (CLAUDE.md „Development Workflow"). Vorher `git fetch origin`, dann
  `git worktree add -b feature/<name> D:\programming\eventhelper-<name> origin/main` (Git 2.18:
  **ohne** `--quiet`). Hauptcheckout nie als cwd, `git -C <worktree> …`. Fremde
  `eventhelper-*`-Worktrees nicht anfassen.
- Hooks: `guardMainCheckout.js` (Edit/Write), `guardMainShell.js` (Shell-Umleitungen),
  `mainCheckoutClean.js` (Stop-Hook blockt Streudateien im Hauptcheckout — Prüfung von Hand
  `npm run check:main`), `lintChanged.js` (ESLint nach jedem Edit). Dazu der claude-crew-Guard.
- `node_modules`: echte Installation, keine Junction — im Worktree `npm ci`; für Client-Tests/-Build
  zusätzlich `cd src/web-client && npm ci`.
- Testinstanz: `.env.dev` aus dem Hauptcheckout kopieren, `WEB_PORT=<port>` (ab **3010**, je
  Worktree eigener, nie 3005) und `DEV_AUTO_LOGIN=1` anhängen; Client einmal bauen
  (`cd src/web-client && npm run build`), dann `npm start` im Worktree. Testdaten: `npm run dev:seed`
  (Testraid mit 25 Anmeldungen, Setup, Raidplan) oder `data/settings` aus dem Hauptcheckout kopieren.
  Fester Dev-Discord-Server `1139509316387344395` (dort dürfen Agenten Kanäle anlegen/löschen).
- Ein eigener Test-Launcher muss dotenv laden, bevor er Stores oder `src/config/variables` lädt,
  sonst läuft die Instanz auf dem Default-Port 3005.
- Test-URL `http://localhost:<port>/` gehört in Bericht und PR-Body. Nach dem Merge: Instanz stoppen
  (Ports 3010–3020 per `Get-NetTCPConnection`), dann `git worktree remove` **einzeln, ohne
  `--force`**, danach `git worktree list` prüfen; bei „not a git repository" sofort stoppen.

## Tests

- Bot (Jest, `test/` spiegelt `src/`): gezielt `npx jest <pfade>`, vor dem Commit `npm test` und
  `npm run lint`; CI fährt `npm run test:coverage` (Schwellen in `jest.config.js`).
- Client (`src/web-client/`): `npm test` (Vitest), `npx tsc -b`, `npm run lint -- --max-warnings=18`
  (Ratchet in `ci.yml`, nur senken), `npm run lint:css` (Stylelint: Farben nur in `tokens.css`).
- Wächter: `test/docs/testMirror.test.js` (jedes Backend-Modul von einem Test geladen),
  `test/docs/layering.test.js`, `test/docs/claudeMd.test.js` (Doku-Index, Pfad-Wächter, CLAUDE.md
  ≤ 180 Zeilen/12 KB, `paths:`-Frontmatter der Regeln), `test/docs/folderSize.test.js` (≤ 25 Module je
  Ordner, sonst Unterordner; verschieben mit `npm run move`), `test/web/noCycles.test.js`, `test/web-client/conventions/` (Quelltext-Scans),
  `test/claude-hooks/` (Hooks). `test/setup/noNetwork.js` lässt jeden echten Netzaufruf scheitern.
- Stores in Tests über `tempStoreFile()` (`test/helpers/tempStore.js`) oder `memoryFs.js`, nie
  `os.tmpdir()`. Discord/API-Clients immer gemockt (`test/helpers/`).
- Testausgabe in eine Datei umleiten und ganz lesen, nie per head/tail kürzen.

## Commit und Sprache

- Commits Deutsch, Stil `Bereich: Beschreibung` (z. B. `Raidplan: Tank-Slot zählt als Tank`).
- Code, Bezeichner, Kommentare **Englisch**; 4 Leerzeichen, doppelte Anführungszeichen, Semikolons,
  LF, nur CommonJS.
- Bot-Texte für Raider: englisch im Code über `tr(lang, "…")` (`src/utils/i18n/botText.js`),
  deutscher Katalog in `src/config/botText/de/`; Orga-/Admin-Texte im Bot bleiben deutsch.
  Web-Client: i18n `src/web-client/src/i18n/locales/{de,en}` — immer beide.

## PR und Merge

- Werkzeug `gh` (angemeldet als `mst1987`; ggf. `C:\Program Files\GitHub CLI\gh.exe`). Body per
  `gh pr create --body-file`, Abschnitte `## Was` / `## Geprüft` (mit Test-URL/Port). Keine Labels,
  keine Patchnote.
- Branch-Namen **ohne** „token"/„secret" (sonst wird `main` nach dem Merge rot, Deploy entfällt).
- Vor dem PR und vor jedem Update `origin/main` mergen, Konflikte lokal lösen, Tests + Lint erneut.
- **Vor jedem Nach-Push** `gh pr view <nr> --json state,mergedAt` — ist er gemergt: neuer Branch ab
  `origin/main`, `cherry-pick`, neuer PR.
- **Merge-Politik:** Der `pr-agent` mergt **selbst**, sobald die Checks `Lint`, `Test` und
  `Web client` grün sind und keine Konflikte bestehen (Dauerfreigabe des Nutzers; `gh pr merge`).
  Nicht gedeckt: rote Checks, Force-Push, vom Nutzer markierte Punkte. Der Dirigent kann im
  Auftrag „nicht mergen" festlegen — das gilt dann.
- **Merge = Deploy:** jeder Merge auf `main` deployt automatisch auf den Produktions-VPS
  (`ci.yml` → `deploy.sh`, Health-Check `/health`). Viele Merges am Stück: Repo-Variable
  `DEPLOY_PAUSED=1`, am Ende `gh workflow run ci.yml --ref main` — beides nur in Absprache mit dem
  Nutzer. Details `docs/deployment.md`.
- Nach dem Merge aufräumen (siehe Worktree); lokalen `main` im Hauptcheckout nur `--ff-only`.

## UI-Prüfung

- puppeteer-core (im Scratchpad installieren) mit Chrome
  `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`, `headless: "new"`.
- Breite über `page.setViewport()` (Desktop 1361–1500, Mobil 390), nie `--window-size` (nie unter
  500 px); Überlauf per `scrollWidth > clientWidth` messen, nicht am Bild.
- Worst Case prüfen: Testraid mit 25 Anmeldungen, lange Namen, jeden Raider hovern. Erfundene
  User-IDs lassen `discord.resolveUserNames` hängen → im Test-Launcher stubben. Screenshots mit
  absolutem Scratchpad-Pfad.

## Live-Zugang (nur lesend)

- Öffentlich: `GET https://pulse-ts.site/health` (laufender Commit, Modus). Systemstatus-Seite
  `/system` (Voll-Admins).
- Server: 1 vCPU / 921 MB, pm2-Prozess `pulsebot` in `/var/www/pulsebot`. SSH-Host und Schlüssel
  nennt der Dirigent (nicht im Repo). Erlaubt: `pm2 logs pulsebot --nostream --lines <n>`, Status,
  Dateien lesen. **Jeder Schreibbefehl** (Neustart, Dateien, Variablen, Deploy) wird dem Nutzer
  geprüft zum Selbst-Ausführen gegeben.

## Spieldaten

- Versionen nebeneinander: TBC Anniversary (Thunderstrike EU), Classic Era, WoW Forever — Regelsätze
  in `src/config/gameVersions/`, Modell und Trennung in `docs/game-versions.md`.
- Quellen: Wowhead-Tooltip-API, Warcraft Logs (`fresh.warcraftlogs.com`; Encounter-IDs der
  Anniversary-Raids versetzt, `config/data/bosses.js` `baseEncounterId()`), Blizzard-API Namespace
  `profile-classicann-eu`. classic-armory.org nur als Link (kein Scraping).
- Generierte Daten in `src/config/generated/` nie von Hand ändern — Generatoren in `scripts/`
  (`scripts/README.md`).

## Design

- Farben nur als Variablen in `src/web-client/src/styles/tokens.css` (Dark-Default + Light);
  Akzent Arcane-Blau, **kein Gold**. UI-Kit in `src/web-client/src/components/ui/` — erst prüfen.
- Wenig Infos pro Seite, Details in Aufklappern/Tooltips/Modals; jede Zahl mit Wort („Tanks 1/2");
  Tabellen sortierbar; einzelne An/Aus-Optionen nur als `ui/Switch` (Listen-Checkboxen okay), Zahlen
  mit −/+; sichtbare farbige Zurück-Knöpfe; Knopf-Farbe = Wirkung (go/yes/no/danger/ghost) mit Icon.
- Designvorschläge als Canvas, Umsetzung nicht auf Abnahme warten, wenn der Nutzer „fang an" sagt.

## Projektfallen (Checkliste für den reviewer)

1. Alles mit Spielinhalt liest die Version über `versionOfEvent` (`services/versions/mainVersion.js`);
   eine Seite zeigt nur eine Version, kein „all", leere Versionseinstellung ist nie ein TBC-Ersatz.
2. Kein „Main-Charakter" — nur die Reihenfolge je Version (`raiderProfileStore.firstCharacter`).
3. Raid-Helper (1000 Anfragen/24 h, Key mit Prod geteilt) nur über den Sync-Job/Snapshot
   (`createRaidhelperClient()`), nie `{ live: true }` aus einer Seite; Testinstanzen fragen nichts im
   Hintergrund.
4. Discord-Interaktionen erst bestätigen (`deferReply`/`deferUpdate`/`showModal`), dann prüfen —
   3-s-Grenze; nach `deferReply()` kein `reply()`.
5. Member-Lookups auf Seitenanfragen brauchen ein Zeitlimit wie `resolveUserNames` (`NAME_FETCH_MS`
   in `services/discord/discord.js`), sonst hängt die Seite bis zu 120 s.
6. Discord-Links nur über `services/discord/linkCheck.js`, nie `discord.com/channels/` selbst bauen.
7. Neue Lazy-Chunks mit `lazyWithReload()`, nie `lazy()` (weiße Seite nach Deploy).
8. CSS-Klassen/IDs nie mit `ad-`, `ads-`, `advert`, `sponsor` (Adblocker blenden sie aus).
9. Jedes Backend-Modul braucht einen Test (`testMirror`); `commands/` und `utils/` requiren nie aus
   `src/web/` (`layering`); kein echter Netzaufruf in Tests.
10. Bot-Texte für Raider über `tr()` + deutschen Katalog; Client-Texte in `de` **und** `en`.
11. Farben nur als Token, kein Gold, keine Einzel-Checkbox, jede Zahl mit Wort.
12. Kein Bereichswissen in `CLAUDE.md` (Größengrenze) → `docs/` bzw. `.claude/rules/`; neue
    `docs/`-Datei in den Index.
13. Branch-Name ohne „token"/„secret"; vor jedem Nach-Push PR-Status prüfen.
14. Kein `git stash` und kein `git add -A` neben parallelen Agenten; PowerShell-`[IO.File]` nur mit
    absoluten Pfaden (relativ schreibt in den Hauptcheckout).
15. Kein hartkodiertes Discord-ID/API-Key in Commands/Utils — über `src/config/` oder Settings-Store.
16. Selbstvergabe einer Rolle per Knopf oder Reaktion (Addon-Abo, Rollen-Nachrichten): Rolle darf nichts freischalten — keine Bot-Rechte
    (adminRoleIds/ADMIN_ROLE_IDS, orgaRoleIds, officerRoleId, rolePermissions, botCommandAccess[*].roleIds,
    categoryRoles, Roster roleIds/trialRoleId/managers.roleIds, roleSync beide Seiten), keine
    Discord-Berechtigungen über @everyone hinaus, keine Kanal-Overwrites mit allow
    (`services/discord/roles/selfRole.js`). **Jedes neue rollenbasierte Config-Feld** (Rechte, Pings,
    Freigaben) muss auch in `selfRole.configReason` — sonst kann sich jemand die Rolle selbst holen.
    Rollenfelder entstehen auch als **Nebenwirkung**: der Versionswechsel einer Kategorie legt mit
    `categorySwitchFixes[*].roster.roleIds` ein Roster an (`rosterVersionSwitch`) und
    `mirrorCategoryRoles` spiegelt Roster-Rollen nach `categoryRoles`. Ein Schutz auf Rollenfelder
    (z. B. PuG-Onboarding-Rollen, #930) muss diese Wege vor dem Speichern mitsimulieren
    (`rostersAfterSwitches`); Stufen (lesen/schreiben) und Abgleich-Paare zählen je einzeln.
17. Login-Rücksprünge und interne Umleitungen: `server.js` dekodiert den pathname, daher kann jede
    Route, die aus dem Pfad weiterleitet (`legacyMount` `/admin`, `/admin2`), aus einem harmlosen
    Pfad `//host` machen. Jedes Umleitungsziel durch `safeReturnPath` schicken und Ketten
    (Rücksprung → zweite Umleitung) im Test prüfen.
18. Server-Bezug von Auswertungen (#920): Er hängt nicht nur an `logStore.listLogs()`. Jede Liste,
    jede Kachel und jeder Slash-Befehl, der Reports zeigt, muss über die Report-Regel
    (`services/logcheck/reportGuild.js`: Log per `reportRefId` entscheidet, sonst `report.guildId`)
    nach Server filtern; ohne aktiven Server leer, nie alle Server. Neue Report-Auswahl → Negativ-Test
    mit einem Report eines anderen Servers. Wer ein Log löscht oder umhängt, schreibt den Server auf
    den Report (`deleteLogKeepingReportGuild` / `reportStore.setReportGuild`).
19. Realm/Region je Server (#923): Spielwerte eines Raiders laufen über
    `settingsForVersion(versionId, { guildId })` bzw. `blizzardFor` (`services/versions/versionSettings.js`:
    Standard der Version + `serverSettings[guildId].versionOverrides`). Eine abweichende Region
    zieht den Blizzard-Namespace mit (`profile-classicann-eu` → `-us`), nie den Standard-Namespace
    mit fremder Region kombinieren. Caches von Blizzard-/Armory-Antworten brauchen Region, Realm und
    Namespace im Schlüssel (`region|realm|namespace|name`), sonst liefert ein Server die Ausrüstung
    eines gleichnamigen Charakters vom anderen Realm. Ohne Session kommt der Server einer Kategorie
    aus `serverWithoutSession` (`services/loot/lootServer.js`), der eines Reports aus `reportGuild`.
20. „Kategorie gelöscht" nur mit nachgewiesenem Server (#926, Prod 27.10.2026: Pulse Fresh fehlte in
    `discordServers.servers`, seine Kategorien galten als gelöscht, Abschließen löschte Daten). Nur
    `categoryGuild.categoryState()` → `missing` (Bot online, Server konfiguriert und im Cache) darf
    etwas als gelöscht zeigen oder abschließen lassen; fehlt der Nachweis → `unknown`, nie löschen.
    `config.categoryIds` gilt für alle Server — Einstellungen zeigen und speichern nur den Teil des
    aktiven Servers (`mergeServerCategoryIds`), nie die globale Liste je Server.
    Jede serverbezogene Änderung im PATCH (auch der categoryIds-Merge) nimmt den Server aus dem Tab (`serverSettingsGuildId`, geprüft per `serverSettingsTarget`), nie allein aus `activeGuildFor(req)`.
    Ein Server in `client.guilds.cache` beweist nicht, dass seine Kanäle bekannt sind: bei einem
    Discord-Ausfall bleibt er mit `available === false` und ohne Kanäle im Cache
    (`discord.isGuildAvailable()` prüfen). „In Discord gelöscht" gilt nur bei verfügbarem Server, der
    überhaupt Kategorien liefert, und belastbarem Besitzer (live oder Namens-Snapshot) — nie aus
    Roster-, Raid- oder Migrations-`guildId`s (die sind oft geraten und dienen nur der Anzeige).
    Gilt auch für Schließ-/Löschpfade einzelner Kanäle: „nicht im Cache" heißt erst nach
    `discord.isOnline()` und `isGuildAvailable(guildId)` „gelöscht" (Muster `tempVoiceJob.reachable`).
21. Zeitfenster bei externen Listen-APIs (#922): WCL v1 `reports/guild` filtert `start`/`end` nach der
    **Startzeit** eines Reports, nicht nach dem Upload — ein Raid von 20 Uhr, um 23:30 hochgeladen,
    liegt vor dem letzten Abruf. Nie „ab dem letzten Lauf" abfragen: großzügiges Rückblickfenster
    (`wclGuildSync`: 48 h vor dem letzten **erfolgreichen** Abruf, erster Abruf 14 Tage) plus Dedup
    (`logStore.getByReportId`); den Fensterbeginn (`lastSuccessAt`) nur bei Erfolg vorrücken, ein
    Fehlerlauf rückt nur die Fälligkeit (`lastRunAt`). Gilt für jede Listenabfrage mit Zeitfilter.
22. `client.channels.fetch` und `discord.channelVisible` arbeiten über Servergrenzen hinweg. Ein Post
    in einen Kanal aus den Einstellungen eines Servers geht über `postNotice`/`postPayload` mit
    `{ guildId }` (`assertChannelGuild`, Code `wrong_guild`) oder prüft `channel.guildId` selbst.
23. Rechte je Server (#925): Jede Route, die eine Datensatz-ID oder `?guildId=`/`body.guildId`
    annimmt, prüft, ob der Datensatz zum aktiven Server gehört (Voll-Admins ausgenommen). Muster:
    `cla.js` `onActiveServer`, `eventManage.ownEvent`. Fremder Datensatz → 404 `not_found`,
    fremdes Ziel → 403 `other_server` (`web/http/serverQuery.js` `mayUseServer`/`mayUseChannel`).
    Bot: `interaction.guildId` zählt, eine DM den Server des Datensatzes (`guildIdOf`), sonst nur
    Voll-Admins. Negativ-Test: Orga auf B öffnet nichts auf A. Eine `rosterId` immer über
    `activeRoster(req, rosterId)` holen, auch wenn `orgaScoped` über `{ categoryId }` prüft — ein
    Roster ohne Kategorie umgeht sonst die Server-Prüfung (#1034). Kategorie-Maps, die der Client je
    Kategorie voll schickt, der Store aber als Abweichung speichert, gehören in `STORED_FORM` (`settings.js`).
24. Kanal-IDs aus dem Body (#925): Jede Route, die `channelId`/`voiceChannelId`, eine Kategorie oder ein
    Quell-Event aus dem Request nimmt und darüber postet, klont oder anlegt, prüft jede davon per
    `mayUseChannel`/`mayUseServer` (Muster `eventCreateAccess.foreignChannelRefusal`). Der
    Kanal-Cache des Bots und `linkCheck` sind keine Server-Prüfung. Ein unbekannter Server zählt auf
    schreibenden Routen als fremd (fail closed, `eventServer.allOnServer`).
25. Bereinigungen je Server verschieben statt löschen (#925): Ein Eintrag, der aus dem Block eines
    Servers fliegt, weil er nachweislich einem anderen Server gehört, wandert in dessen Block — nur
    wenn der Zielblock ihn noch nicht hat (Ziel gewinnt), sonst nur aus dem falschen Block entfernen
    (Muster `foreignRoleCleanup.cleanForeignRoles`). Ohne Nachweis (Server offline, nirgends gefunden)
    bleibt alles, wie es ist.
26. Einmal-Migrationen mit Dateien (#945): Kopiert eine Migration neben JSON auch Dateien (Raumkarten,
    Bilder), leitet sie die Dateikopie bei **jedem** Lauf aus dem gespeicherten Zustand ab (Kopie mit
    `originId` da, Datei fehlt → nachkopieren), nicht aus dem, was der aktuelle Lauf angelegt hat. Die
    Altdaten gehen erst, wenn JSON und Dateien zurückgelesen vollständig sind; ein Dateifehler hält sie
    für den nächsten Start (Muster `raidplanTemplateStore.migrateToServers`).
27. Einstellungs-Abschnitte zwischen `/settings` und `/settings/all` verschieben (#957): vorher
    `section=<id>` (und die alten Ids aus `LEGACY_SECTIONS`) im ganzen `src/web-client/src` greppen und
    jeden Deep-Link mitziehen — auf `/settings/all` nur über `components/settings/AllSettingsLink`
    (Nicht-Voll-Admins bekommen den Hinweis statt eines Links ins „kein Zugriff“). Und prüfen, ob der
    Abschnitt Teile je Server enthält (z. B. Spielversion je Kategorie, Server-Schlüssel aus
    `SERVER_SCOPED_KEYS`): die bleiben auf der Server-Seite, sonst kann sie der Einstellungs-Schreiber
    nicht mehr ändern. Das Speichern schickt je Seite nur ihre Schlüssel (`save()` in `SettingsPage`).
28. Charakter-Abgleich über Server hinweg (Raid-ID-Hinweis): `characterKeyOf` kennt keinen Realm —
    gleicher Name auf einem anderen Server ist nur derselbe Charakter, wenn Realm und Region der
    Version dort gleich sind (`settingsForVersion(versionId, { guildId })`, #923). Raid-Resets sind
    nicht überall wöchentlich (Classic Era ZG/AQ20 3 Tage, Onyxia 5 Tage): Rhythmus je Instanz aus dem
    Regelsatz, nie pauschal `raidIdOf`.

## Fach-Agenten

- Aktiv: Plugin `eventhelper` von claude-crew — `event-expert`, `web-expert`, `discord-expert`,
  `logcheck-analyst` — und Plugin `addons` für das Sync-Addon (`eventhelper-addon`) —
  `wow-api-expert`, `ingame-tester`, `addon-release`. Fach-Agenten haben Vorrang vor
  `core:implementer`, der nur Aufgaben über mehrere Fachgebiete übernimmt.
