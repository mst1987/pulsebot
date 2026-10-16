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
  Migrationen laufen beim Start, `src/stores/settingsMigration.js`). Web-Admin: React + Vite + TS in
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
  ≤ 180 Zeilen/12 KB, `paths:`-Frontmatter der Regeln), `test/web/noCycles.test.js`, `test/web-client/conventions/` (Quelltext-Scans),
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
  Anniversary-Raids versetzt, `config/bosses.js` `baseEncounterId()`), Blizzard-API Namespace
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

1. Alles mit Spielinhalt liest die Version über `versionOfEvent` (`services/events/mainVersion.js`);
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
16. Login-Rücksprünge und interne Umleitungen: `server.js` dekodiert den pathname, daher kann jede
    Route, die aus dem Pfad weiterleitet (`legacyMount` `/admin`, `/admin2`), aus einem harmlosen
    Pfad `//host` machen. Jedes Umleitungsziel durch `safeReturnPath` schicken und Ketten
    (Rücksprung → zweite Umleitung) im Test prüfen.

## Fach-Agenten

- Aktiv: Plugin `eventhelper` von claude-crew — `event-expert`, `web-expert`, `discord-expert`,
  `logcheck-analyst` — und Plugin `addons` für das Sync-Addon (`eventhelper-addon`) —
  `wow-api-expert`, `ingame-tester`, `addon-release`. Fach-Agenten haben Vorrang vor
  `core:implementer`, der nur Aufgaben über mehrere Fachgebiete übernimmt.
