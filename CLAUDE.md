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

**Two hooks in `.claude/settings.json` enforce this and the lint rule mechanically** (checked in, so every agent in every worktree gets them):
- `.claude/hooks/guardMainCheckout.js` (PreToolUse on Edit/Write/MultiEdit/NotebookEdit) refuses any edit whose target lies in the *main* worktree of this repository, in whichever directory the session runs. Linked worktrees, other repositories, files outside git and git-ignored files (`.env.dev`, `data/`) pass. A deliberate one-off override is `EVENTHELPER_ALLOW_MAIN_EDITS=1`.
- `.claude/hooks/lintChanged.js` (PostToolUse on Edit/Write/MultiEdit) runs ESLint on the file just written (`src/`, `test/`, the hooks, and `src/web-client/` with its own config) and feeds the problems straight back, so style errors are fixed at the edit, not at the PR. No ESLint installed yet (fresh worktree) means it stays silent.
Both are plain Node scripts with tests under `test/claude-hooks/`; `npm run lint` covers them.

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
- **Historie & Loot** has three areas as a segment — *Loot* (Vergaben · Items · Gründe · Nach Raid), *Raids & Logs* (Raids · Warcraft Logs), *Charaktere* (`AREAS` in `HistoryPage.tsx`, design issue #225). The open area follows from the open view, so there is only one thing to persist and `?tab=items` still opens the right place. Import and inbox are not views: *Loot importieren* is a dialog from the page head (`components/ImportLootDialog.tsx`, with a preview from `POST /api/history/import-preview` → `web/lootImportPreview.js`, which stores nothing), the *Addon-Inbox* its own page `/history/inbox` (`HistoryInboxPage.tsx`, area `history` only). The old `?tab=import` / `?tab=inbox` links open the dialog resp. redirect. Who got an item, when and why is one dialog (`components/ItemAwardsDialog.tsx`, rows open it; single awards deletable with write access) instead of a hover panel per recipient. The module's CSS is `src/web-client/src/styles/historie-loot.css`.
- **Everything configured per raid category** lives in one place, Einstellungen → *Kategorien* (`components/CategoryMatrix.tsx`): whether it is an event category, its raider roles, its loot addon and its fixed sheet — one card per category, saved with the page's form. It used to be four tabs each re-listing the same categories. A category that is switched off shows nothing but its switch.

### Editing a collection: list first, one editor at a time

Anything the admin keeps several of — raidsheets, Aufruf-Vorlagen, Recruitment-Vorlagen, gepostete Nachrichten — uses one shared pattern instead of stacking a form per entry (or parking a permanent "create" form under the list):

- `lib/collectionEditor.ts`'s `useCollectionEditor(param)` holds which editor is open in the url as `?<param>=<id|new>`: `""` = the list, `"new"` = creating, anything else = that entry's id. It **keeps the page's other params** (the settings section, the recruitment tab), and `editId` is `""` while creating, so no request ever asks the server to load an entry called "new".
- `components/ListSection.tsx` renders either the list (a heading row with the section's one "new" button, `ListHeader`) or the editor **in the list's place** (`EditorPanel`, with the way back where the new-button was). An id that no longer exists falls back to the new-editor rather than to a blank page.
- The forms themselves stay dumb: no own heading (the panel titles them) and an always-present *Abbrechen* that closes the editor. Two collections on one page need two params — Recruitment uses `edit` for templates and `editpost` for posted messages; sharing one would make the two editors close each other.
- **Recruitment opens its editors as modals over the list** instead (design #215): same url params, but the editor is a `Modal` with the live Discord preview (`components/DiscordPreview.tsx`, markdown parsed by `lib/discordMarkdown.ts`, whose regexes are held identical to the tested twin `src/utils/discordMarkdown.js`) beside the fields, so the other templates stay in view. `?editpost=new` is the "Nachricht posten" dialog. A post remembers the `templateId` it was posted from; an application's `status` ("neu" = younger than 7 days, nothing stored) and class/spec icons come from `src/web/recruitmentApplications.js`.

`test/web-client/listSection.test.js` holds the line, including a scan that no page renders `entries.map(e => <SomethingForm …/>)` again.

### Role permissions (who may see/do what)

Access is **per area** (one admin-menu section) and **per level** (`read` = open it, `write` = act in it; write implies read). The area list and all the pure logic live in `src/config/permissions.js` — the single source of truth shared by server and client (the client gets the list from `/api/session` and `/api/settings`).

- **Configured** in Einstellungen → *Berechtigungen*: per Discord role, a read and a write toggle per area, stored as `config.rolePermissions = { [roleId]: { [areaId]: { read, write } } }` (settingsStore). A member's rights are the **union** over all their roles.
- **Base access** sits above the roles in the same tab: `config.baseAccess = { [areaId]: { read, write } }` is what **every logged-in Discord account** gets — no role, no guild membership required — and is unioned into the role grants, so it only ever widens. Empty by default; the intended use is `loot: read`, so members can look up what dropped. Because it does not depend on Discord, it also holds when the member lookup says "not a member" or fails outright (`BASE_ACCESS()` in `auth.js`).
- **Resolved** in `auth.js`'s `computeAccess(userId)`: `ADMIN_USER_ID` and the admin roles from the *Zugang* tab are full admins (every area at write); everyone else gets the base access unioned with `accessForRoles(...)`. The session carries `{ isAdmin, access }` and is re-checked in the background every 5 minutes, so permission changes apply without a re-login.
- **Enforced** centrally in `src/web/apiAccess.js`: one table maps every `/api/*` endpoint to its area, `apiRouter.handle()` checks it *before* dispatching, and the level follows the HTTP method (GET = read, else write). An entry may list **several** areas — any one of them at the required level opens the path. **The table is fail-closed** — an endpoint that isn't listed is admin-only, so a new route can never leak. `test/web/apiAccess.test.js` asserts the table covers every route the router serves; add your endpoint there when you add a route.
- **Escalation guard:** `adminRoleIds`, `rolePermissions` and `baseAccess` are full-admin-only (`ACCESS_KEYS` in `apiRoutes/settings.js`, `requireFullAdmin`). A role with write access to "Einstellungen" can edit the bot config but neither sees nor saves who has access. The same gate covers the credentials to foreign systems — `anthropic` and `warcraftlogsV2` (`CREDENTIAL_KEYS`, together `FULL_ADMIN_KEYS`): a limited settings user gets neither block from `GET /api/settings` and a PATCH carrying one is refused, so the client sends them only behind `canManageAccess`. No secret ever goes back to the browser — `publicConfig()` replaces the Battle.net/WCL client secrets and the Anthropic key with `hasClientSecret`/`hasApiKey`.
- The client mirrors this cosmetically: `Shell.tsx` hides tabs, `App.tsx`'s `Guard` hides pages, and the SettingsPage hides the *Zugang*/*Berechtigungen* tabs. It is never the actual gate — the API is.

**The menu itself is not gated.** Everyone who is logged in gets the shell — sidebar, breadcrumb and, above all, the **logout**; an account with nothing granted lands on a notice with the sidebar saying so, instead of a bare sentence on an empty page with no way back out. Only an anonymous visitor gets the login screen without a shell. `test/web-client/menuAccess.test.js` holds that line.

**`loot` is a second area on the history tab** — the read-only slice of *Historie & Loot*: the four loot views (Vergaben, Items, Gründe, Nach Raid) plus the event- and character-loot pages, and nothing else. It exists because the base access should let a member look up loot without handing them the raid lists, the logs and the imports. Consequences to keep in mind when touching those pages:

- The shared endpoints list **both** areas (`["history", "loot"]`), and `getHistoryData()` answers a loot-only caller with `lootOnlyHistoryData()` — the same payload shape with the other fields empty, which also skips the Raid-Helper and Discord round-trips that caller has no use for.
- `HistoryPage.tsx` renders only the areas the visitor's areas cover (the inbox page needs `history`), and the write actions (import, delete, category select, manual item) are behind `canAccess(user, "history", "write")` on all three pages. Writing anywhere in the history always takes `history`, never `loot`.

**Rights can also go to one named account**, not just to a role: `config.userPermissions` is `{ [userId]: { [areaId]: { read, write } } }` — the same shape as `rolePermissions`, keyed by Discord user id, edited in Einstellungen → *Berechtigungen* under "Einzelne Konten" and unioned in exactly like the base access (it can only widen). It exists for areas that go to named people rather than to a group; inventing a Discord role for two players is a second list to keep in sync. Like the base access it is resolved **without Discord** (`BASE_ACCESS(userId)` in `auth.js`), so such a grant survives an offline bot, and it is full-admin-only (`ACCESS_KEYS`).

### Loot-Council (`lootcouncil` area)

The caster loot council: per raider, what they were given lately, how far their gear still is from BiS, and what a given drop would be worth to them — the page a council argues over when a boss dies. `src/web/lootCouncil.js` derives all of it **on read** from data the bot already keeps; nothing is stored.

- **The raid-category filter narrows the *roster*, not just the loot.** Filtering only the items left every other raid's casters standing there with "0 Items" and a maximum drought — on top of the very ranking the page exists for. `categoryMembers()` decides who belongs, from three sources unioned because none is complete on its own:
  1. **the logs of that category's raids** (`categoryFromReports()`: Report → Log `reportRefId` → `eventId` → raid event → `categoryId`) — the strongest, because nobody maintains it: whoever stands in a Monday log raids on Mondays;
  2. **the loot awarded there** — covers raids that were never evaluated, but is blind to anyone who never won something;
  3. **the raider→character assignment** (`raiderCharactersStore`, Einstellungen → Kategorien) — the only source that knows a raider who has neither won nor been logged there.

  ⚠️ **When all three find nobody, the filter still applies and the roster is empty.** Falling back to "show everyone" was the original bug: picking a category then changed nothing, which is precisely what it is supposed to do. `filter.categorySources` reports what each source contributed, so the page can say *what to fix* — an empty list with an explanation is useful, a full list is not.
- **Raiders can be set aside** (`councilStore.js`, `POST /api/lootcouncil/exclude`). Someone who left the guild wins the "hat am längsten nichts bekommen" ranking simply by not raiding — their drought grows forever. Excluding is reversible, remembers who and when, and never touches the loot history. Deliberately explicit rather than an automatic "inactive for 60 days" rule: the difference between *gone* and *was ill* is one only a person knows.
- **Who is on it** — class and spec come from three sources in order: `characterInfo` (annotates only raiders with loot), then `characterStore` (knows everyone from the log evaluations), then the report's roster (class only). All three are needed: a raider who has *never won an item* is exactly the case the council is looking for, and only the last two know them. A class whose spec nothing settles (a priest could be shadow or holy) is **dropped rather than guessed** — a wrong spec means a wrong BiS list. `config/casterSpecs.js` holds the spec table, the stat weights and the hit caps.
- **What their gear is** — `src/web/charGear.js` reads the armory out of the stored CLA reports (`data/reports/*.json`), which already carry item id, gems and the permanent-enchant id per slot from Warcraft Logs. That is *last seen*, not current: every payload carries `seenAt`, and a raider in no report has no gear (the page says so instead of simulating a naked character).
- **…and that it is the right *kind* of gear.** Shamans, druids and priests heal a night regularly, so their newest log may show a healing set — which would give a DPS caster no DPS worth the name and let every drop "replace" a healing piece it has nothing to do with. `src/web/gearProfile.js` tells the two apart from the stats: on a damage item WoWSims models healing power and spell power as *equal*, while a healing item carries far more healing (a T6 shadow set sits at 866/866, a healing set at 7605/2537), and only a damage set chases the hit cap. Both signals are weighed together, and `charGear`'s `roleFor` then walks back to the newest raid where the raider actually played that role, reporting `skippedReports`. A set that is genuinely ambiguous is *accepted* rather than rejected — leaving a raider with no gear is worse than slightly odd gear — and one that never fits anywhere is used with `roleMismatch`, so the page can say the numbers rest on healing gear instead of silently pretending otherwise.
- **Off-spec rolls, shards and bank items do not count as loot** (`countsAsLoot` in `utils/lootReasons.js`). They did nothing for the raider's set, and counting them would rank somebody who politely took three shards above a raider who got one real upgrade — the fairness half of the ranking would be exactly backwards. They are tallied separately as `otherCount` and named in the hover rather than hidden, so the number does not look wrong to whoever handed them out. `other` (an unrecognised response) *does* count: it is far more often a guild's own wording for a mainspec roll than it is a shard.
- **What BiS is — two sources, and `src/config/bisSets.js` is the only place that reads them.** `src/config/wowsims/` is generated by `node scripts/fetch-wowsims-data.js` from wowsims/tbc-new (MIT): the item DB, the BiS sets per spec and tier, and the rotations. ⚠️ **WoWSims-TBC ships no healer BiS at all** — every healing gear set there is an empty placeholder and there is no priest healing sim — so the five healing specs come from **Wowhead's written BiS guides** instead (`src/config/wowhead/bisSets.json`, `node scripts/fetch-wowhead-bis.js`). Neither is hand-edited. WoWSims wins wherever it has something, so a spec never silently swaps from a simulated list to a written one, and every answer carries `source` so the page can label a Wowhead column as what it is. **The difference is real and must stay visible: a Wowhead guide names items and nothing else** — no gems, no enchants — which is enough for the BiS gap and the stat weights, and not enough to simulate against.
- **Refreshing the lists is `npm run bis:refresh`, and it runs the Wowhead scraper twice on purpose.** The scraper needs the item table to know which slot a piece goes in; the item table needs the scraper's ids to carry a healing relic at all, because an idol, totem or libram has *no stats* — its whole value is an effect — and `isRaidItem` would drop it. So pass one writes down what it could not place (`pending`), `fetch-wowsims-data.js` takes those ids along (above the quality cut only: a written guide may name an item the table filters for want of stats, never a green), and pass two resolves them. Two further things the scraper does that are easy to get wrong, both covered by `test/scripts/fetchWowheadBis.test.js`: everything behind a `[toggler]` is dropped (the guide itself calls those the fallbacks), and **which slot a piece takes comes from the item, not the section heading** — the item table lists both hands for every weapon, so without narrowing that the Weapons section's second-best entry took the off hand and the actual off-hand piece had nowhere to go.
- **BiS is per spec *and* tier, never per item.** WoWSims has five caster lines (Shadow, Arcane, Destruction, Balance, Elemental); Fire/Frost borrow Arcane's and the two other warlock specs borrow Destruction's, marked as borrowed wherever shown. Most drops are contested — 29 of the 50 items on a T6 caster list are wanted by more than one spec — so a bare "BiS" badge answers nothing. `bisSpecsForItem()` (casterSpecs.js) says *whose*, folding a borrowing spec into the chip of the list it borrows so a contested item shows five claims rather than nine rows; `bisSpecsView()` adds the spec icon and class colour, and it rides on every item the page draws: BiS gaps, the drop check, and each worn piece.
- **Which BiS list to measure against** defaults to the tier the guild's *newest loot* comes from (`currentTier()`), not to the newest list WoWSims has — holding a T6 guild against Sunwell gear makes everyone look equally far from BiS and says nothing. The payload reports which tier was used and whether it was derived.
- **The need score** (`needScore()`) is 50 % drought + 40 % loot share + 10 % BiS gap (`NEED_WEIGHTS`; the raid lead's call — a raider far from BiS is not owed an item, a raider who has waited is), and its three parts go out with it so the page can show the reasoning — the bar is stacked in exactly those weights, so it shows not just how overdue somebody is but which part drives it. It rides along on every *candidate* too, not just on the roster row: "who would gain most" and "who has waited longest" are two different questions, shown as two bars side by side. Folding them into one number would look like an answer and hide the judgement the council is there to make.
- **The gear itself** goes out with each raider (`gear.items`, character-sheet order) and behind each candidate's replaced slot (`replaces`), through `wornItemView()`: the log's own name and icon — it saw what they actually wear — plus stats, raid and BiS membership from the item table. The page draws it as a row of icons under the raider, since sixteen item names are unreadable and sixteen icons are a character sheet.
- **A candidate the drop is not BiS for counts half.** `candidateSplit()` puts `bisWeight` (1, or `NON_BIS_WEIGHT` = 0.5) and `itemNeedScore` (= need × weight) on every candidate; the server's ordering and the page's verdict, gain sort and need sort all multiply by it, while the displayed DPS delta and the need bar stay the raw numbers. So a raider for whom the item is BiS is preferred unless the other's measured gain is more than twice as large — the item still *helps* the other, it is just not theirs first.
- **Hit is capped, not linear**: `upgradeValue()` stops counting spell hit past the raider's cap on *both* sides of a swap, so a capped raider is neither handed the hit trinket nor punished for losing hit they did not need.
- **A raider who cannot equip the item is never a candidate.** `src/config/wearable.js` holds the game's rules — the item's class list (tier/set pieces), armour type per class (cloth classes get no leather/mail, the back slot is exempt), weapon type and hand per class (no two-hander for a rogue, no sword for a priest, a shaman's two-handed axe only as Enhancement), and the ranged/relic type (wands for cloth, one relic type per class). It reads the `classes`/`armorType`/`weaponType`/`rangedType` fields of the generated item table, so they must survive a re-run of `fetch-wowsims-data.js`. `candidateSplit()` in `lootCouncil.js` returns `{ candidates, unwearable }` — the drop check lists the unwearable raiders with the reason instead of silently shortening the list — and `simStore.js` skips such pairs too, because a simulated number for a piece the raider cannot put on is a wrong answer however well measured. An item the table does not know passes: "cannot tell" is not "cannot wear".
- **No estimates.** The page shows a gain only once it is simulated; a candidate without a result says "nicht simuliert", an item nobody in the list can be simulated for (healers) is suggested by need and labelled so, and the stat-weight `value` stays in the payload only as the server's ordering. A picked drop is simulated automatically against its candidates (seconds); the whole BiS list stays a button (minutes).
- **PvP gear is refused as a source.** Between two raid nights the armory shows the arena set, and resilience is worth nothing to a boss. `gearProfile.js`'s `isPvpSet()` (half or more of the known pieces carry resilience) makes `charGear.js` reject an armory set with `armoryRejected: "pvp"` (a healing set for a caster: `"role"`) and keep the last raid's gear, skip PvP sets in the report walk like wrong-role sets, and fall back to one only when nothing else exists (`pvpGear: true`). `armoryItemInSlot()` refuses a single PvP piece for the same reason. The page's gear stamp and the armory toast say which.
- **A third gear source: one Warcraft-Logs report, loaded by hand** (`src/web/logGearStore.js`, `POST /api/lootcouncil/loggear`). The evaluations only know raids somebody ran the CLA on, and the armory only knows *now* (arena set, Blizzard enchant ids). The "Log" segment of the gear-source switch in the raider's details opens a panel listing the bot's newest logs (`recentLogs` in the council payload) plus a link field; the server reads that report's casts table once, builds the raider's armory with the CLA's own `buildArmory` (gems, enchant status, boss-specific pieces resolved against the same night) and keeps it on disk under the character. `charGear.js` then uses it with `source: "wcl"` — it replaces the evaluation's set, gives gear to a raider no evaluation knows, and **yields to an evaluation newer than the request** (`report.generatedAt > snapshot.fetchedAt`), which is the natural end of "the set from Thursday". The same role/PvP rules as for the armory apply (`logRejected: "pvp" | "role"` keeps the evaluation's set and the stamp says so); the armory still wins over a loaded log, so loading one drops that raider's armory cache entry (`clearArmoryFor`), and "Auswertung" (`clear: true`) drops both. Without a report id the newest `MAX_LOGS` logs are tried in turn, and the error names how many.
- **Layout: list, details dialog, drop page** (design issue #223, canvas https://claude.ai/code/artifact/9f0bbaaa-5c6b-422a-a5ea-a60f2bddfbf9). `LootCouncilPage.tsx` is the page head, one filter bar (`lootcouncil/FilterBar.tsx` — the old Filter/Gear-Stand/Simulation boxes are tooltips and two badges now) and four tabs; the Raider tab is one compact line per raider (`lootcouncil/RosterList.tsx`). Everything about one raider — gear with the source segment (Auswertung · Log · Armory), badges instead of the gear stamp, the character sheet, BiS gaps, loot, log panel, role switch, Sim-Export (a second modal), Nicht einplanen, Armory — lives in `lootcouncil/RaiderDialog.tsx`, opened from `?raider=<name>` so a link leads straight there. "Drop prüfen" is its own route, `/lootcouncil/drop/:itemId?` (`lootcouncil/DropCheckPage.tsx`), reading the same persisted filters (`VIEW_KEY`); a stored `tab: "drop"` falls back to the Raider tab. Shared rules and the sim runner are in `lootcouncil/council.ts`, shared components in `lootcouncil/parts.tsx`, the CSS in `styles/loot-council.css`. Tooltips with more than a sentence (the need bar's three parts, the last items) are `RichTip` in the shared `.tip` box, portalled into an open dialog. A worn item's icon is a Wowhead link carrying the raider's gems and enchant (`gemIds`/`enchantId` on `WornItem`, `wornWowheadUrl()`), so the widget tooltip (`lib/wowheadTooltips.ts`, `refreshWowheadLinks()` after every render) shows the piece as worn; the corner marks stay and explain themselves in the tooltip box, so there is no legend.
- **Every wait is a job toast** (`components/Jobs.tsx`, `useJobs().run`): reloads and the drop fetch run `quiet` (the toast disappears on success), the armory and the simulation report their outcome, and the simulation feeds its real progress (`update({ progress })`) into the toast bar. The page keeps no progress bar or error line of its own — it is three screens long, and feedback under the filter section is feedback nobody sees.
- **A drop is judged against every slot it could go in**, not one. `targetSlotFor()` returns `options` (all candidate slots with what sits there), `displaces` (what would actually come off) and `clears`. Two cases it exists for: a doubled slot shows *both* rings/trinkets with the one that goes marked — which one is kept is half the decision; and a **two-handed weapon takes both hands**, so it displaces the off-hand piece as well. ⚠️ `clears` must reach the simulation (`simStore.js` passes it into the swap): without it WoWSims keeps the off hand equipped next to the staff and reports DPS off gear the raider cannot wear. The stat-weight value subtracts the off-hand piece for the same reason.

**The simulation is optional and always labelled.** `src/utils/wowsims/engine.js` runs the real `wowsimcli` binary as a local subprocess (`WOWSIMCLI_PATH`, fetched with `node scripts/fetch-wowsimcli.js`); without it every call answers `{ available: false }` and the page falls back to its stat weights, which is the normal state in CI and in a fresh worktree. ⚠️ The binary version, `WOWSIMS_VERSION` in `engine.js` and `SIM_VERSION` in `fetch-wowsims-data.js` are **one pin** — the protojson schema, the vendored rotations and the embedded item DB hang together (`test/utils/wowsims/engine.test.js` holds them in sync). `src/utils/wowsims/presets.js` is a 1:1 copy of WoWSims' own preset sets; a spec's set deliberately omits the buff it supplies itself (no Misery for the shadow priest), or it would count twice and inflate that spec against the others.

Runs are cached in `data/sim/` keyed by the loadout itself (`simStore.js`), so a changed gem re-simulates automatically and nothing else does; the seed is pinned (`randomSeed: "1"`) so an item that changes nothing reports a delta of exactly zero instead of sim noise. A council run is a background job the client polls — a whole roster against a full gap list is minutes of CPU.

**A swapped-in drop is simulated as it would be worn, never bare.** `loadout.js`'s `bisFittingFor()` gives it the gems and enchant of the spec's WoWSims BiS list: the list's own fitting when the item is on it, otherwise the enchant the list puts on that slot and, per socket colour, the gem the list socketed most in that colour (`sockets` in the generated item table are WoWSims' colour codes, 1 = meta). Before this the drop inherited whatever sat on the replaced piece — three empty sockets on a T6 chest read as a sidegrade. The piece the raider already wears keeps its own fitting (so "the item you already have" still sims to a zero delta), and a spec without a WoWSims list falls back to inheriting. `fitting` on the sim result says which.

**Gems and enchants do reach the simulation** — measured, not assumed: on a T6 shadow-priest reference set they are worth +108 and +125 DPS, so a run that silently dropped them would be obvious. Two things the binary gets wrong, both handled and both verified against the pinned release:

- ⚠️ **A gem it does not know aborts the entire run**, not just that item ("…had gem with id: N\nThis gem is not in the database"). Raiders socket things no caster table anticipated, so `engine.simulate()` strips the offending gem and retries, warning that the number is now slightly low. Without that, one exotic gem costs a raider their result completely.
- ⚠️ **It does not check a meta gem's colour requirement.** An inactive Chaotic Skyfire Diamond still contributed (1809 vs 1806 DPS in a run where it should have been dormant), so a raider who socketed wrongly would be simulated as if they had not. `loadout.js`'s `stripInactiveMeta()` removes it first, using the *same* rule as the gear check (`metaGemActive`) so the sim and a CLA report's "Meta-Gem inaktiv" finding can never disagree.

**Every raider's loadout can be exported** as a WoWSims "From JSON" import (`GET /api/lootcouncil/export?character=…`, `engine.buildIndividualExport()`), so anyone can paste it into wowsims.github.io/tbc and check the number themselves. It is built from the same pieces as the headless run and reproduces its DPS exactly (verified: 1813/2757/2149 both ways) — an export that quietly differed would be worse than none, because it would make the page look wrong. ⚠️ The WoWSims individual import does **not** switch class from the JSON, so the payload carries `simUrl`: the sim page it belongs on. Pasted on another class's sim it produces nonsense without complaining.

### Fight timelines and recommendations (the report page's "Kampfverlauf" and "Empfehlungen" tabs)

The log-check report (`/r/<id>`) carries a **time axis** since Sept 2026. `utils/logcheck/fightTimeline.js` builds one row per boss fight (bounds, `encounterId`, deaths with the killing blow); the analyzers that follow write into it — `raidDebuffs.js` (debuffs on the boss, stacks, expectation **from the roster**, never from the encounter), `totems.js` (per shaman: drops, the party buff the log actually saw, Windfury twisting), `cooldownTimeline.js` (presses vs. possible, Bloodlust windows), `mechanics.js` (avoidable hits, deaths judged avoidable/early/near-end/repeat), `activityTimeline.js` (GCD-covered bands, holes with a reason), `healers.js` (per healer: overheal per spell, the mana curve with every potion/Innervate/Mana Tide marked at the level it came, dispels with reaction time, and the shields/HoTs on the *active tank* — WCL's listed tank who took the most damage), `raidBuffs.js` (per player: which class buffs were on them — `full`, `late` (set after the pull, then kept), `partial` (not throughout: ran out or had a hole) or `none` — with the expectation from *that fight's* roster: no paladin means no blessing is missing, one paladin means one blessing per player, and Might on a priest is a wrong one, not a present one, while Light and Sanctuary are `neverWrong` in `config/raidBuffs.js` because TBC raids put them on everyone; a roster player whose buffs table was not fetched is not judged rather than reported as lacking everything; the bands come from WCL's buffs table with `sourceid`, which for auras is the unit the buff is **on**. ⚠️ **The Anniversary client does not put Fortitude and Mark of the Wild into the combatant info**, so WCL shows no band for them at any pull — only a re-cast mid-log makes one — while the blessings, Arcane Brilliance, Prayer of Spirit and Shadow Protection are listed (verified against a real Hyjal/BT log: 0 of 25 in the combatant info, 3 of 25 with a stray band). `untrackedBuffs()` therefore picks out a class buff that sits on fewer than half the raid at the *typical* pull (the lower median over the boss fights — "at any pull" was the first rule and one wipe broke it: a death removes every aura, WCL draws a band from the pull to the death for each, so the wipe fight showed Fortitude on all 25 and every other fight on nobody, which read as 24 raiders without Fortitude on fifteen bosses). Such a buff is **read off the raw buff events instead** (`inferBands()`, one filtered `getAllEvents` walk: the buff's own ranks plus every other raid buff's `removebuff` as death witnesses): a `removebuff`/`refreshbuff` proves it was on the player up to that moment, since the last point it was known to be off; an `applybuff` proves it from then on; and a death that stripped other buffs but not this one (52 of 58 deaths in that log strip; the rest were not seen) proves it missing and anchors the next remove. What the events do **not** see is the re-buff after a wipe — WCL keeps no events outside its fights, and a raid re-buffs out of combat — so after a remove the buff is `unknown` until the next event, never `none`: a player with no evidence in a fight gets the status `unknown`, shown as "?" / "nicht nachweisbar", tallied apart (`unknown` on every cell, row and player, `unknownCells` on the summary) and never a finding. The page says so above the matrix ("Aus dem Verlauf abgeleitet") and on the fight's Buffs topic; `inferred` on the fight and summary names the keys. Only when the events walk fails does the buff stay out of the judgement as before (`untracked`, "im Log nicht nachweisbar"). Verified on the same log over all 16 bosses: Fortitude 333 cells present, 0 missing, 66 open; a buff half the raid demonstrably had stays a finding when it is missing). Every one of them stores **derived intervals only**, never raw events, and judges a player until their death, not until the fight's end. Their raid summaries are own CLA fields (`CLA_FIELDS` in `report.js` — a field missing there is wiped by an RPB re-run). The "Raid-Debuffs" tab shows `raidDebuffs.rows` as the summary and, under it, a debuff × boss matrix that `render.js` derives purely from `timeline.fights[].debuffs` (mean over a boss's tries, tries in the tooltip; the expectation is the raid-wide `expected` flag each fight row carries, so a boss without a row for the debuff reads "–") — nothing is stored for it.

The page draws them with `src/web/charts.js`: pure inline-SVG builders (ribbon, marker, bar, line), no chart library, icon column and value column as HTML beside a horizontally scrolling plot on a **fixed 6 px/s scale**, every chart with a table twin.

**Three head levels, badges, tiles, one expand control** (Sept 2026, design signed off): a *card head* (`.vcard > summary`, a 2-px line under it when open) says who or what — boss, raider, raid section; a *part head* (`.part-head`, a tinted band with an icon `tile()` in the topic's tone, the title, the breadcrumb, one action) says which topic; a *table head* (`table.idx th`, tinted, mono, uppercase) says which column. Sentences like "2 Tries · Wipe bei 32 % · Kill 3:24 · 1 Tod" are `badge()`s with an icon and a tone (ok / mid / bad / accent; `count` for the round counter form), the section buttons carry their tone on the counter (`.sec .n.mid/.bad`) instead of a dot, and every `<details>` summary ends in `expBtn()` — "Details" plus a round 30-px chevron button that fills and turns when open — because the old ▸ glyph was too small to find. **Lists of things that belong to somebody are grouped under that somebody** (`groupedTable()`): the Cooldowns, Mechaniken and Totems topics of a fight show one `<details class="grp">` per player (class tile, name, a result badge such as "3 von 4 genutzt" or "6 Treffer"), sorted by what needs attention, opened only where something was missed — a flat "Dorn · Bloodlust, Brokk · Shield Wall, Dorn · Mana Tide" list was unreadable. **The Heilung topic is a ranked healer list** (`.hlist`, one `<details class="hrow">` per healer): rank, class icon and name, the one healing + overheal bar, mana-low and dispel badges, hints (absorb, death, missing potion); the chips, the spell table and the "Manaverlauf öffnen" button sit in the row's body, the strongest healer open. All bars keep their fixed column width (`.bar` 120 px, `.bar-heal` 260 px), so a short spell name never makes a longer bar.

**Tooltips are the page's own box, never the browser's.** `render.js` ships one floating `#tip` element driven by `data-tip` (the head) and `data-tip-sub` (the explanation) on any element, HTML or SVG — hover, keyboard focus and a tap on touch all open it. There is no `title=` attribute and no SVG `<title>` left on the report pages, on purpose: the native box appears after a second, cannot be styled and does not work on touch. Every headline number explains itself through it — the Kennzahlenzeile of a fight (`fightStats`: what Raid-DPS is measured from, what "13 s auseinander" means for a Bloodlust, when the activity turns yellow), the KPI cards (`kpi()`), the boss and raider chips, the healer chips and the table heads — so a raid lead does not have to know the analyzers to read the page. A `"Label: detail"` tooltip is split into head and sub rather than crammed into one line. **Numbers a reader compares within a column are WCL-style bars** (`barCell()` / `barPct()`): the number sits on a bar whose length is its share of the column's maximum (the healing spell and healer tables) or the percentage itself (activity, cooldown usage), toned like the charts, so the ranking is visible without reading digits. `render.js`'s `fightParts()` documents the shape each topic expects and returns, per topic, a compact **table** and the **chart** separately — which half goes where is the page layout's business, not the topic's.

**The report page is three views, not sixteen tabs** (`renderReportPage`, Sept 2026, design signed off by the raid lead): a head with the title, the zone/date kicker, the actions and four KPI cards (`kpiCards()`: bosses with kills/wipes, deaths with the avoidable ones from `report.mechanics.deaths`, open recommendations for a reviewer resp. approved ones for everyone else, flask/elixir coverage), then a segmented switch **Raid · Bosse · Raider** driven by the same `data-show` script as everything else (`TIMELINE_SCRIPT`), the open view kept in the url hash (`#raid` / `#bosse` / `#raider`; `#raider-<name>` or `?player=<name>` opens that raider's card — `VIEW_SCRIPT`). Bosse opens first when there is a timeline, Raid otherwise. There is still **no JS bundle** on these pages: `<dialog>` elements plus small inline scripts (`DIALOG_SCRIPT`, `FILTER_SCRIPT`, `SEND_DLG_SCRIPT`, the existing `REVIEW_SCRIPT`/`PHRASE_SCRIPT`/`SEND_SCRIPT`), the CSRF token fetched from `/api/session`.

- **Sicht Raid** (`raidSections()`) is every raid-wide part as a foldable `<details class="rsec">`, closed except "Empfehlungen an den Raid": the raid recommendations with the verdict controls, "Alle senden" (the old raid-wide `renderSendBox`, reviewers only), Raid-Debuffs (summary + debuff × boss matrix), Raid-Buffs, Heiler, and — new, they had no place before — the raid-wide **Cooldown, Aktivität, Totem and Mechaniken & Tode summaries** (`renderCooldownSummary` etc. over `report.cooldowns/activity/totems/mechanics`), then Sunder, Boss-Uptimes, Consumables, Tränke, Drums, Shadow-Resi, Gear-Probleme and the RPB parts (Schaden & Tode, Aktivität, Zauber, Cooldowns, Interrupts, Log-Prüfung) with their role sub-tabs untouched. The existing `render*Panel` functions are reused, only hung in differently.
- **Sicht Bosse** (`renderBossView` → `bossCard`) is one `<details class="boss-card">` per boss (`groupByBoss`), the first open: WCL icon (the Anniversary realms log the bosses under offset encounter ids — 50xxx for Karazhan/Gruul/BT/Hyjal, 100xxx for SSC/TK — which `config/bosses.js`'s `baseEncounterId()` folds back onto the icons and names), name, meta line (tries, wipe %, kill time, deaths) and chips (`bossChips`: expected debuffs that were missing, players short of buffs, never-removed debuffs, the kill's mean raid DPS). Open: the try pills, the **Kennzahlenzeile** (`fightStats`: Raid-DPS/HPS from `series`, Bloodlust from `cooldowns.lust`/`windows` with the spread, mean activity, expected/missing debuffs, deaths with the first one named), the section buttons (`.sec`, one per `fightParts()` topic, with a tone dot and a sub line such as "1 fehlt" or "100 % genutzt"), and under them **the topic's compact table first**; the chart sits behind "Verlauf öffnen ⤢" in a `<dialog>` (`chartDialog`, the VerlaufFenster mock-up) — list-only topics (deaths, the raid's buff list) have no dialog, the healing topic keeps the numbers in the card and the mana curves/tank auras in the dialog, the DPS/HPS strip is its own "Kampfverlauf" topic. Below the sections, "Empfehlungen zu diesem Boss" lists the raid recommendations whose title, text or evidence names the boss (`bossRecommendations`), omitted when none does.
- **Sicht Raider** (`renderRaiderView` → `raiderCard`) is a search field and a role segment (Alle / Tank / Heiler / DPS / Offen — filtered client-side on the cards' `data-name`/`data-role`/`data-open`; the role comes from `reportContext().roleOf`: healer of `report.healers`, WCL's tank of any fight, the RPB's roles as fallback, else DPS), "Alle aufklappen/zuklappen", and one closed `<details class="raider-card">` per roster entry: class icon, name in class colour, role, fight count, chips (gear issues, consumable %, buffs missing, activity % or — for a healer — overheal % and low-mana fights, the dip chip, recommendations n · offen m). Open: section buttons for **Empfehlungen** (the `recItem` cards with the verdict controls for a reviewer), **Gear** (issues + the paperdoll), **Consumables & Tränke**, **Buffs** (the raider's row of the raid-buff matrix spelled out), **Heilung & Mana** (healers only), **Aktivität & Cooldowns** (the raid-wide summaries' rows for this raider), **Schaden & Tode** (the CLA mechanics summary and the RPB's per-player rows) and **Kampfverlauf** (a button opening a dialog with `renderPlayerTimeline`, ids namespaced `r<idx>-` so a fight can sit on the page once per raider next to the boss card's copy). For a reviewer the footer says "n freigegeben · m offen · zuletzt gesendet …" and holds "KI-Formulierung erzeugen" (the phrasing job for this raider only — `PHRASE_SCRIPT` reads `data-name` and sends `players: [name]`) and "Vorschau & senden".
- **The send dialog** (`sendDialog`, the SendeFenster mock-up; reviewers only) lists the raider's *approved* points, each with a text choice KI-Text / Regeltext / Eigener (the segment switches the textarea, only "Eigener" is editable; the open points are counted as "wird nicht gesendet"), the DM preview on the right (the head, the point list, the link to their page — refreshed on every edit), and "Nur speichern" (own texts go through `POST /api/cla/recommendations` with `text`; choosing KI/Regel again clears a saved own text with `text: ""`) / "Per Bot senden" (saves, then `POST /api/cla/recommendations/send` with `players: [name]`; an already-sent, unchanged set answers with the reason and offers "Trotzdem erneut senden" = `force`). Both endpoints already took `players`; nothing changed server-side.
- **The player page** (`/r/<id>/p/<idx>`, `renderPlayerPage`) is the same raider card, opened (`raiderCard(ctx, p, idx, { open: true, inline: true })`), with the Kampfverlauf inline under it (`renderPlayerTimeline(timeline, name, "p-")`, charts stacked under their tables instead of dialogs) — one layout, not two.

`test/web/renderReportCards.test.js` covers the views, the cards, the dialogs and the reviewer/reader split; the older `test/web/render*.test.js` files assert the same content at its new place (`id="rs-<section>"` for a raid section, `class="sec"` buttons for a topic, `p-` / `r<idx>-` prefixed ids on the player page and in the raider dialogs).

**The raid DPS/HPS strip and the boss-health line come from the WCL v2 API, and only from there.** `utils/logcheck/fightSeries.js` writes `timeline.fights[].series = { step, dps, hps, bossHp }` (5-s buckets, compact arrays of equal length — a ten-minute fight is 121 values each; a council fight adds `bossHpTargets` per boss, the line itself is their mean), which `render.js`'s `fightSeries()` draws above the topic switch. **The same `graph` answer carries one series per source, so `series.players = [{ name, type, dps?, hps? }]` keeps every roster player's own curve on the same buckets at no extra request** (mapped through `idToPlayer` by actor id, a pet added to its owner only where the series names one — WCL folds pets into their owner by default — and every other source dropped); the player page's `playerSeries()` draws it against the raid mean per player (raid series ÷ players with a curve) with the own death and Bloodlust as marks, and `summarizeFightSeries()` writes `report.fightSeries` (own CLA field): per raider the share of the fight (alive) their output sat below half their own mean, the "Einbrüche" chip and the `series.dips` recommendation (DPS only, thresholds in `recommendationRules.js`). The data is the binned `report.graph` (DamageDone/Healing, `classes/warcraftlogsV2.js` documents the schema pieces used) and, for the boss health, the *enemies'* damage events with `includeResources: true` — a boss swings every couple of seconds, so a few hundred events give a sample every few seconds where the friendly damage events would be tens of thousands. Three things are deliberate: the `graph` values are calibrated against the series' own `total` (`asRate()`), because the schema does not say whether a point is a rate or the amount per bin; boss health is *measured*, never interpolated — a bucket holds the last sample the log saw, the first bucket takes the first sample rather than an assumed 100 %, and only a kill's final bucket is forced to 0; a log without hit points (no advanced combat logging) leaves `bossHp` null instead of a line drawn from `fightPercentage`. **The access is optional and lives in the settings** (Einstellungen → Verbindungen → *Warcraft Logs*, `config.warcraftlogsV2`, the secret masked like the Anthropic key): without it the series is `null`, the tab says once what is missing, nothing fails. **The v1 key in `.env` stays for everything else** — the v2 client is not a replacement, it fetches exactly what v1 cannot bin.

**Healers are judged by their own yardstick** (`config/healerSpells.js` holds the aura and energize ids, `config/recommendationRules.js`'s `healers` block the thresholds). Three things there are deliberate: a healer's activity is only a finding far below the DPS threshold and their holes never are — waiting is the job; "dispellable" is defined by the log itself (an aura somebody dispelled once counts, an application of it that ran its course untouched is a missed dispel), because a per-boss table would be wrong more often than the log; and the mana curve reads both event shapes WCL has used (`classResources` lists and `sourceResources` objects) and says *no curve in the log* when neither is there, rather than drawing a flat line.

**Recommendations** (`utils/logcheck/recommendations.js`, thresholds in `config/recommendationRules.js`) are plain rules over the finished report — per raider and for the raid, with impact, text and evidence; a missing source yields nothing, never a false "alles gut". They are rebuilt on every build; what the raid lead approved or rewrote lives beside them in `recommendationReview` and survives the rebuild. **Nothing reaches a raider unapproved**: `web/recommendationSend.js` DMs only approved points (character → Discord account from `raiderCharactersStore`, ambiguous names reported, an unchanged set never sent twice), and `utils/logcheck/recommendationText.js` only *phrases* them with Claude (key in Einstellungen → Verbindungen; the key never goes back to the browser) — the raid lead's own text beats the model's, the model's beats the rule's.

### Loot import (Gargul/RCLootcouncil)

`src/utils/lootImport.js` normalizes all export formats to one loot-item shape (`parseLoot`/`parseGargul`/`parseRclc`/`parseEventHelper`). `enrichItemNames(items)` fills in `itemName`/`itemIconUrl` that an export didn't carry (Gargul gives neither, RCLootcouncil gives a name but no icon) via `src/utils/wowhead.js`'s `lookupItem(itemId)` (Wowhead's tooltip endpoint, in-memory cached, best-effort — mock it in tests). Call it once, right after `parseLoot()` — the import handlers are `apiRoutes/history.js`'s `importLoot` (JSON, called from the React client's Historie-&-Loot and Raid-Detail Loot-tab imports) and `apiRoutes/ingest.js`'s `ingestLoot` (below).

### Addon loot sync (`/api/ingest/loot` → Addon-Inbox)

A companion WoW addon (own repo: **eventhelper-addon**) reads the in-game history of *both* loot addons and uploads it, so nobody has to click through two export dialogs. WoW's Lua sandbox has no network access at all, so the chain is: addon → its own SavedVariables → a Node sync tool on the raidleader's PC → `POST /api/ingest/loot`.

- **Wire format** `eventhelper-loot` v1 (`EH_FORMAT`/`EH_VERSION` in `lootImport.js`): an envelope of raid *sessions*, each with items carrying a real unix `awardedAt`. That timestamp is the point — Gargul's own CSV has a date but no time of day, which makes matching a raid night guesswork. A payload from a newer addon than the server knows is refused, never half-read.
- **Item `source` stays `"rclc"`/`"gargul"`**, so an addon upload and a hand-pasted export of the same award share the dedup key (`source` + `rawId` = RCLootcouncil's `id` resp. Gargul's `checksum`) and collapse into one item.
- **Auth is a bearer token**, not a Discord session — the uploader runs unattended. `src/web/ingestTokenStore.js` stores tokens sha256-hashed, shows the secret exactly once, and revokes immediately. Minted in Einstellungen → *Loot-Sync* (full admins only). `apiAccess.js`'s `TOKEN_AUTH` set exempts *only* this one path from the session gate; the handler checks the token itself before doing any work.
- **Which raid a session was** is resolved in `src/web/lootSessionContent.js`, not taken at face value. The addon's reported instance wins — it saw the instance at award time — but it is blank for a Gargul-only night (Gargul stores no instance) and is a mere continent when RCLootcouncil recorded the award outside the instance ("Eastern Kingdoms" for a Karazhan night). In both cases the raid is derived from the item ids via `config/tbcContent.js`. Deliberately allowed to name more than one raid: TBC nights combine them (SSC + TK, Gruul + Magtheridon), so a single answer would be a false one. The inbox marks a derived name as such.
- **Nothing lands in the history unconfirmed.** An upload becomes a *pending session* in `src/web/lootInboxStore.js`, shown on the *Addon-Inbox* page (`/history/inbox`) with the Raid-Helper event it was matched to (a suggestion; an ambiguous day shows every candidate and preselects nothing). Accepted sessions stay listed below the cards ("Verknüpft", `lootInboxStore.listLinked()`), with the items later uploads appended by themselves (`noteAppended()`). Accepting files it and is **remembered**: later uploads of that session append straight to the same event, which is how the rest of a raid night arrives without a second click. Dismissing is remembered too, so a discarded session cannot reappear. Re-uploads of a pending session merge into the one card instead of stacking up — the sync tool re-sends the whole raid on every SavedVariables flush, so that is the normal case.

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
