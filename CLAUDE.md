# EventHelper Discord Bot

Discord bot plus web admin (React SPA) for organising WoW raids, on Node.js and Discord.js v14: own events and
signups (Raid-Helper stays a second source), setup proposals, raid plans, loot council, log checks of Warcraft
Logs reports.

This file is loaded in every session and every subagent, so it holds only what every task needs. Rules bound to
files live in `.claude/rules/` (they load when a matching file is read), domain knowledge in `docs/` (index below).

## Commands

```bash
npm start / npm run dev  # bot + web (dev = nodemon)
npm test                 # Jest; test:watch, test:coverage
npm run lint             # ESLint; lint:fix
npm run register         # register slash commands to the guild
npm run agents           # running agent worktrees: changes, test instance, what to test
npm run check:main       # main checkout clean? (silent + exit 0 when it is)
```

All other scripts with their npm alias: [scripts/README.md](scripts/README.md).

## Development Workflow

`main` is the integration branch and always production-ready (`dev` is only kept in sync — never branch off it).

**⚠️ Worktree-only, no exceptions.** Every change, however small, happens in a feature worktree. The primary
checkout `d:/programming/eventhelper` stays on `main` with a clean tree — no edits, no commits there; its local
`main` is only ever fast-forwarded. Hooks enforce this (Edit/Write guard, shell-write guard, Stop hook running
`npm run check:main`, ESLint after every edit; see `.claude/rules/claude-hooks.md`).

1. **Start from current `main`:** `git fetch origin`, then
   `git worktree add -b feature/<name> ../eventhelper-<name> origin/main`; work in `../eventhelper-<name>/`.
   Branch names never contain “token” or “secret”.
2. **Tests with every change** (see Testing); `npm test` and `npm run lint` green before the PR.
3. **Local test instance on its own port** (below); hand the reviewer the URL.
4. **Keep the branch current while working:** `git fetch origin && git merge origin/main`, resolve conflicts
   locally, re-run tests + lint — again right before opening or updating the PR. Never leave a PR conflicting.
5. **Open the PR against `main` proactively** when the feature is done; the body says what changed and how it
   was verified (with the test URL/port). Merge only via PR — **a merge deploys** (docs/deployment.md).
6. **Watch the PR until it merges** (every ~5 min, `gh pr view <nr> --json state,mergedAt`), then stop the test
   instance and remove the worktree. The task is not done before both are gone.

Do not merge a branch that lowers the coverage of the modules it touches.

### Local test instances

One instance per worktree, `WEB_PORT` counting up from `3010` (never the default `3005`): copy `.env.dev` from
the main checkout, append `WEB_PORT=<port>` and `DEV_AUTO_LOGIN=1`, build the client once
(`cd src/web-client && npm install && npm run build`), then `npm start`; the menu is at
`http://localhost:<port>/`. Details: [docs/worktrees.md](docs/worktrees.md).

### Cleanup after merges

Stop the instance first (ports 3010–3020), then `git worktree remove ../eventhelper-<name>` **one at a time,
without `--force`**, checking `git worktree list` after each. On “not a git repository” STOP. The main worktree
is never removed; back up its `.env`/`.env.dev` (local only, not on origin) before anything that could touch
it. Routine and sweep: [docs/worktrees.md](docs/worktrees.md).

## Agent team (claude-crew)

Subagents from the **claude-crew** marketplace (`mst1987/claude-crew`, locally `D:\programming\claude-crew`).
The **main session conducts**: cuts the task, picks the agent, checks the result, alone talks to the user.

- `core:scout` (several/unclear tasks), `core:wow-researcher` (before game data goes into code or texts),
  `core:implementer` (several domains), `core:reviewer` (after logic changes), `core:pr-agent` (PR series;
  single PRs: main session), `core:ui-tester` (visible web changes), `core:designer` (design proposals as
  canvas), `core:live-diagnostics` (production, read-only).
- Domain: `eventhelper:event-expert` (events, signups, setup, roster planner, game versions),
  `eventhelper:web-expert` (web client, API rights, raid plan, loot views), `eventhelper:discord-expert`,
  `eventhelper:logcheck-analyst`, `addons:wow-api-expert` / `addons:ingame-tester` (sync addon).
- No `model` parameter (set in each agent's frontmatter). Chain by size: small tasks the main session does
  itself. “Which agents are there?” means this list; `npm run agents` is the worktree overview.
- Agents cannot ask the user — open points come back in their report.
- Project values for agents live in `.claude/skills/projektprofil/SKILL.md` (preloaded); change them there.

## Architecture

A rough map (`ls` is always current):
- `src/bot.js` entry (web server first, then bot login best-effort) · `src/logger.js` the one logger ·
  `src/commands/<area>/` one module per command · `src/classes/` external API clients · `src/config/` env,
  constants, `gameVersions/`, generated data (never by hand).
- `src/utils/<area>/` domain logic without HTTP · `src/services/<area>/` logic shared by commands, utils and
  web · `src/stores/` JSON stores on `jsonStore.js` · `data/` runtime data, git-ignored, server only.
- `src/web/` HTTP only (`http/`, `apiRoutes/`, `report/`, `pages/`); `commands/` and `utils/` never require
  from it (`test/docs/layering.test.js`) · `src/web-client/` React SPA · `scripts/` generators, registration,
  dev seed · `assets/` checked-in images · `test/` Jest, mirrors `src/`.

## Weiterführende Dokumentation (`docs/`)

Bereichswissen steht in `docs/` — die passende Datei öffnen, Neues dorthin schreiben (neue Datei → Zeile hier).
`test/docs/claudeMd.test.js` hält Index, Pfade und die Größengrenze dieser Datei zusammen.

| Datei | Wofür |
|---|---|
| [docs/bot-commands.md](docs/bot-commands.md) | Befehlssystem, Befehlsrechte, Core Utilities, API-Clients, Patterns |
| [docs/web-admin.md](docs/web-admin.md) | React-SPA und `/api`-Routen: Aufbau, Stores, Styles, i18n, Bausteine |
| [docs/permissions.md](docs/permissions.md) | Bereiche und Level, Basiszugang, Einzelkonten, `apiAccess.js` |
| [docs/discord-servers.md](docs/discord-servers.md) | Event- und Talk-Server, Pings, Erinnerungen, Rollen-Abgleich |
| [docs/events.md](docs/events.md) | Eigene Events: Store, Anlegen, Raid-Cockpit, Serien, öffentliche Seite |
| [docs/signups.md](docs/signups.md) | Anmeldung in Web und Bot, Warteliste, Anmelder-Nachricht, App-Emojis |
| [docs/setup.md](docs/setup.md) | Setup-Vorschlag, Setup-Editor, Setup im Kanal (Nachricht + DMs) |
| [docs/raidplan.md](docs/raidplan.md) | Raidplan: Boards je Boss, Taktik-Profile, Karten, Freigabe `/p/<token>` |
| [docs/raid-templates.md](docs/raid-templates.md) | Regelsätze der Spielversionen (Klassen, Instanzen, Buffs), Raid-Vorlagen |
| [docs/game-versions.md](docs/game-versions.md) | Versionsmodell, strenge Trennung, Runbook „Neue Version starten“ |
| [docs/channels.md](docs/channels.md) | Kanäle-Seite, Namensregeln, Archiv, Schnellanlage |
| [docs/roster-profile.md](docs/roster-profile.md) | Roster-Bereich und das Raider-Profil („Mein Profil“) |
| [docs/kaderplaner.md](docs/kaderplaner.md) | Kaderplaner (WoW Forever): Kader-Status, Gespräche, Stimmen, Datenschutz |
| [docs/loot-council.md](docs/loot-council.md) | Loot-Council: Bedarf, Gear-Quellen, BiS-Listen, Simulation |
| [docs/logcheck.md](docs/logcheck.md) | Kampfverlauf, Analyzer, Empfehlungen, Report-Seiten, Raid-Wächter |
| [docs/loot-import.md](docs/loot-import.md) | Loot-Import (Gargul/RCLC), Addon-Sync und Inbox, Vergabegrund |
| [docs/addons.md](docs/addons.md) | Addon-Downloads über GitHub-Releases: Token, Cache, Rechte, `/addons` |
| [docs/dungeon-leaderboard.md](docs/dungeon-leaderboard.md) | Dungeon-Bestzeiten aus LevelHelper: Upload, Seite, `/bestzeiten` |
| [docs/raidhelper-retirement.md](docs/raidhelper-retirement.md) | Umstieg von Raid-Helper: Standardquelle, Checkliste, Schalter |
| [docs/known-issues.md](docs/known-issues.md) | Bekannte Fallstricke, die schon einmal Zeit gekostet haben |
| [docs/testing.md](docs/testing.md) | Test-Helfer, Fabriken, `test/setup/`, Mock-Konvention, Coverage |
| [docs/worktrees.md](docs/worktrees.md) | Worktree-Testinstanzen (Ports, `.env.dev`) und sicheres Aufräumen |
| [docs/deployment.md](docs/deployment.md) | Wie ein Merge auf den Server kommt, laufender Stand, Deploy-Pause |
| [docs/system-status.md](docs/system-status.md) | Systemstatus-Seite (Voll-Admins): Monitor, Last, Datenträger |
| [docs/backup.md](docs/backup.md) | Datensicherung mit restic nach R2, Einrichtung, Wiederherstellen |
| [docs/data-storage.md](docs/data-storage.md) | Alle Dateien unter `data/`: Eigentümer, Inhalt, sensibel, Sicherung |
| [docs/guide-discord.md](docs/guide-discord.md) | Endnutzer-Guide für Raider: Slash-Commands und Bot-Interaktionen |
| [docs/guide-web-admin.md](docs/guide-web-admin.md) | Endnutzer-Guide für die Orga: alle Bereiche des Web-Admin-Panels |

## Code Conventions

- CommonJS only (`require`/`module.exports`), no TypeScript in the bot (the web client is TS); 4 spaces, double
  quotes, semicolons (ESLint, `eslint.config.mjs`), LF (`.gitattributes`).
- **Language:** identifiers and comments in English. Bot texts a raider reads go through `tr(lang, "…")`
  (German by default); orga/admin texts in the bot stay German; the web client always in `de` and `en`.
  Details: `.claude/rules/discord.md`, docs/bot-commands.md.
- Commits in German: `Bereich: Beschreibung`.

## Testing

Jest under `test/`, mirroring `src/` one to one; every backend module is loaded by at least one test
(`test/docs/testMirror.test.js`). No test hits the network, Discord or an API client for real (enforced by
`test/setup/noNetwork.js`); stores in tests via `tempStoreFile()` or `memoryFs`, never `os.tmpdir()`. The React
client has its own Vitest suite (`cd src/web-client && npm test`). Placement and mocks:
`.claude/rules/tests.md`, docs/testing.md.

## What NOT To Do

- No feature or fix without tests; no merge with a failing `npm test`.
- No hardcoded Discord IDs or API keys in commands or utils — read them through `src/config/` or the settings
  store.
- No new domain knowledge in this file — it goes into the matching `docs/*.md`, file-bound rules into
  `.claude/rules/`.
