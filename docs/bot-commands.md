# Befehle des Bots

## How the Command System Works

`bot.js` uses `client.on("ready")` to call `loadCommands("./commands")`, which reads every `.js` file from every subfolder of `src/commands/`. Each file must export:

```javascript
module.exports = {
    name: "commandname",       // Must match the slash command name registered in Discord
    description: "...",        // German, shown in Einstellungen → Berechtigungen → Bot-Befehle
    group: "raids",            // a group id from src/config/botCommands.js
    defaultAccess: "admins",   // "everyone" | "admins" | { roles: [roleId, …] }
    async execute(interaction, client) {
        // ...
    },
};
```

A button, select or modal that belongs to a command declares `accessOf: "<command name>"` instead of `group`/`defaultAccess` and inherits that command's access.

**Language of the bot's texts:** whatever a **raider** reads in Discord is **English** — event and setup messages, every signup step, DMs, reminders, the talk overview, `/profil`, the access refusal (`botAccess.denyMessage`); dates as Discord timestamps. German messages of the shared services go through `utils/botEnglish.js` `toEnglish()` at the bot boundary. **Orga/admin texts stay German for now** (`/event`, event management, auctions, GDKP, logcheck, lookups), and so do the `description` fields above and the slash-command descriptions in `scripts/register-commands.js`. Stored keys never change. Details and the list of surfaces: [signups.md](signups.md) („Sprache im Discord“).

The `name` field is used as the lookup key in `client.commands`. This same mechanism handles both slash commands (`interaction.commandName`) and button interactions (`interaction.customId`). The button custom IDs in `createOverview.js` (`update-events`, `show-signups`, `show-mysetups`, `show-allsetups`) must exactly match the `name` fields of the corresponding command files.

The router (`handleInteraction` in `bot.js`) passes slash commands, buttons, modals and **every select menu kind** (string, user, role, channel, mentionable) to `execute()`, looked up by `name` or by the customId before `:`. **Autocomplete** goes to the command's optional `autocomplete(interaction)` instead; a command without one (or one that throws) answers an empty list — Discord allows no other reply to an autocomplete.

### Who may run a command (bot command access, issue #252)

**Access is checked once, in `bot.js`, before `execute`** — `guardInteraction()` from `src/web/botAccess.js`. No command file checks permissions itself anymore; `checkForPermission` is gone. The order is: **admin** (`ADMIN_USER_ID`/`LOGCHECK_ADMIN_IDS` or an admin role from *Zugang*) → the setting stored in `config.botCommandAccess = { [commandName]: { mode, roleIds } }` → the file's `defaultAccess` → **admin-only (fail-closed)**. `resolveBotAccess(commandName, member, { commands, config })` is the pure part and is what the tests drive.

- **Buttons, selects and modals inherit** through `accessOf`; there is no separate setting per component, and a rule stored under a component's own name is ignored. The `apply` button is the one exception with its own `defaultAccess: "everyone"`: it is posted by admin-only commands but must be usable by every applicant.
- **Roles are resolved against the event guild** (`eventGuildId()` in `botAccess.js`: `config.eventGuildId`, else `config.guildId`), whichever server the interaction came from — the interaction's own member when it happened there, else the cached member list (`discord.fetchGuildMembersCached`), else a single fetch; a failed lookup means no roles, never an exception. A rule of `"everyone"` asks Discord nothing.
- **A refusal** is one ephemeral line: „Dafür brauchst du @Orga oder @Raidleiter.“ resp. „Dieser Befehl ist Admins vorbehalten.“ (an autocomplete gets an empty choice list).
- **Configured** in Einstellungen → Berechtigungen, segment *Bot-Befehle* (`?perm=bot`, `components/BotCommandAccess.tsx`, rules in `lib/botCommandAccess.ts`): one folded line per group, a modal per command (Jeder · Nur Rollen · Nur Admins, the default with „Zurücksetzen“, „für alle Befehle der Gruppe übernehmen“). A rule equal to the default is not stored, so a later change of `defaultAccess` still reaches it. Data from `GET /api/bot-commands` (full admins; groups, commands with default/stored/effective rule and what inherits it, the event guild's roles with member counts); saved via `PATCH /api/settings { botCommandAccess }` — full-admin-only (`ACCESS_KEYS`), normalised by `normalizeBotCommandAccess()` in `src/config/botCommands.js` (invalid role ids dropped, a role rule without roles becomes admins).
- `test/commands/access.test.js` scans every command file: `defaultAccess` + a known `group`, or an `accessOf` pointing at a real command — never both, never neither.
- The legendary-role check in `utils/auction.js` stays: it is a rule of the auction, not a permission.

When adding a new command:
1. Create the file in the appropriate `src/commands/<category>/` folder, with `group` + `defaultAccess` (or `accessOf` for a component)
2. Add its definition to `scripts/register-commands.js` and re-run `npm run register` — it registers for **every configured server** (event + talk, see docs/discord-servers.md), `--guild <id>` for exactly one, `--global` globally. Requiring the script does nothing; only running it talks to Discord.

### Lookups with a link into the web menu (issue #265) and `/kanal` (#259)

Short answers in Discord, the big view one click away: every reply is **ephemeral**, one compact embed (the headline number large, a few lines of detail) and an „Im Web öffnen“ link button to the page with the full view (`publicBaseUrl` from `config/variables.js`, i.e. `PUBLIC_BASE_URL`). The shared pieces — `lookupReply()`, `clampEmbed()` (Discord's embed limits), `linkRow()`, `respondChoices()` (autocomplete, ranked and capped at 25), `discordTime()` — are in `src/utils/botLookup.js`. **No second logic:** the data comes from the functions the API uses.

| Command | Default | Reads | Links to |
|---|---|---|---|
| `/loot ich · item <Item> · raider <Name>` | everyone | `lootStore.listByCharacter`, `lootStats.itemCatalog`, `web/userCharacters.js` | `/history/char?name=`, `/history?tab=items` |
| `/raids` | everyone | `web/eventLookup.js` → `loadEventGroups()` (so own events from #254 arrive too) | `/raids` |
| `/raid <Event>` | everyone | same, with the lookback window | `/raids/detail?event=`, the Discord channel |
| `/anwesenheit` | everyone | `web/attendanceLookup.js` → `rosterAttendance` (own characters only) | `/roster/char?name=` |
| `/anwesenheit-raider <Name>` | admins | same, any character | `/roster/char?name=` |
| `/report` | everyone | `reportStore.listReports` + `reportList.prepareReportList` | `/r/<id>` |
| `/council <Item>` | admins | `tbcLootNames.RAID_ITEMS` + `lootStats.itemCatalog` | `/lootcouncil/drop/<itemId>` |
| `/kanal umbenennen · archivieren · anlegen` | admins | `discordChannels.js`, `channelArchiveStore.js`, `utils/channelNames.js` | `/channels` |

- „Mein" is `web/userCharacters.js`'s `myCharacters()`: the raider→character assignment (Einstellungen → Kategorien, `charactersForUser()`) first, then the characters from the raider's own profile (`/profil`, #255). Without either the reply says so instead of guessing from names.
- Own attendance and others' are **two commands** because access is per command: everyone may see themselves, the raid lead decides who sees others.
- `/kanal` never deletes (that stays in the menu, from the archive); archiving logs who did it like the page does, `anlegen` takes a name or a schema (`{tag}-{dd}-{mm}-{raid}`; empty = named and copied like the category's previous event channel, #285) plus `datum` (`24.09.` or `2026-09-24`).
- **Autocomplete passes the access gate too** (`handleAutocomplete` in `bot.js`): a command someone may not run does not list its items or raiders to them. `test/commands/access.test.js` checks every registered autocomplete option has a handler.

## Core Utilities

### `botReply(interaction, title, message, timeout, ephemeral, components)`
Standard way to send a Discord reply. Sends an embed with `title` and `description`. Default: ephemeral=true, timeout=60000ms (auto-deletes). Pass `timeout=0` to keep permanently.

### `botEditReply(interaction, title, message, ...)`
Used after `interaction.deferReply()`. Call this when the command needs more than 3 seconds to respond.

### `bidForLegendary(client, interaction, gold)`
Core bidding logic in `utils/auction.js`. Validates the user has the legendary role, checks auction exists, validates the bid amount, calls the API, updates the highest bids overview message, and handles extended auction time.

### `getRaidInfosFromChannel(interaction)`
Returns `{ raidData, setupData }` for the event in the current channel.

## API Clients

**`classes/raidhelper.js` (Raidhelper):** Uses raw `https` module. API key and server ID come from `process.env.RAIDHELPER_API_KEY` and `process.env.RAIDHELPER_SERVER_ID` via the constructor. Key methods: `getAllEvents()`, `getUserSignUps(userid)`, `getEvent(eventid)`, `getSetup(raidid)`, `signUpToRaid(raidid, signUps, userid)`, `saveRaid(data)`.

**`classes/gdkp.js` (GDKP):** Axios client. `getTotalItems(userid)` returns all items bought by a player.

**`classes/legendary.js` (Legendary):** Axios client. Methods for CRUD on auctions and bid placement. All point to `${API_BASE_URL}/legendary`.

Both Axios clients use the shared `utils/httpAgent.js` which enables SSL cert verification only in `NODE_ENV=production`.

## Common Patterns

### Deferred replies for slow operations
```javascript
await interaction.deferReply({ ephemeral: true });
// ... async work ...
await botEditReply(interaction, "Title", "Result");
```

### Permission-gated commands
Nothing in the command: declare `defaultAccess` (and `group`) in its module and let `bot.js` check it — see "Who may run a command" above.

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
