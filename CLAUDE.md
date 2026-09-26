# EventHelper Discord Bot

A Discord bot for managing community events. Built with Node.js and Discord.js v14. The bot handles:
- Raid signups and setup tracking via the Raidhelper API
- Overview dashboards with interactive buttons

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
npm run agents           # Overview of running agents per worktree: changes, test instance, what to test (--serve = self-refreshing page, --watch, --html, --json, --all)
node scripts/sync-app-emojis.js --dry-run  # App-Emojis (icons of the event message): list missing; without flag create them (the bot also does this on start)
node scripts/render-ui-emojis.js           # redraw the flat UI icons (assets/emojis/eh_ui_*.png, checked in)
```

## Development Workflow

`main` is the integration branch and always reflects the production-ready state. `main` and `dev` are kept in sync; new work does **not** branch off `dev`.

**⚠️ Worktree-only, no exceptions — every agent must follow this.** All code changes (by any agent, on any task, however small) happen inside a feature worktree, never as edits to the primary checkout's working tree. The primary checkout at `d:/programming/eventhelper` stays on `main` with a clean working tree at all times — no uncommitted edits, no ad-hoc commits there. If you find yourself about to `Edit`/`Write` a file while the cwd is the primary checkout, stop and create/switch to a worktree first (see step 2). This holds even for "just a quick fix."

**Four hooks in `.claude/settings.json` enforce this and the lint rule mechanically** (checked in, so every agent in every worktree gets them). The first three are one rule at three distances — an edit, a shell command, and the moment somebody walks away:
- `.claude/hooks/guardMainCheckout.js` (PreToolUse on Edit/Write/MultiEdit/NotebookEdit) refuses any edit whose target lies in the *main* worktree of this repository, in whichever directory the session runs. Linked worktrees, other repositories, files outside git and git-ignored files (`.env.dev`, `data/`) pass. A deliberate one-off override is `EVENTHELPER_ALLOW_MAIN_EDITS=1`.
- `.claude/hooks/guardMainShell.js` (PreToolUse on Bash/PowerShell, #315) does the same for a **shell write**: twice an empty file landed in the main checkout through a redirection the Edit guard never sees. It is a prefilter, not a shell parser — it reads `>` / `>>` targets, `Out-File`/`Set-Content`/`Add-Content`/`New-Item`/`Tee-Object`/`tee` and `[IO.File]::WriteAll*`, and refuses **only** when the resolved path lies in the main checkout and is not git-ignored. Everything it cannot read with certainty passes: quoted text, a heredoc's body, `[[ … ]]`/`(( … ))`, a target holding a variable or a glob, `/dev/null` and `2>&1`, and a *relative* target when the command moves itself (`cd`, `Set-Location`). A guard that cries wolf gets switched off, so silence beats a false alarm.
- `.claude/hooks/mainCheckoutClean.js` (Stop / SubagentStop, #315) runs `scripts/check-main-clean.js` when an agent is done and blocks the stop while the main checkout holds anything unexpected — one line per find. The same script is the by-hand check (`node scripts/check-main-clean.js`, exit 1 with the lines, silent when clean); it finds the main worktree through `git worktree list`, so it works from any worktree, and it excuses only `.env*`, `data/`, `nodemon` and `tbc-guild-simulator-backend@0.1.0`. It never loops (`stop_hook_active` ends it after one round).
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

```
src/
  bot.js                    # Entry point. Loads commands, handles interactionCreate
  commands/
    setup/                  # Event setup commands: signup, saveraid, showSignups,
                            #   showAllSetups, show-mysetups, createoverview, update-events
  classes/
    raidhelper.js           # Raw HTTPS client for raid-helper.xyz API
  config/
    classlist.js            # WoW class/spec lookup map (spec name -> icon/class/spec)
    messages.js             # Shared user-facing text strings
    variables.js            # Constants: Discord IDs, API URLs
  utils/
    helper.js               # Core utilities: botReply, botEditReply, formatters
    date.js                 # Date utilities using Luxon (CET timezone)
    responses.js            # Message formatters: setupResponse, mySetupResponse
    raidhelper.js           # Signup/setup query logic on top of classes/raidhelper.js
    httpAgent.js            # Shared https.Agent for Axios clients (SSL handling)
scripts/
  register-commands.js      # Preferred command registration script (supports --global, --clear)
```

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
| [docs/deployment.md](docs/deployment.md) | Wie ein Merge auf den Server kommt und woran man den laufenden Stand sieht |
| [docs/guide-discord.md](docs/guide-discord.md) | Endnutzer-Guide für Raider: alle Slash-Commands und Bot-Interaktionen im Discord |
| [docs/guide-web-admin.md](docs/guide-web-admin.md) | Endnutzer-Guide für die Orga: alle Bereiche des Web-Admin-Panels und was man dort tun kann |

## Environment Variables

All required variables must be in `.env` at the project root. See `.env.example` for the full list.

```
DISCORDJS_BOT_TOKEN=    # Bot token from Discord Developer Portal
CLIENT_ID=              # Discord Application ID
GUILD_ID=               # Discord server (guild) ID
NODE_ENV=               # Set to "production" to enable SSL cert verification
RAIDHELPER_API_KEY=     # API key for raid-helper.xyz
RAIDHELPER_SERVER_ID=   # Discord server ID on raid-helper.xyz
ADMIN_USER_ID=          # Discord user ID with bot admin access
```

Note: `bot.js` loads dotenv with `{ path: "../.env" }` (relative to `src/`). Always run scripts from the project root via `npm run ...`.

## Code Conventions

- **Module system:** CommonJS only (`require` / `module.exports`). No ES Modules.
- **Indentation:** 4 spaces.
- **Quotes:** Double quotes (enforced by ESLint).
- **Semicolons:** Always (enforced by ESLint).
- **Line endings:** Left to Git (`core.autocrlf`) and your editor — not enforced by ESLint. (The `linebreak-style: windows` rule was removed: git stores LF blobs, so a fixed `windows` rule broke the Linux CI.)
- **Language:** Bot texts a raider reads in Discord are **English** (dates as Discord timestamps, German service messages through `utils/botEnglish.js`); orga/admin texts in the bot stay German for now; the web gets its language from the client's i18n layer. Variable names, function names, comments in English. Details: [docs/signups.md](docs/signups.md), [docs/bot-commands.md](docs/bot-commands.md).
- **No TypeScript.** Plain JavaScript / CommonJS only.
- **Tests:** Jest. Every module has a matching test; every new feature ships with tests (see Testing).

## Testing

The project uses [Jest](https://jestjs.io/). Tests live next to the source tree under `test/`, mirroring `src/` (e.g. `src/utils/date.js` → `test/utils/date.test.js`).

- Run the full suite with `npm test`, watch mode with `npm run test:watch`, coverage with `npm run test:coverage`.
- Config is in `jest.config.js` (Node test environment, coverage collected from `src/**/*.js`).
- **Discord interactions and API clients are never hit for real.** Use the shared mock helpers in `test/helpers/` (`mockInteraction()` for a fake `interaction`, plus module mocks for the `classes/*` API clients). Mock external I/O with `jest.mock(...)` — no test may make a real network request.
- **A store a suite points somewhere else (`useFile`) gets its file from `test/helpers/tempStore.js`'s `tempStoreFile(name)`** — a scratch directory of its own, removed at the end of the suite (the helper registers that itself). Not `os.tmpdir()` plus `process.pid`: a pid is unique only while the process lives, `forceExit` in `jest.config.js` can skip an `afterAll`, and several runs share one machine (a worktree per feature). That pattern left 96 stale files in `%TEMP%` before #315.
- Prefer testing pure logic directly (formatters in `utils/helper.js`, date math in `utils/date.js`, the logcheck analyzers in `utils/logcheck/*`). For command files, assert on which helper (`botReply`/`botEditReply`) was called with which arguments.
- ESLint recognises Jest globals for files under `test/` via `eslint.config.mjs`.

## What NOT To Do

- Do not switch to ES Modules (`import`/`export`). The entire codebase is CommonJS.
- Do not add TypeScript.
- Do not add a feature or fix without tests, and do not merge with a failing `npm test`.
- Do not branch off `dev` — always branch off `main` and open PRs against `main` (see Development Workflow).
- Do not hardcode Discord IDs or API keys in command or utility files — use `config/variables.js` which reads from environment variables.
- Do not use `interaction.reply()` after already calling `interaction.deferReply()` — use `botEditReply` or `botFollowup` instead.
- Do not create slash commands without also adding them to `scripts/register-commands.js` and re-running `npm run register`.
- Do not move `.env` without also updating the `dotenv.config()` call in `bot.js` (`path: "../.env"`).
- Do not write new domain knowledge into this file — it is read in full in every session. It belongs in the matching `docs/*.md` (new file → add it to the index above).
