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
npm run lint           # Check code style
npm run lint:fix       # Auto-fix lint issues
npm run register       # Register slash commands to guild (instant)
npm run register:global  # Register globally (takes ~1 hour)
npm run register:clear   # Remove all guild slash commands
node src/discordcommands/raidhelper.js  # Legacy command registration script
```

## Development Workflow (for AI assistants)

These conventions are mandatory when building features in this repo:

1. **Work in a git worktree, not on the checked-out branch directly.** Create a
   dedicated worktree for each feature/task instead of committing on the branch in
   the primary working directory. This keeps the main checkout clean and isolates
   the work.
2. **Make the feature testable locally, right away.** After implementing a change,
   start whatever is needed so the user can test immediately — run the bot
   (`node src/bot.js`) so the web server on port 3005 is live, register any new
   slash commands (`npm run register:dev`), etc. Don't leave the user to figure out
   how to launch it; hand over a working, running setup and the exact URL/steps.
3. **Open a pull request as soon as a piece of work is finished — don't wait to be
   asked.** Once a task is done and verified (smoke-test + `npm run lint`), merge the
   latest `dev` into the feature branch first, then open a PR against `main` with
   `gh pr create`. Summarize what changed and how it was verified in the PR body.
4. **Clean up after merge.** Once the work is merged, stop everything that was
   started for it — kill background bot/dev processes, free port 3005, and remove
   the feature worktree — so nothing from the work process is left running or
   lingering.

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
- **No TypeScript. No test framework.**

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

## Known Issues and Gotchas

- **`saveRaid` in classes/raidhelper.js:** Uses `https.request` to connect to port 3001 on pulse-gdkp.de — this should be `http.request` as port 3001 is not TLS.
- **dotenv path:** `bot.js` uses `{ path: "../.env" }` (works when started from repo root via `npm start`). The `scripts/register-commands.js` uses plain `require("dotenv").config()` which uses CWD. Always run from project root.
- **No validation on `interaction.channel.parent`:** Commands that need a category channel must guard against `parent` being null (top-level channels have no parent).
- **`console.log(data)` in `raidhelper.js`:** `getAllEvents()` logs the raw API response to stdout on every call in legacy code paths.

## What NOT To Do

- Do not switch to ES Modules (`import`/`export`). The entire codebase is CommonJS.
- Do not add TypeScript.
- Do not hardcode Discord IDs or API keys in command or utility files — use `config/variables.js` which reads from environment variables.
- Do not use `interaction.reply()` after already calling `interaction.deferReply()` — use `botEditReply` or `botFollowup` instead.
- Do not create slash commands without also adding them to `scripts/register-commands.js` and re-running `npm run register`.
- Do not move `.env` without also updating the `dotenv.config()` call in `bot.js` (`path: "../.env"`).
