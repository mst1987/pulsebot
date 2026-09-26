# Befehle des Bots

Endnutzer-Sicht: siehe [guide-discord.md#anmeldung](guide-discord.md#anmeldung), [guide-discord.md#übersicht--nachschlagen](guide-discord.md#übersicht--nachschlagen).

## How the Command System Works

`bot.js` `start()` calls `loadCommands()`, which reads every `.js` file from every subfolder of `src/commands/` through the shared loader `src/commands/loader.js` (`loadCommandModules()`). Files directly in `src/commands/` (the loader, `componentRoute.js`) and folders starting with `_` are not modules. **A name used twice throws** at start — before #413 the second file silently replaced the first. Each file must export:

```javascript
module.exports = {
    name: "commandname",       // Must match the slash command name registered in Discord
    description: "...",        // German, shown in Einstellungen → Berechtigungen → Bot-Befehle
    group: "raids",            // a group id from src/config/botCommands.js
    defaultAccess: "admins",   // "everyone" | "admins" | { roles: [roleId, …] }
    data: new SlashCommandBuilder()   // only a slash command / context menu: what Discord registers
        .setName("commandname")
        .setDescription("..."),
    async execute(interaction, client) {
        // ...
    },
};
```

A button, select or modal that belongs to a command declares `accessOf: "<command name>"` instead of `group`/`defaultAccess` and inherits that command's access. A component that only hands the interaction to its logic in `src/web/` is built with `componentRoute({ name, description, accessOf, handler })` from `src/commands/componentRoute.js` (checks the event server via `guildFor` first; `guild: false` skips that, `onGuildError: "update"` answers by replacing the message).

**Commands and components:** a module with `data` is a **command** (slash command or context menu), one without is a **component** — `kindOf()` in `loader.js`. Both sit in `client.commands`, keyed by name resp. customId prefix; the router lets a slash command, context menu or autocomplete reach only a command, a button/select/modal reaches either (the overview buttons call `update-events` etc.). A few components carry their own `group` because they are the entry point of a flow (`apply`, `event-btn`, `event-join`, `event-signup`, `talk-signup`); `test/commands/loader.test.js` keeps that list explicit.

**Language of the bot's texts:** whatever a **raider** reads in Discord is **English** — event and setup messages, every signup step, DMs, reminders, the talk overview, `/profil`, the access refusal (`botAccess.denyMessage`); dates as Discord timestamps. German messages of the shared services go through `utils/signup/botEnglish.js` `toEnglish()` at the bot boundary. **Orga/admin texts stay German for now** (`/event`, event management, logcheck, lookups), and so do the `description` fields above and the slash-command descriptions in the modules' `data`. Stored keys never change. Details and the list of surfaces: [signups.md](signups.md) („Sprache im Discord“).

The `name` field is used as the lookup key in `client.commands`. This same mechanism handles both slash commands (`interaction.commandName`) and button interactions (`interaction.customId`). The button custom IDs in `createOverview.js` (`update-events`, `show-signups`, `show-mysetups`, `show-allsetups`) must exactly match the `name` fields of the corresponding command files.

The router (`handleInteraction` in `bot.js`) passes slash commands, buttons, modals and **every select menu kind** (string, user, role, channel, mentionable) to `execute()`, looked up by `name` or by the customId before `:`. **Autocomplete** goes to the command's optional `autocomplete(interaction)` instead; a command without one (or one that throws) answers an empty list — Discord allows no other reply to an autocomplete.

### Who may run a command (bot command access, issue #252)

**Access is checked once, in `bot.js`, before `execute`** — `guardInteraction()` from `src/services/discord/botAccess.js`. No command file checks permissions itself anymore; `checkForPermission` is gone. The order is: **admin** (`ADMIN_USER_ID`/`LOGCHECK_ADMIN_IDS` or an admin role from *Zugang*) → the setting stored in `config.botCommandAccess = { [commandName]: { mode, roleIds } }` → the file's `defaultAccess` → **admin-only (fail-closed)**. `resolveBotAccess(commandName, member, { commands, config })` is the pure part and is what the tests drive.

- **Buttons, selects and modals inherit** through `accessOf`; there is no separate setting per component, and a rule stored under a component's own name is ignored. The `apply` button is the one exception with its own `defaultAccess: "everyone"`: it is posted by admin-only commands but must be usable by every applicant.
- **Roles are resolved against the event guild** (`eventGuildId()` in `botAccess.js`: `config.eventGuildId`, else `config.guildId`), whichever server the interaction came from — the interaction's own member when it happened there, else the cached member list (`discord.fetchGuildMembersCached`), else a single fetch; a failed lookup means no roles, never an exception. A rule of `"everyone"` asks Discord nothing.
- **A refusal** is one ephemeral line: „Dafür brauchst du @Orga oder @Raidleiter.“ resp. „Dieser Befehl ist Admins vorbehalten.“ (an autocomplete gets an empty choice list).
- **Configured** in Einstellungen → Berechtigungen, segment *Bot-Befehle* (`?perm=bot`, `components/BotCommandAccess.tsx`, rules in `lib/botCommandAccess.ts`): one folded line per group, a modal per command (Jeder · Nur Rollen · Nur Admins, the default with „Zurücksetzen“, „für alle Befehle der Gruppe übernehmen“). A rule equal to the default is not stored, so a later change of `defaultAccess` still reaches it. Data from `GET /api/bot-commands` (full admins; groups, commands with default/stored/effective rule and what inherits it, the event guild's roles with member counts); saved via `PATCH /api/settings { botCommandAccess }` — full-admin-only (`ACCESS_KEYS`), normalised by `normalizeBotCommandAccess()` in `src/config/botCommands.js` (invalid role ids dropped, a role rule without roles becomes admins).
- `test/commands/access.test.js` scans every command file: `defaultAccess` + a known `group`, or an `accessOf` pointing at a real command — never both, never neither.

When adding a new command:
1. Create the file in the appropriate `src/commands/<category>/` folder, with `group` + `defaultAccess` (or `accessOf` for a component)
2. Give it `data` (a `SlashCommandBuilder`, or a `ContextMenuCommandBuilder` for a context menu — no magic option numbers) and re-run `npm run register`. The definition lives **only in the module**: `scripts/register-commands.js` collects the `data` of every module with the same loader the bot uses (`commandDefinitions()`), prints the names it registers and puts them on **every configured server** (event + talk, see docs/discord-servers.md); `--guild <id>` for exactly one, `--global` globally, `--clear` removes them, `--dev` reads `.env.dev`. Requiring the script does nothing; only running it talks to Discord.
3. `test/commands/loader.test.js` checks that every command is collected exactly once, that every `accessOf` points at a module with `group`, and that every backticked `/befehl` in [guide-discord.md](guide-discord.md) exists.

### Lookups with a link into the web menu (issue #265) and `/kanal` (#259)

Short answers in Discord, the big view one click away: every reply is **ephemeral**, one compact embed (the headline number large, a few lines of detail) and an „Im Web öffnen“ link button to the page with the full view (`publicBaseUrl` from `config/variables.js`, i.e. `PUBLIC_BASE_URL`). The shared pieces — `lookupReply()`, `clampEmbed()` (Discord's embed limits), `linkRow()`, `respondChoices()` (autocomplete, ranked and capped at 25), `discordTime()` — are in `src/utils/discord/botLookup.js`. **No second logic:** the data comes from the functions the API uses.

| Command | Default | Reads | Links to |
|---|---|---|---|
| `/loot ich · item <Item> · raider <Name>` | everyone | `lootStore.listByCharacter`, `lootStats.itemCatalog`, `services/characters/userCharacters.js` | `/history/char?name=`, `/history?tab=items` |
| `/raids` | everyone | `services/events/eventLookup.js` → `loadEventGroups()` (so own events from #254 arrive too) | `/raids` |
| `/raid <Event>` | everyone | same, with the lookback window | `/raids/detail?event=`, the Discord channel |
| `/anwesenheit` | everyone | `services/characters/attendanceLookup.js` → `rosterAttendance` (own characters only) | `/roster/char?name=` |
| `/anwesenheit-raider <Name>` | admins | same, any character | `/roster/char?name=` |
| `/report` | everyone | `reportStore.listReports` + `reportList.prepareReportList` | `/r/<id>` |
| `/council <Item>` | admins | `tbcLootNames.RAID_ITEMS` + `lootStats.itemCatalog` | `/lootcouncil/drop/<itemId>` |
| `/kanal umbenennen · archivieren · anlegen` | admins | `discordChannels.js`, `channelArchiveStore.js`, `utils/channelNames.js` | `/channels` |

- „Mein" is `services/characters/userCharacters.js`'s `myCharacters()`: the raider→character assignment (Einstellungen → Kategorien, `charactersForUser()`) first, then the characters from the raider's own profile (`/profil`, #255). Without either the reply says so instead of guessing from names.
- Own attendance and others' are **two commands** because access is per command: everyone may see themselves, the raid lead decides who sees others.
- `/kanal` never deletes (that stays in the menu, from the archive); archiving logs who did it like the page does, `anlegen` takes a name or a schema (`{tag}-{dd}-{mm}-{raid}`; empty = named and copied like the category's previous event channel, #285) plus `datum` (`24.09.` or `2026-09-24`).
- **Autocomplete passes the access gate too** (`handleAutocomplete` in `bot.js`): a command someone may not run does not list its items or raiders to them. `test/commands/access.test.js` checks every registered autocomplete option has a handler.

## Core Utilities

`src/utils/` is split by area (#427); a new helper goes into the folder of its area, not next to it:

| Folder | What lives there |
|---|---|
| `utils/discord/` | `reply.js`: `botReply`, `botEditReply`, `botFollowup`, `findServerEmoji`, `getCharacterIcon`; `botLookup.js`: the embeds of the lookup commands (`lookupReply`, `linkRow`, `respondChoices`, …) |
| `utils/signup/` | Signup buttons, dialog, multi-signup, join picker, character-name rule, `botEnglish.js` (German service messages → English) |
| `utils/setup/` | Setup proposal (`model`, `proposal`, `score`, …), `fillSetup.js`, `setupView.js`, `raidsheets.js`, `sheetCleanup.js`, `response.js` (the line per raid of `/mysetups`) |
| `utils/raidhelper/` | `client.js` (`createRaidhelperClient`, switch-off), `fixture.js` (dev stand-in), `queries.js` (signups/setups of a category), `channelEvents.js` (events of a category from both sources) |
| `utils/loot/` | `lootImport.js`, `lootReasons.js`, `softres.js`, `wowhead.js` |
| `utils/logcheck/` | The log analyzers and `wclRoster.js` (docs/logcheck.md) |
| `utils/recruitment/` | `recruitmentSpecs.js`, `applicationState.js` |
| `utils/time/` | One module (`index.js`): German date formats and parsers, Discord timestamps and server-time texts, raid duration (`clampDuration`, `eventEndTime`); the zone is `config/timezone.js` |
| `utils/wowsims/` | The WoWSims engine and presets |
| flat | `format.js` (`formatSpecs`, `formatSignUps` of `/signup`), `text.js`, `ids.js`, `publicUrl.js`, `httpAgent.js`, `attendance.js`, `channelNames.js` |

### `botReply(interaction, title, message, timeout, ephemeral, components)`
Standard way to send a Discord reply (`utils/discord/reply.js`). Sends an embed with `title` and `description`. Default: ephemeral=true, timeout=60000ms (auto-deletes). Pass `timeout=0` to keep permanently.

### `botEditReply(interaction, title, message, timeout, ephemeral, components)`
Used after `interaction.deferReply()`. Call this when the command needs more than 3 seconds to respond. `timeout` and `ephemeral` have no effect on an edit; they only keep `components` in sixth place.

## API Clients

**`classes/httpClient.js` is the base of every HTTP client in `src/classes`** (#429): `createClient({ service, baseURL, timeout, headers?, retry? })` is an `axios.create` instance with the shared `utils/httpAgent.js` (certificate checks only in `NODE_ENV=production`), a mandatory timeout and one response interceptor. It retries only a 5xx, a network error or a timeout, only for idempotent methods unless the client lists more (`retry.methods`), never a 4xx (default: 2 retries, 250 ms → 500 ms; `retry: { timeouts: false }` for a server that hangs rather than fails), and turns everything that still fails into an **`ApiError { service, status, code, kind, message, cause, data }`** (`kind`: `timeout` | `network` | `http` | `canceled`; `err.response` stays readable for old callers). What a failure means for the caller is each client's own contract, written in its file head — they are deliberately not unified, because the callers rely on them:

| Client | Contract |
|---|---|
| `classes/raidhelper.js` | The body decides, whatever the HTTP status. Event-list reads reject (the `status: "failed"` payload as-is, else an Error), `getTemplates` → `[]`, `getSetup` → `undefined`, `createEvent`/`getEvent` resolve the parsed body. POSTs and timeouts (20 s) are never retried. Always obtained through `utils/raidhelper/client.js` (switch-off, fixture). |
| `classes/warcraftlogs.js` (v1) | Throws the `ApiError`. The workhorse of the log check; the head lists every importer and why it stays on v1. |
| `classes/warcraftlogsV2.js` | Never throws: `null` + `lastError` (`not_configured`, `graphql`, `{ status, message }`). A 401 on a query refreshes the token once. |
| `classes/blizzard.js` | Never throws (except `getToken`): `null` + `lastError { status, message, namespace }`, so the UI falls back to the armory link. |
| `classes/anthropic.js` | Only creates the SDK client (`createAnthropicClient({ apiKey })`); the SDK has its own transport and retries. |

In tests, `test/helpers/axiosMock.js` replaces only axios' adapter (`jest.mock("axios", () => require("../helpers/axiosMock").mockAxios())`), so retry, translation and transforms run for real and no request leaves the process. The remaining direct axios users (`utils/loot/softres.js`, `utils/loot/wowhead.js`, `web/http/deployStatus.js`) use the shared agent as well.

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

