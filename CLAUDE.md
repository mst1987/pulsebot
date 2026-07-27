# EventHelper Discord Bot

A Discord bot for managing community events. Built with Node.js and Discord.js v14. The bot handles:
- Legendary item auctions (bidding, tracking, winner announcement)
- GDKP raid signups and setup tracking via the Raidhelper API
- Gold-spending history per player
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
node src/discordcommands/raidhelper.js  # Legacy command registration script
```

## Development Workflow

`main` is the integration branch and always reflects the production-ready state. `main` and `dev` are kept in sync; new work does **not** branch off `dev`.

**⚠️ Worktree-only, no exceptions — every agent must follow this.** All code changes (by any agent, on any task, however small) happen inside a feature worktree, never as edits to the primary checkout's working tree. The primary checkout at `d:/programming/eventhelper` stays on `main` with a clean working tree at all times — no uncommitted edits, no ad-hoc commits there. If you find yourself about to `Edit`/`Write` a file while the cwd is the primary checkout, stop and create/switch to a worktree first (see step 2). This holds even for "just a quick fix."

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
  or override inline (bash: `WEB_PORT=3010 DEV_AUTO_LOGIN=1 NODE_ENV=development npm start`; PowerShell: `$env:WEB_PORT=3010; $env:DEV_AUTO_LOGIN=1; npm start`). The admin menu is then at `http://localhost:3010/` (redirects to `/admin`). `DEV_AUTO_LOGIN=1` auto-logs-in the first admin and is hard-gated to non-production (`src/config/variables.js`), so it can never weaken auth on the live bot.
- **The admin menu needs the React client built first.** `/admin` is served entirely from `src/web-client/dist/` (see "Web Admin" below) — run `cd src/web-client && npm install && npm run build` once per fresh worktree before starting the backend, or run `npm run dev` inside `src/web-client/` (its own Vite dev server, proxying `/api` to the backend port) for live-reloading frontend work. A missing/stale `dist/` means `/admin` 404s outright — there is no server-rendered fallback anymore.
- **After the change:** report the port/URL you used to verify it, and stop the instance when done (it is only for review, never left running in production).

## Architecture

```
src/
  bot.js                    # Entry point. Loads commands, handles interactionCreate
  commands/
    auction/                # Auction commands: createAuction, bid, bid-5k, bid-10k,
                            #   bidCustom, auctionStatus, deleteAuction, endAuction, updateAuction
    gdkp/                   # GDKP spend commands: currentspent, lastspent, totalspent
    setup/                  # Event setup commands: signup, saveraid, showSignups,
                            #   showAllSetups, show-mysetups, createoverview, update-events
  classes/
    raidhelper.js           # Raw HTTPS client for raid-helper.xyz API
    gdkp.js                 # Axios client for pulse-gdkp.de GDKP data
    legendary.js            # Axios client for pulse-gdkp.de legendary auction data
  config/
    classlist.js            # WoW class/spec lookup map (spec name -> icon/class/spec)
    messages.js             # All user-facing text strings (German)
    variables.js            # Constants: Discord IDs, API URLs, auction limits
  utils/
    helper.js               # Core utilities: botReply, checkForPermission, formatters
    auction.js              # Auction UI helpers: modals, buttons, bidForLegendary()
    date.js                 # Date utilities using Luxon (CET timezone)
    responses.js            # Message formatters: setupResponse, getAuctionMessage, etc.
    raidhelper.js           # Signup/setup query logic on top of classes/raidhelper.js
    legendary.js            # getTargetMessage(), updateHighestBids()
    httpAgent.js            # Shared https.Agent for Axios clients (SSL handling)
  discordcommands/
    raidhelper.js           # Legacy one-off script to register slash commands
scripts/
  register-commands.js      # Preferred command registration script (supports --global, --clear)
```

## How the Command System Works

`bot.js` uses `client.on("ready")` to call `loadCommands("./commands")`, which reads every `.js` file from every subfolder of `src/commands/`. Each file must export:

```javascript
module.exports = {
    name: "commandname",       // Must match the slash command name registered in Discord
    description: "...",
    async execute(interaction, client) {
        // ...
    },
};
```

The `name` field is used as the lookup key in `client.commands`. This same mechanism handles both slash commands (`interaction.commandName`) and button interactions (`interaction.customId`). The button custom IDs in `createOverview.js` (`update-events`, `show-signups`, `show-mysetups`, `show-allsetups`) must exactly match the `name` fields of the corresponding command files.

When adding a new command:
1. Create the file in the appropriate `src/commands/<category>/` folder
2. Add its definition to `scripts/register-commands.js` and re-run `npm run register`

## Environment Variables

All required variables must be in `.env` at the project root. See `.env.example` for the full list.

```
DISCORDJS_BOT_TOKEN=    # Bot token from Discord Developer Portal
CLIENT_ID=              # Discord Application ID
GUILD_ID=               # Discord server (guild) ID
API_BASE_URL=           # Backend API base (default: https://pulse-gdkp.de:3001/api)
NODE_ENV=               # Set to "production" to enable SSL cert verification
RAIDHELPER_API_KEY=     # API key for raid-helper.xyz
RAIDHELPER_SERVER_ID=   # Discord server ID on raid-helper.xyz
ADMIN_USER_ID=          # Discord user ID with bot admin access
```

Note: `bot.js` loads dotenv with `{ path: "../.env" }` (relative to `src/`). Always run scripts from the project root via `npm run ...`.

## Core Utilities

### `botReply(interaction, title, message, timeout, ephemeral, components)`
Standard way to send a Discord reply. Sends an embed with `title` and `description`. Default: ephemeral=true, timeout=60000ms (auto-deletes). Pass `timeout=0` to keep permanently.

### `botEditReply(interaction, title, message, ...)`
Used after `interaction.deferReply()`. Call this when the command needs more than 3 seconds to respond.

### `checkForPermission(interaction)`
Compares `interaction.user.id` against `adminUserId` from `config/variables.js`. Returns `false` and sends an error reply if unauthorized. Admin-only commands call this first and `return` if it returns false.

### `bidForLegendary(client, interaction, gold)`
Core bidding logic in `utils/auction.js`. Validates the user has the legendary role, checks auction exists, validates the bid amount, calls the API, updates the highest bids overview message, and handles extended auction time.

### `getRaidInfosFromChannel(interaction)`
Returns `{ raidData, setupData }` for the event in the current channel.

## API Clients

**`classes/raidhelper.js` (Raidhelper):** Uses raw `https` module. API key and server ID come from `process.env.RAIDHELPER_API_KEY` and `process.env.RAIDHELPER_SERVER_ID` via the constructor. Key methods: `getAllEvents()`, `getUserSignUps(userid)`, `getEvent(eventid)`, `getSetup(raidid)`, `signUpToRaid(raidid, signUps, userid)`, `saveRaid(data)`.

**`classes/gdkp.js` (GDKP):** Axios client. `getTotalItems(userid)` returns all items bought by a player.

**`classes/legendary.js` (Legendary):** Axios client. Methods for CRUD on auctions and bid placement. All point to `${API_BASE_URL}/legendary`.

Both Axios clients use the shared `utils/httpAgent.js` which enables SSL cert verification only in `NODE_ENV=production`.

## Code Conventions

- **Module system:** CommonJS only (`require` / `module.exports`). No ES Modules.
- **Indentation:** 4 spaces.
- **Quotes:** Double quotes (enforced by ESLint).
- **Semicolons:** Always (enforced by ESLint).
- **Line endings:** Left to Git (`core.autocrlf`) and your editor — not enforced by ESLint. (The `linebreak-style: windows` rule was removed: git stores LF blobs, so a fixed `windows` rule broke the Linux CI.)
- **Language:** User-facing strings in German. Variable names, function names, comments in English.
- **No TypeScript.** Plain JavaScript / CommonJS only.
- **Tests:** Jest. Every module has a matching test; every new feature ships with tests (see Testing).

## Testing

The project uses [Jest](https://jestjs.io/). Tests live next to the source tree under `test/`, mirroring `src/` (e.g. `src/utils/date.js` → `test/utils/date.test.js`).

- Run the full suite with `npm test`, watch mode with `npm run test:watch`, coverage with `npm run test:coverage`.
- Config is in `jest.config.js` (Node test environment, coverage collected from `src/**/*.js`).
- **Discord interactions and API clients are never hit for real.** Use the shared mock helpers in `test/helpers/` (`mockInteraction()` for a fake `interaction`, plus module mocks for the `classes/*` API clients). Mock external I/O with `jest.mock(...)` — no test may make a real network request.
- Prefer testing pure logic directly (formatters in `utils/helper.js`, date math in `utils/date.js`, the logcheck analyzers in `utils/logcheck/*`). For command files, assert on which helper (`botReply`/`botEditReply`) was called with which arguments.
- ESLint recognises Jest globals for files under `test/` via `eslint.config.mjs`.

## Common Patterns

### Deferred replies for slow operations
```javascript
await interaction.deferReply({ ephemeral: true });
// ... async work ...
await botEditReply(interaction, "Title", "Result");
```

### Permission-gated commands
```javascript
if (!checkForPermission(interaction)) return;
```

### Guard against missing parent category
```javascript
if (!interaction.channel.parent) {
    return botReply(interaction, "Fehler", "Dieser Befehl muss in einem Kanal mit einer Kategorie ausgeführt werden.");
}
const categoryId = interaction.channel.parent.id;
```

### Fetching Raidhelper data for the current channel
```javascript
const raidInfos = await getRaidInfosFromChannel(interaction);
// raidInfos.raidData, raidInfos.setupData
```

## Web Admin (`src/web/`, `src/web-client/`)

The bot ships an admin website as a **single React SPA** — `src/web-client/` (Vite + TypeScript), built to `dist/` and served as static files by `src/web/staticClient.js` under `/admin/*` (root `/` 302-redirects to `/admin`; `/admin2/*`, the SPA's old mount point during its migration, 302-redirects to the equivalent `/admin/*` path for old bookmarks). The SPA talks to `src/web/apiRoutes/*.js` (`/api/*`, JSON, dispatched by `apiRouter.js`) for everything — there is no server-rendered admin UI anymore.

- **Must be built before it's reachable.** Run `cd src/web-client && npm install && npm run build` — the built `dist/` is what `staticClient.js` serves. In production this now happens automatically via `deploy.sh`. See "Local test instances" above for the worktree workflow.
- Page components live in `src/web-client/src/pages/*.tsx`, one per admin section (`DashboardPage`, `RecruitmentPage`, `ClaPage`, `RaidsPage`/`RaidCreatePage`/`RaidDetailPage`/`NotifyTemplatesPage`, `ChannelsPage`, `SettingsPage`, `HistoryPage`/`HistoryEventPage`/`HistoryCharPage`), routed in `App.tsx`, shelled by `components/Shell.tsx` (sidebar nav + topbar with the server/guild switcher and theme toggle).
- Backend route handlers live in `src/web/apiRoutes/*.js`, grouped by domain the same way the pages are; `apiMiddleware.js`'s `requireAdmin`/`requireCsrf` gate every mutating call.

### Loot import (Gargul/RCLootcouncil)

`src/utils/lootImport.js` normalizes both export formats to one loot-item shape (`parseLoot`/`parseGargul`/`parseRclc`). `enrichItemNames(items)` fills in `itemName`/`itemIconUrl` that an export didn't carry (Gargul gives neither, RCLootcouncil gives a name but no icon) via `src/utils/wowhead.js`'s `lookupItem(itemId)` (Wowhead's tooltip endpoint, in-memory cached, best-effort — mock it in tests). Call it once, right after `parseLoot()` — the one import handler is `apiRoutes/history.js`'s `importLoot` (JSON, called from the React client's Historie-&-Loot and Raid-Detail Loot-tab imports).

## Known Issues and Gotchas

- **`saveRaid` in classes/raidhelper.js:** Uses `https.request` to connect to port 3001 on pulse-gdkp.de — this should be `http.request` as port 3001 is not TLS.
- **dotenv path:** `bot.js` uses `{ path: "../.env" }` (works when started from repo root via `npm start`). The `scripts/register-commands.js` uses plain `require("dotenv").config()` which uses CWD. Always run from project root.
- **No validation on `interaction.channel.parent`:** Commands that need a category channel must guard against `parent` being null (top-level channels have no parent).
- **`console.log(data)` in `raidhelper.js`:** `getAllEvents()` logs the raw API response to stdout on every call in legacy code paths.
- **Past-event detail pages can lose an event once its Discord channel is gone:** `/api/raids/detail` resolves an event via `raidEventGroups.js`'s `loadEventGroups()`, which joins live Raid-Helper events against **live** Discord channels (`discord.getChannelCategoryMap()`). If a past raid's signup channel was later deleted/archived, the event silently drops out of that join (`if (!meta) continue;`) even though Raid-Helper's API still returns it — the detail page then errors with "Event nicht gefunden.". The "Vergangene Raids" **list** doesn't have this problem: it reads a separate persisted snapshot (`raidEventStore.js`, populated by `raidEventScan.js`) that keeps the channel/category name captured at scan time instead of re-joining live Discord state. `matchableEvents.js`'s `loadMatchableEvents()` (used by log→event assignment) has the same persisted-snapshot fallback for the same reason.

## What NOT To Do

- Do not switch to ES Modules (`import`/`export`). The entire codebase is CommonJS.
- Do not add TypeScript.
- Do not add a feature or fix without tests, and do not merge with a failing `npm test`.
- Do not branch off `dev` — always branch off `main` and open PRs against `main` (see Development Workflow).
- Do not hardcode Discord IDs or API keys in command or utility files — use `config/variables.js` which reads from environment variables.
- Do not use `interaction.reply()` after already calling `interaction.deferReply()` — use `botEditReply` or `botFollowup` instead.
- Do not create slash commands without also adding them to `scripts/register-commands.js` and re-running `npm run register`.
- Do not move `.env` without also updating the `dotenv.config()` call in `bot.js` (`path: "../.env"`).
