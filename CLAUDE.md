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
  or override inline (bash: `WEB_PORT=3010 DEV_AUTO_LOGIN=1 NODE_ENV=development npm start`; PowerShell: `$env:WEB_PORT=3010; $env:DEV_AUTO_LOGIN=1; npm start`). The menu is then at `http://localhost:3010/` — the site root. `DEV_AUTO_LOGIN=1` auto-logs-in the first admin and is hard-gated to non-production (`src/config/variables.js`), so it can never weaken auth on the live bot.
- **The menu needs the React client built first.** Everything outside `/api`, `/auth`, `/health` and the `/r/` report pages is served from `src/web-client/dist/` (see "Web Admin" below) — run `cd src/web-client && npm install && npm run build` once per fresh worktree before starting the backend, or run `npm run dev` inside `src/web-client/` (its own Vite dev server, proxying `/api` to the backend port) for live-reloading frontend work. A missing/stale `dist/` means the menu 404s outright — there is no server-rendered fallback anymore.
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

The bot ships its website as a **single React SPA** — `src/web-client/` (Vite + TypeScript), built to `dist/` and served as static files by `src/web/staticClient.js` **from the site root**. The SPA talks to `src/web/apiRoutes/*.js` (`/api/*`, JSON, dispatched by `apiRouter.js`) for everything — there is no server-rendered admin UI anymore.

**Why the root, and what that means for routing.** The menu used to live under `/admin` (and `/admin2` before that), but members open it to look up loot — a link reading `/admin/history` told them they were somewhere they should not be. So `server.js` matches the paths that own themselves first (`/api/*`, `/auth/*`, `/health`, the public `/r/<id>` report pages) and hands **everything else** to `staticClient.js`; `/admin/*` and `/admin2/*` 302-redirect to the same path at the root, so old bookmarks and links already posted in Discord keep working. Consequences worth knowing:

- A new **server-side** path must be registered in `server.js` *above* the SPA fallback, or the client will answer it.
- An unknown GET no longer 404s on the server — it reaches the SPA, whose `path="*"` route renders the "not found" page inside the shell. The server's 404 is left for a missing `dist/` and for an unknown report id.
- `staticClient.js` takes the request path unprefixed now, so its path-traversal guard is the only thing between `/../../.env` and the filesystem (`test/web/staticClient.test.js` covers it).
- Vite's `base` and the router's basename are both `/` — don't reintroduce either. Links in the SSR report chrome (`adminChrome.js`) point at the root paths too, so they don't take a redirect hop.

- **Must be built before it's reachable.** Run `cd src/web-client && npm install && npm run build` — the built `dist/` is what `staticClient.js` serves. In production this now happens automatically via `deploy.sh`. See "Local test instances" above for the worktree workflow.
- Page components live in `src/web-client/src/pages/*.tsx`, one per admin section (`DashboardPage`, `RecruitmentPage`, `ClaPage`, `RaidsPage`/`RaidCreatePage`/`RaidDetailPage`/`NotifyTemplatesPage`, `ChannelsPage`, `SettingsPage`, `HistoryPage`/`HistoryEventPage`/`HistoryCharPage`), routed in `App.tsx`, shelled by `components/Shell.tsx` (sidebar nav + topbar with the server/guild switcher and theme toggle).
- Backend route handlers live in `src/web/apiRoutes/*.js`, grouped by domain the same way the pages are; `apiMiddleware.js`'s `requireAdmin`/`requireCsrf` gate every mutating call.

### How a page with many sections is laid out

Two pages outgrew a single tab row and are organised in two levels instead — the upper level says *what kind* of thing a section is, the lower *which one*:

- **Einstellungen** uses a section column (`components/SectionNav.tsx`) whose entries and groups are declared in `src/web-client/src/lib/settingsSections.ts`: *Zugang* (who gets in), *Verbindungen* (Discord/Raid-Helper, Battle.net, Loot-Sync tokens — every foreign system and its credentials), *Raid-Kategorien*, *Module* (one feature's behaviour). Two flags on a section carry real consequences: `adminOnly` keeps it out of a limited settings user's menu (mirroring `ACCESS_KEYS`/`requireFullAdmin` on the server), and `standalone` marks a section that saves itself, so the page's shared save button is not rendered under it. The open section is in the url as `?section=<id>`, so a hint on another page can link straight at it.
- **Historie & Loot** groups its nine tabs into *Raids* / *Loot* / *Import* (`TAB_GROUPS` in `HistoryPage.tsx`). The open group follows from the open tab, so there is only one thing to persist and `?tab=items` still opens the right place.
- **Everything configured per raid category** lives in one place, Einstellungen → *Kategorien* (`components/CategoryMatrix.tsx`): whether it is an event category, its raider roles, its loot addon and its fixed sheet — one card per category, saved with the page's form. It used to be four tabs each re-listing the same categories. A category that is switched off shows nothing but its switch.

### Editing a collection: list first, one editor at a time

Anything the admin keeps several of — raidsheets, Aufruf-Vorlagen, Recruitment-Vorlagen, gepostete Nachrichten — uses one shared pattern instead of stacking a form per entry (or parking a permanent "create" form under the list):

- `lib/collectionEditor.ts`'s `useCollectionEditor(param)` holds which editor is open in the url as `?<param>=<id|new>`: `""` = the list, `"new"` = creating, anything else = that entry's id. It **keeps the page's other params** (the settings section, the recruitment tab), and `editId` is `""` while creating, so no request ever asks the server to load an entry called "new".
- `components/ListSection.tsx` renders either the list (a heading row with the section's one "new" button, `ListHeader`) or the editor **in the list's place** (`EditorPanel`, with the way back where the new-button was). An id that no longer exists falls back to the new-editor rather than to a blank page.
- The forms themselves stay dumb: no own heading (the panel titles them) and an always-present *Abbrechen* that closes the editor. Two collections on one page need two params — Recruitment uses `edit` for templates and `editpost` for posted messages; sharing one would make the two editors close each other.

`test/web-client/listSection.test.js` holds the line, including a scan that no page renders `entries.map(e => <SomethingForm …/>)` again.

### Role permissions (who may see/do what)

Access is **per area** (one admin-menu section) and **per level** (`read` = open it, `write` = act in it; write implies read). The area list and all the pure logic live in `src/config/permissions.js` — the single source of truth shared by server and client (the client gets the list from `/api/session` and `/api/settings`).

- **Configured** in Einstellungen → *Berechtigungen*: per Discord role, a read and a write toggle per area, stored as `config.rolePermissions = { [roleId]: { [areaId]: { read, write } } }` (settingsStore). A member's rights are the **union** over all their roles.
- **Base access** sits above the roles in the same tab: `config.baseAccess = { [areaId]: { read, write } }` is what **every logged-in Discord account** gets — no role, no guild membership required — and is unioned into the role grants, so it only ever widens. Empty by default; the intended use is `loot: read`, so members can look up what dropped. Because it does not depend on Discord, it also holds when the member lookup says "not a member" or fails outright (`BASE_ACCESS()` in `auth.js`).
- **Resolved** in `auth.js`'s `computeAccess(userId)`: `ADMIN_USER_ID` and the admin roles from the *Zugang* tab are full admins (every area at write); everyone else gets the base access unioned with `accessForRoles(...)`. The session carries `{ isAdmin, access }` and is re-checked in the background every 5 minutes, so permission changes apply without a re-login.
- **Enforced** centrally in `src/web/apiAccess.js`: one table maps every `/api/*` endpoint to its area, `apiRouter.handle()` checks it *before* dispatching, and the level follows the HTTP method (GET = read, else write). An entry may list **several** areas — any one of them at the required level opens the path. **The table is fail-closed** — an endpoint that isn't listed is admin-only, so a new route can never leak. `test/web/apiAccess.test.js` asserts the table covers every route the router serves; add your endpoint there when you add a route.
- **Escalation guard:** `adminRoleIds`, `rolePermissions` and `baseAccess` are full-admin-only (`ACCESS_KEYS` in `apiRoutes/settings.js`, `requireFullAdmin`). A role with write access to "Einstellungen" can edit the bot config but neither sees nor saves who has access.
- The client mirrors this cosmetically: `Shell.tsx` hides tabs, `App.tsx`'s `Guard` hides pages, and the SettingsPage hides the *Zugang*/*Berechtigungen* tabs. It is never the actual gate — the API is.

**The menu itself is not gated.** Everyone who is logged in gets the shell — sidebar, breadcrumb and, above all, the **logout**; an account with nothing granted lands on a notice with the sidebar saying so, instead of a bare sentence on an empty page with no way back out. Only an anonymous visitor gets the login screen without a shell. `test/web-client/menuAccess.test.js` holds that line.

**`loot` is a second area on the history tab** — the read-only slice of *Historie & Loot*: the four loot tabs (Importierter Loot, Latest Loot, Loot-Gründe, Items) plus the event- and character-loot pages, and nothing else. It exists because the base access should let a member look up loot without handing them the raid lists, the logs and the imports. Consequences to keep in mind when touching those pages:

- The shared endpoints list **both** areas (`["history", "loot"]`), and `getHistoryData()` answers a loot-only caller with `lootOnlyHistoryData()` — the same payload shape with the other fields empty, which also skips the Raid-Helper and Discord round-trips that caller has no use for.
- `HistoryPage.tsx` renders only the tab groups the visitor's areas cover, and the write actions (import, delete, category select, manual item) are behind `canAccess(user, "history", "write")` on all three pages. Writing anywhere in the history always takes `history`, never `loot`.

**Rights can also go to one named account**, not just to a role: `config.userPermissions` is `{ [userId]: { [areaId]: { read, write } } }` — the same shape as `rolePermissions`, keyed by Discord user id, edited in Einstellungen → *Berechtigungen* under "Einzelne Konten" and unioned in exactly like the base access (it can only widen). It exists for areas that go to named people rather than to a group; inventing a Discord role for two players is a second list to keep in sync. Like the base access it is resolved **without Discord** (`BASE_ACCESS(userId)` in `auth.js`), so such a grant survives an offline bot, and it is full-admin-only (`ACCESS_KEYS`).

### Loot-Council (`lootcouncil` area)

The caster loot council: per raider, what they were given lately, how far their gear still is from BiS, and what a given drop would be worth to them — the page a council argues over when a boss dies. `src/web/lootCouncil.js` derives all of it **on read** from data the bot already keeps; nothing is stored.

- **Who is on it** — class and spec come from three sources in order: `characterInfo` (annotates only raiders with loot), then `characterStore` (knows everyone from the log evaluations), then the report's roster (class only). All three are needed: a raider who has *never won an item* is exactly the case the council is looking for, and only the last two know them. A class whose spec nothing settles (a priest could be shadow or holy) is **dropped rather than guessed** — a wrong spec means a wrong BiS list. `config/casterSpecs.js` holds the spec table, the stat weights and the hit caps.
- **What their gear is** — `src/web/charGear.js` reads the armory out of the stored CLA reports (`data/reports/*.json`), which already carry item id, gems and the permanent-enchant id per slot from Warcraft Logs. That is *last seen*, not current: every payload carries `seenAt`, and a raider in no report has no gear (the page says so instead of simulating a naked character).
- **What BiS is** — `src/config/wowsims/` is generated by `node scripts/fetch-wowsims-data.js` from wowsims/tbc-new (MIT): the caster slice of the item DB, the BiS sets per spec and tier, and the rotations. Don't hand-edit it. ⚠️ **WoWSims-TBC ships no healer BiS** — every healing gear set there is an empty placeholder, so healers get the loot history and the stat-weight scoring and the page says there is no list, rather than showing them a DPS set.
- **BiS is per spec *and* tier, never per item.** WoWSims has five caster lines (Shadow, Arcane, Destruction, Balance, Elemental); Fire/Frost borrow Arcane's and the two other warlock specs borrow Destruction's, marked as borrowed wherever shown. Most drops are contested — 29 of the 50 items on a T6 caster list are wanted by more than one spec — so a bare "BiS" badge answers nothing. `bisSpecsForItem()` (casterSpecs.js) says *whose*, folding a borrowing spec into the chip of the list it borrows so a contested item shows five claims rather than nine rows; `bisSpecsView()` adds the spec icon and class colour, and it rides on every item the page draws: BiS gaps, the drop check, and each worn piece.
- **Which BiS list to measure against** defaults to the tier the guild's *newest loot* comes from (`currentTier()`), not to the newest list WoWSims has — holding a T6 guild against Sunwell gear makes everyone look equally far from BiS and says nothing. The payload reports which tier was used and whether it was derived.
- **The need score** (`needScore()`) is 40 % drought + 30 % loot share + 30 % BiS gap, and its three parts go out with it so the page can show the reasoning — the bar is stacked in exactly those weights, so it shows not just how overdue somebody is but which part drives it. It rides along on every *candidate* too, not just on the roster row: "who would gain most" and "who has waited longest" are two different questions, shown as two bars side by side. Folding them into one number would look like an answer and hide the judgement the council is there to make.
- **The gear itself** goes out with each raider (`gear.items`, character-sheet order) and behind each candidate's replaced slot (`replaces`), through `wornItemView()`: the log's own name and icon — it saw what they actually wear — plus stats, raid and BiS membership from the item table. The page draws it as a row of icons under the raider, since sixteen item names are unreadable and sixteen icons are a character sheet.
- **Hit is capped, not linear**: `upgradeValue()` stops counting spell hit past the raider's cap on *both* sides of a swap, so a capped raider is neither handed the hit trinket nor punished for losing hit they did not need.

**The simulation is optional and always labelled.** `src/utils/wowsims/engine.js` runs the real `wowsimcli` binary as a local subprocess (`WOWSIMCLI_PATH`, fetched with `node scripts/fetch-wowsimcli.js`); without it every call answers `{ available: false }` and the page falls back to its stat weights, which is the normal state in CI and in a fresh worktree. ⚠️ The binary version, `WOWSIMS_VERSION` in `engine.js` and `SIM_VERSION` in `fetch-wowsims-data.js` are **one pin** — the protojson schema, the vendored rotations and the embedded item DB hang together (`test/utils/wowsims/engine.test.js` holds them in sync). `src/utils/wowsims/presets.js` is a 1:1 copy of WoWSims' own preset sets; a spec's set deliberately omits the buff it supplies itself (no Misery for the shadow priest), or it would count twice and inflate that spec against the others.

Runs are cached in `data/sim/` keyed by the loadout itself (`simStore.js`), so a changed gem re-simulates automatically and nothing else does; the seed is pinned (`randomSeed: "1"`) so an item that changes nothing reports a delta of exactly zero instead of sim noise. A council run is a background job the client polls — a whole roster against a full gap list is minutes of CPU.

### Loot import (Gargul/RCLootcouncil)

`src/utils/lootImport.js` normalizes all export formats to one loot-item shape (`parseLoot`/`parseGargul`/`parseRclc`/`parseEventHelper`). `enrichItemNames(items)` fills in `itemName`/`itemIconUrl` that an export didn't carry (Gargul gives neither, RCLootcouncil gives a name but no icon) via `src/utils/wowhead.js`'s `lookupItem(itemId)` (Wowhead's tooltip endpoint, in-memory cached, best-effort — mock it in tests). Call it once, right after `parseLoot()` — the import handlers are `apiRoutes/history.js`'s `importLoot` (JSON, called from the React client's Historie-&-Loot and Raid-Detail Loot-tab imports) and `apiRoutes/ingest.js`'s `ingestLoot` (below).

### Addon loot sync (`/api/ingest/loot` → Addon-Inbox)

A companion WoW addon (own repo: **eventhelper-addon**) reads the in-game history of *both* loot addons and uploads it, so nobody has to click through two export dialogs. WoW's Lua sandbox has no network access at all, so the chain is: addon → its own SavedVariables → a Node sync tool on the raidleader's PC → `POST /api/ingest/loot`.

- **Wire format** `eventhelper-loot` v1 (`EH_FORMAT`/`EH_VERSION` in `lootImport.js`): an envelope of raid *sessions*, each with items carrying a real unix `awardedAt`. That timestamp is the point — Gargul's own CSV has a date but no time of day, which makes matching a raid night guesswork. A payload from a newer addon than the server knows is refused, never half-read.
- **Item `source` stays `"rclc"`/`"gargul"`**, so an addon upload and a hand-pasted export of the same award share the dedup key (`source` + `rawId` = RCLootcouncil's `id` resp. Gargul's `checksum`) and collapse into one item.
- **Auth is a bearer token**, not a Discord session — the uploader runs unattended. `src/web/ingestTokenStore.js` stores tokens sha256-hashed, shows the secret exactly once, and revokes immediately. Minted in Einstellungen → *Loot-Sync* (full admins only). `apiAccess.js`'s `TOKEN_AUTH` set exempts *only* this one path from the session gate; the handler checks the token itself before doing any work.
- **Which raid a session was** is resolved in `src/web/lootSessionContent.js`, not taken at face value. The addon's reported instance wins — it saw the instance at award time — but it is blank for a Gargul-only night (Gargul stores no instance) and is a mere continent when RCLootcouncil recorded the award outside the instance ("Eastern Kingdoms" for a Karazhan night). In both cases the raid is derived from the item ids via `config/tbcContent.js`. Deliberately allowed to name more than one raid: TBC nights combine them (SSC + TK, Gruul + Magtheridon), so a single answer would be a false one. The inbox marks a derived name as such.
- **Nothing lands in the history unconfirmed.** An upload becomes a *pending session* in `src/web/lootInboxStore.js`, shown in Historie & Loot → *Addon-Inbox* with the Raid-Helper event it was matched to (a suggestion; an ambiguous day preselects nothing). Accepting files it and is **remembered**: later uploads of that session append straight to the same event, which is how the rest of a raid night arrives without a second click. Dismissing is remembered too, so a discarded session cannot reappear. Re-uploads of a pending session merge into the one card instead of stacking up — the sync tool re-sends the whole raid on every SavedVariables flush, so that is the normal case.

### The unfinished-raid guard (CLA / RPB)

An evaluation of a raid that is still running is worth little and unfair to the raiders it judges — half the bosses have no kill to measure against and every further pull changes the numbers. So `buildReport()` refuses one, and every path into it inherits that: `/logcheck`, the log-channel buttons, the admin menu.

- **The rule** is `src/utils/logcheck/raidProgress.js`: which raids a report covers (boss names via `tbcContent.js`, plus the report's own zone) and whether each one's final boss (`FINAL_BOSSES` there) was *killed*. Karazhan ends at Prince Malchezaar — Nightbane is optional and regularly skipped. German and English encounter names both count, since WCL hands back whatever the uploading client called them.
- **It errs towards letting things through**: a raid it cannot identify (unknown zone, no final boss listed) is never blocked. Being unable to see the end of a raid is not evidence that it has not happened, and a guard nobody can get past is worse than one that misses a case.
- **The refusal is cheap**: `buildReport` checks right after the fight list — the one request it has already made — and throws `IncompleteRaidError` before the dozens of calls the analysis would spend. Callers branch on `err.incomplete`, **not** `instanceof`: every one of them mocks `report.js` in its tests, and a mock without the class turns `instanceof` into a TypeError.
- **Getting past it is deliberate, never accidental.** `buildReport(link, { force: true })` is the way, and both front ends ask first: in Discord the refusal carries a *Trotzdem auswerten* button whose click opens a **modal** that wants `JA` typed in (`commands/logcheck/logevalForce.js` — the button and the modal share one customId prefix and one handler, branching on `isModalSubmit()`; a modal cannot be shown after `deferReply`, which is why the click cannot evaluate directly). In the admin menu the job comes back `incomplete`, and `lib/confirmIncomplete.ts` turns that into the confirm dialog and repeats the call with `force`.
- A report built anyway keeps `raidProgress` on it, so the page says the raid was not finished instead of the reader having to remember.

### Award reason and raid content (the "Loot-Gründe"/"Items" overviews)

Two things a loot export does not state usably are derived on **every read** in `lootStore.js`'s `decorate()`, never stored — so old imports profit from a grown table without a re-import:

- **Why** someone got an item — `src/utils/lootReasons.js` maps the addon's free-text `response` ("BiS", "Off-Spec", "Zweitspec", "Entzaubern", …) onto one of the `REASONS` buckets and adds `reason`/`reasonLabel`/`reasonTone` to the row. The raw `response` is kept untouched next to it. `tone` is the badge colour (`.rbadge-*` in `index.css`); an unrecognised response becomes `other`, never a guessed mainspec.
- **Where from** — `src/config/tbcContent.js` maps every TBC raid drop to its content (`ssc`, `tk`, `gruul`, …), tier (`t4`/`t5`/`t6`/`t65`) and boss **by item id**, which is the only key a Gargul row has. The `RAID_LOOT` block is generated — run `node scripts/fetch-tbc-loot.js` to refresh it from Wowhead's zone drop tables; don't hand-edit it. The export's own instance string is only the fallback, and an unknown item keeps `contentId: ""` instead of being filed into a wrong raid.

`src/web/lootStats.js` aggregates both into what `GET /api/history/loot-stats` serves (`reasonsByCharacter()` + `itemCatalog()`), rendered by `LootReasonsTab.tsx`/`LootItemsTab.tsx`. A reason badge is labelled with the guild's **own** response wording whenever every item in that bucket carries the same one ("Zweitspec" rather than the internal "Offspec"); the bucket only decides the colour and the filter.

Which loot addon a category uses (`config.categoryLootTool`) is a **setting**: it is edited in Einstellungen → *Kategorien*, on that category's card, and saved with the rest of the config through `PATCH /api/settings`. There is no separate endpoint for it (the old `/api/history/category-tool` is gone).

**Class colours in the client:** hand them to the DOM via `classColorProps()` (`ClassSpec.tsx`), not as `style={{ color }}` — it sets the `--cc` custom property so `.class-colored` can darken WoW's game palette for the light theme (Priest white and Rogue yellow are invisible on white otherwise).

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
