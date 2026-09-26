# EventHelper Discord Bot

A Discord bot plus web admin for organising WoW raids, built with Node.js and Discord.js v14: own events and
signups (Raid-Helper stays a supported second source), setup proposals, raid plans, loot council, log checks of
Warcraft Logs reports, and the web admin (a React SPA) the orga works in.

## Commands

```bash
npm start              # Run production bot
npm run dev            # Run with auto-reload (nodemon)
npm test               # Run the Jest test suite
npm run test:watch     # Run Jest in watch mode
npm run test:coverage  # Run Jest with a coverage report
npm run lint           # Check code style
npm run lint:fix       # Auto-fix lint issues
npm run register       # Register slash commands to guild (instant)
npm run register:global  # Register globally (takes ~1 hour)
npm run register:clear   # Remove all guild slash commands
npm run agents           # Overview of running agents per worktree: changes, test instance, what to test (--serve, --watch, --html, --json, --all)
npm run check:main       # Is the main checkout clean? (silent + exit 0 when it is)
```

Every other script (emojis, generated data, dev seed, …) with its npm alias: [scripts/README.md](scripts/README.md).

## Development Workflow

`main` is the integration branch and always reflects the production-ready state. `main` and `dev` are kept in sync; new work does **not** branch off `dev`.

**⚠️ Worktree-only, no exceptions — every agent must follow this.** All code changes (by any agent, on any task, however small) happen inside a feature worktree, never as edits to the primary checkout's working tree. The primary checkout at `d:/programming/eventhelper` stays on `main` with a clean working tree at all times — no uncommitted edits, no ad-hoc commits there. If you find yourself about to `Edit`/`Write` a file while the cwd is the primary checkout, stop and create/switch to a worktree first (see step 2). This holds even for "just a quick fix."

**Four hooks in `.claude/settings.json` enforce this and the lint rule mechanically** (checked in, so every agent in every worktree gets them). The first three are one rule at three distances — an edit, a shell command, and the moment somebody walks away:
- `.claude/hooks/guardMainCheckout.js` (PreToolUse on Edit/Write/MultiEdit/NotebookEdit) refuses any edit whose target lies in the *main* worktree of this repository, in whichever directory the session runs. Linked worktrees, other repositories, files outside git and git-ignored files (`.env.dev`, `data/`) pass. A deliberate one-off override is `EVENTHELPER_ALLOW_MAIN_EDITS=1`.
- `.claude/hooks/guardMainShell.js` (PreToolUse on Bash/PowerShell, #315) does the same for a **shell write**: twice an empty file landed in the main checkout through a redirection the Edit guard never sees. It is a prefilter, not a shell parser: it refuses **only** a redirection or write cmdlet whose resolved target lies in the main checkout and is not git-ignored, and lets everything it cannot read with certainty pass (what it reads: the hook's head comment) — silence beats a false alarm.
- `.claude/hooks/mainCheckoutClean.js` (Stop / SubagentStop, #315) runs `scripts/check-main-clean.js` when an agent is done and blocks the stop while the main checkout holds anything unexpected — one line per find. The same script is the by-hand check (`node scripts/check-main-clean.js`, exit 1 with the lines, silent when clean); it finds the main worktree through `git worktree list`, so it works from any worktree; git-ignored files (`.env*`, `data/`, `coverage/`) never count, and there is no list of excused names. It never loops (`stop_hook_active` ends it after one round).
- `.claude/hooks/lintChanged.js` (PostToolUse on Edit/Write/MultiEdit) runs ESLint on the file just written (`src/`, `test/`, the hooks, and `src/web-client/` with its own config) and feeds the problems straight back, so style errors are fixed at the edit, not at the PR. No ESLint installed yet (fresh worktree) means it stays silent.
All are plain Node scripts with tests under `test/claude-hooks/`; `npm run lint` covers `src/`, `scripts/` and the hooks (#320 — the one exception is the quote rule in `scripts/render-ui-emojis.js`, whose SVG constants are single-quoted on purpose; see the comment in `eslint.config.mjs`).

0. **Sync `main` first — always, before touching anything.** Every unit of work starts by fetching and fast-forwarding `main` so the branch is cut from the current production state: `git fetch origin && git checkout main && git pull --ff-only origin main`. Never start editing on a stale `main` or a branch whose base has moved on.
1. **Branch off `main`** for every new feature or fix: `git switch main && git pull && git switch -c feature/<name>`.
2. **Use a git worktree** so the feature is developed in its own directory without disturbing the main checkout:
   ```bash
   git worktree add ../eventhelper-<name> -b feature/<name> main
   ```
   Work happens in `../eventhelper-<name>/`; the primary checkout stays on `main`.
3. **Write and run tests** for the change (`npm test` must pass) and keep `npm run lint` clean before opening a PR.
4. **Spin up a local test instance on its own port** so the change can be verified live, isolated from every other running instance (see “Local test instances” below). Every agent-made change must be runnable this way, and the agent hands the reviewer the local URL to click.
5. **Keep the worktree's branch current with `main` regularly while working, not just before the PR** — `main` moves as other features merge, and a long-lived worktree drifts. Periodically run `git fetch origin && git merge origin/main` (or rebase) inside the worktree, resolve any conflicts **locally**, and re-run `npm test` + `npm run lint` on the merged result. Do this again right before opening or updating the PR. A PR must never be opened or left in a conflicting state.
6. **Open a PR targeting `main` as soon as the feature is finished — proactively, without waiting to be asked.** Summarize what changed and how it was verified in the PR body (including the local test URL/port used). Merge to `main` only via PR. Opening the PR is not optional and is not the end of the task — it is not "done" until the PR is merged and step 7 has run.
7. **Watch the PR until it merges, then immediately clean up everything belonging to that unit of work** — this is the last step of every task, not a separate chore for later. Poll the PR's merge status periodically (every ~5 minutes is a reasonable cadence for a background check; e.g. `gh pr view <number> --json state,mergedAt`) until it shows merged. The moment it merges: **stop the local test instance first**, then **remove the worktree** (see “Cleanup after merges” below). Only report the task fully finished once both are gone — a merged PR with its worktree/instance still lying around is an unfinished task, not a finished one.

Every change must ship with tests (see the Testing section). Do not merge a feature branch that lowers coverage of the modules it touches.

### Cleanup after merges (do this after every merge, and sweep regularly)

Once a PR is merged, its worktree and its running test instance are dead weight — clean them up promptly, and **periodically sweep** for leftovers (e.g. at the start of a session, or whenever asked to “clean up test instances”). Stray instances hold ports and RAM; orphaned worktrees clutter the tree.

**The routine:**
1. **Find merged worktrees:** cross-reference `git worktree list` with `git branch --merged origin/main` (run `git fetch origin` first). Any worktree whose branch is merged can go.
2. **Stop its test instance first.** Find the dev instances and stop them before touching their worktree:
   ```powershell
   # ports 3010+ are per-worktree dev instances (3005 is the default)
   Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -ge 3010 -and $_.LocalPort -le 3020 } | Select LocalPort, OwningProcess
   Stop-Process -Id <pid> -Force
   ```
3. **Remove the worktree — one at a time, verifying between each:**
   ```bash
   git worktree remove ../eventhelper-<name>   # do NOT reach for --force by default
   git worktree list                            # confirm the main checkout is still listed
   ```

**⚠️ Safety rules — a botched sweep once wiped the main checkout (`.git` + local env). Never again:**
- **Remove worktrees one by one, not in a blind `--force` loop.** After each removal, re-run `git worktree list` (or `git -C <main> rev-parse --git-dir`). If any git command suddenly reports **“not a git repository”**, STOP immediately — do not continue removing.
- **The main worktree `d:/programming/eventhelper` is sacred and must never be removed.** It holds the real `.git` (objects/refs) that every linked worktree depends on; losing it detaches them all.
- **`.env` / `.env.dev` are git-ignored and live ONLY on local disk — never on origin.** The main checkout’s env cannot be recovered from GitHub. Before any operation that could touch the main checkout (re-clone, delete, move), **back up its `.env` and `.env.dev` first**. A worktree’s `.env.dev` is a copy of the main’s and can serve as a fallback source.
- Prefer plain `git worktree remove` (which refuses on a dirty/uncommitted tree — a useful guardrail). Only use `--force` on a specific worktree you have confirmed is safe to discard.

### Local test instances (one port per change)

Every feature worktree runs its **own** bot/web instance on a **new, unused port**, so several changes can be reviewed side by side without clobbering each other. Never reuse the default port (`3005`) for a feature branch — pick a fresh one and keep it stable for that worktree.

The web server boots **independently of the Discord gateway** (`src/bot.js` `start()`): it comes up first, then the bot logs in best-effort. A missing/invalid token or an offline Discord only disables the Discord-backed features (guild/channel/role lists, posting) — the admin menu and report pages stay reachable. So a local instance is useful even without a working token.

- **Each worktree needs its own env file.** `.env` / `.env.dev` are git-ignored and are **not** copied into new worktrees, so `npm start` in a fresh worktree finds no config. Copy the dev env in and give it a unique port:
  ```bash
  cp ../eventhelper/.env.dev .env.dev        # from the main checkout
  printf '\nWEB_PORT=3010\nDEV_AUTO_LOGIN=1\n' >> .env.dev
  ```
  `.env.dev` points at a **separate dev Discord application**, so running it never clashes with the production bot. `bot.js` prefers `.env.dev` over `.env` automatically.
- **Port convention:** allocate a distinct `WEB_PORT` per worktree, counting up from `3010` (`3010`, `3011`, `3012`, …). Record the chosen port in the PR body so the reviewer knows where to look. If a port is already taken, take the next free one.
- **Start it** from the worktree root — with `.env.dev` in place, just:
  ```bash
  npm start          # reads WEB_PORT + DEV_AUTO_LOGIN from .env.dev
  ```
  or override inline (bash: `WEB_PORT=3010 DEV_AUTO_LOGIN=1 NODE_ENV=development npm start`; PowerShell: `$env:WEB_PORT=3010; $env:DEV_AUTO_LOGIN=1; npm start`). The menu is then at `http://localhost:3010/` — the site root. `DEV_AUTO_LOGIN=1` auto-logs-in the first admin and is hard-gated to non-production (`src/config/variables.js`), so it can never weaken auth on the live bot.
- **The menu needs the React client built first.** Everything outside `/api`, `/auth`, `/health` and the `/r/` report pages is served from `src/web-client/dist/` (see "Web Admin" in docs/web-admin.md) — run `cd src/web-client && npm install && npm run build` once per fresh worktree before starting the backend, or run `npm run dev` inside `src/web-client/` (its own Vite dev server, proxying `/api` to the backend port) for live-reloading frontend work. A missing/stale `dist/` means the menu 404s outright — there is no server-rendered fallback anymore.
- **After the change:** report the port/URL you used to verify it, and stop the instance when done (it is only for review, never left running in production).

## Architecture

A rough map without file lists (`ls` is always current); each row names the doc that explains it.

| Where | What lives there | Read |
|---|---|---|
| `src/bot.js` | Entry: env, web server first, then the bot login (best-effort) and interaction routing | docs/bot-commands.md |
| `src/logger.js` | The one logger (`LOG_LEVEL`) | its head comment |
| `src/commands/<area>/` | One module per command or component; `loader.js` collects them for bot and `npm run register` | docs/bot-commands.md |
| `src/classes/` | External API clients (Raid-Helper, Warcraft Logs, Blizzard, Google) | docs/bot-commands.md |
| `src/config/` | Env, defaults, constants, generated data (never by hand), `gameVersions/`, permissions | docs/raid-templates.md |
| `src/utils/` | Domain logic without HTTP; `logcheck/`, `setup/`, `wowsims/` | docs/logcheck.md, docs/setup.md |
| `src/web/` | HTTP server, `apiRoutes/`, stores (`*Store.js`), report rendering, Discord side of web features | docs/web-admin.md |
| `src/web-client/` | Web admin SPA: React + Vite + TypeScript, built to `dist/` | docs/web-admin.md |
| `scripts/` | Registration, generators (`data-sources/` = their input), dev seed, agent overview | scripts/README.md |
| `assets/` | Checked-in images (app emojis) | docs/signups.md |
| `data/` | Runtime data, git-ignored, only on the server (`EVENTHELPER_DATA_DIR`) | docs/data-storage.md |
| `test/` | Jest, mirrors `src/`; `helpers/`, `setup/` (network guard), `docs/` (doc guard) | "Testing" below |

## Weiterführende Dokumentation (`docs/`)

Dieses Dokument ist der Einstieg und bleibt kurz: hier steht nur, was *jeder* Agent bei *jeder* Aufgabe braucht. Alles Bereichswissen steht in `docs/` — öffne die Datei, die zu deiner Aufgabe gehört, und schreib Neues auch dorthin, nicht hierher. `test/docs/claudeMd.test.js` hält Index und Dateien zusammen und CLAUDE.md unter der Größengrenze.

| Datei | Wofür |
|---|---|
| [docs/bot-commands.md](docs/bot-commands.md) | Wie das Befehlssystem funktioniert, wer welchen Befehl ausführen darf, Core Utilities, API-Clients, Common Patterns — für jede Änderung an `src/commands/` |
| [docs/web-admin.md](docs/web-admin.md) | Aufbau der React-SPA und der `/api`-Routen, Routing ab Site-Root, Seitenaufbau mit vielen Abschnitten, Sammlungen bearbeiten, welcher Stand läuft |
| [docs/permissions.md](docs/permissions.md) | Bereiche und Level (`read`/`write`), Basiszugang, Einzelkonten, wo Zugriff erzwungen wird (`apiAccess.js`) |
| [docs/discord-servers.md](docs/discord-servers.md) | Event- und Talk-Server, Pings, Erinnerungen, Rollen-Abgleich, Raid-Übersicht auf dem Talk-Server |
| [docs/events.md](docs/events.md) | Eigene Events: Store und Adapter, Anlegen im Web, das Raid-Cockpit der Detailseite, Event verwalten, Serien, Discord-Event, Kalender-Link und öffentliche Event-Seite |
| [docs/signups.md](docs/signups.md) | Anmeldung im Web und im Bot, mehrere Raids auf einmal, Anmelder-Nachricht, Warteliste und Ankündigung, App-Emojis |
| [docs/setup.md](docs/setup.md) | Setup-Vorschlag, Setup-Editor und das Setup im Kanal (Nachricht + DMs) |
| [docs/raidplan.md](docs/raidplan.md) | Raidplan: ein Board je Boss (Karte, Spieler-Tokens, Aufgabenzeilen), Taktik-Profile, Karten-Upload, Freigabe und die öffentliche Lese-Ansicht `/p/<token>` |
| [docs/raid-templates.md](docs/raid-templates.md) | Spielversionen und Instanzen (`src/config/gameVersions/`) sowie Raid-Vorlagen |
| [docs/channels.md](docs/channels.md) | Kanäle-Seite, Namensregeln und -ableitung, Archiv, Schnellanlage |
| [docs/roster-profile.md](docs/roster-profile.md) | Roster-Bereich und das Raider-Profil („Mein Profil“) |
| [docs/loot-council.md](docs/loot-council.md) | Loot-Council: Bedarf, Gear-Quellen, BiS-Listen, Simulation, Seitenaufbau |
| [docs/logcheck.md](docs/logcheck.md) | Kampfverlauf, Analyzer, Empfehlungen, die Report-Seiten und der Wächter gegen unfertige Raids |
| [docs/loot-import.md](docs/loot-import.md) | Loot-Import (Gargul/RCLootcouncil), Addon-Sync und Inbox, Vergabegrund und Raid-Inhalt |
| [docs/raidhelper-retirement.md](docs/raidhelper-retirement.md) | Umstieg von Raid-Helper: Standardquelle, Checkliste, Schalter, Spec-Historie |
| [docs/known-issues.md](docs/known-issues.md) | Bekannte Fallstricke, die schon einmal Zeit gekostet haben |
| [docs/testing.md](docs/testing.md) | Test-Helfer und Fabriken (`test/helpers/`, `test/factories/`), was `test/setup/` jeder Suite mitgibt, Mock-Konvention und Coverage-Schwellen |
| [docs/deployment.md](docs/deployment.md) | Wie ein Merge auf den Server kommt und woran man den laufenden Stand sieht |
| [docs/data-storage.md](docs/data-storage.md) | Alle Dateien unter `data/`: Eigentümer-Modul, Inhalt, sensibel ja/nein, Sichern und Wiederherstellen |
| [docs/guide-discord.md](docs/guide-discord.md) | Endnutzer-Guide für Raider: alle Slash-Commands und Bot-Interaktionen im Discord |
| [docs/guide-web-admin.md](docs/guide-web-admin.md) | Endnutzer-Guide für die Orga: alle Bereiche des Web-Admin-Panels und was man dort tun kann |

## Environment Variables

`src/bot.js` loads `.env.dev` from the project root when it exists, otherwise `.env` (both git-ignored). Scripts
read the env file relative to the working directory, so run them from the project root. Only these are needed to
run at all; everything else (Google, Warcraft Logs, Blizzard, OAuth, …) is optional and listed with its purpose
in `.env.example`. Most server settings (servers, channels, roles, rights) live in the web settings, not here.

```
DISCORDJS_BOT_TOKEN=    # Bot token (without it only the web server runs)
CLIENT_ID=              # Discord application id
ADMIN_USER_ID=          # Bootstrap admin who can always log in and configure the rest
DISCORD_CLIENT_SECRET=  # "Login with Discord" on the web (not needed with DEV_AUTO_LOGIN=1 locally)
NODE_ENV=production     # On the server: TLS verification on, dev shortcuts off
```

## Code Conventions

- **Module system:** CommonJS only (`require` / `module.exports`), never ES Modules.
- **Indentation:** 4 spaces.
- **Quotes:** Double quotes (enforced by ESLint).
- **Semicolons:** Always (enforced by ESLint).
- **Line endings:** Left to Git (`core.autocrlf`) and your editor — not enforced by ESLint (a fixed rule broke the Linux CI).
- **Language:** Bot texts a raider reads in Discord are **English** (dates as Discord timestamps, German service messages through `utils/botEnglish.js`); orga/admin texts in the bot stay German for now; the web gets its language from the client's i18n layer. Variable names, function names, comments in English. Details: docs/signups.md, docs/bot-commands.md.
- **No TypeScript** in the bot (the web client in `src/web-client/` is TypeScript).

## Testing

The project uses [Jest](https://jestjs.io/). Tests live next to the source tree under `test/`, mirroring `src/` (e.g. `src/utils/date.js` → `test/utils/date.test.js`).

- Run the full suite with `npm test`, watch mode with `npm run test:watch`, coverage with `npm run test:coverage`.
- Config is in `jest.config.js` (Node test environment, coverage collected from `src/**/*.js`).
- **Discord interactions and API clients are never hit for real.** Use the shared mock helpers in `test/helpers/` (`mockInteraction()` for a fake `interaction`, plus module mocks for the `classes/*` API clients). Mock external I/O with `jest.mock(...)` — no test may make a real network request; `test/setup/noNetwork.js` (`setupFiles`) enforces it: unmocked axios, `http(s).request/get` and `fetch` throw and fail the test, even when the code swallows the error (loopback stays open). `coverageThreshold` in `jest.config.js` sits about a point under the measured coverage, so `npm run test:coverage` fails when it sinks; console output is shown only for failing tests.
- **A store a suite points somewhere else (`useFile`) gets its file from `test/helpers/tempStore.js`'s `tempStoreFile(name)`** — a scratch directory of its own, removed at the end of the suite. Not `os.tmpdir()` plus `process.pid`: that left 96 stale files in `%TEMP%` before #315 (pids repeat, `forceExit` can skip an `afterAll`). Every store on `src/web/jsonStore.js` has `useFile(path|null)`; a suite that wants no disk at all mocks `fs` with `test/helpers/memoryFs.js` (see "Stores" in docs/web-admin.md).
- Prefer testing pure logic directly (formatters in `utils/helper.js`, date math in `utils/date.js`, the logcheck analyzers in `utils/logcheck/*`). For command files, assert on which helper (`botReply`/`botEditReply`) was called with which arguments.
- ESLint recognises Jest globals for files under `test/` via `eslint.config.mjs`.

## What NOT To Do

- Do not add a feature or fix without tests, and do not merge with a failing `npm test`.
- Do not branch off `dev` — always branch off `main` and open PRs against `main` (see Development Workflow).
- Do not hardcode Discord IDs or API keys in command or utility files — read them through `src/config/` (env) or the settings store.
- Do not use `interaction.reply()` after already calling `interaction.deferReply()` — use `botEditReply` or `botFollowup` instead.
- Do not create slash commands without a `data` definition in the command module (`scripts/register-commands.js` collects it) and re-running `npm run register`.
- Do not move `.env` / `.env.dev` out of the project root without also updating the `dotenv.config()` call in `src/bot.js`.
- Do not write new domain knowledge into this file — it is read in full in every session. It belongs in the matching `docs/*.md` (new file → add it to the index above).
