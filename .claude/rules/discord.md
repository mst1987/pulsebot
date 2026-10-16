---
paths:
  - "src/commands/**"
  - "src/services/discord/**"
  - "src/utils/discord/**"
  - "src/utils/i18n/**"
  - "src/config/botText/**"
  - "scripts/register-commands.js"
---

# Discord layer: commands, interactions, bot texts

How the command system works, who may run what, the reply helpers and common patterns:
[docs/bot-commands.md](../../docs/bot-commands.md).

- **No slash command without a `data` definition** in its command module (`src/commands/loader.js`
  collects it for the bot and for `scripts/register-commands.js`), and re-run `npm run register`
  afterwards. `npm run register` registers to the guild (instant), `npm run register:global`
  globally (takes ~1 hour), `npm run register:clear` removes all guild slash commands.
- **Never `interaction.reply()` after `interaction.deferReply()`** — use `botEditReply` or
  `botFollowup` instead. Acknowledge first (`deferReply`/`deferUpdate`/`showModal`), then check:
  Discord's 3-second limit.
- **Language of bot texts:** a text a raider reads in Discord is written in English in the code and
  goes through `tr(lang, "…")` (`src/utils/i18n/botText.js`, German catalog in `src/config/botText/de/`):
  **German by default**, public messages in the server language (`botLanguage`), personal ones in
  the reader's own choice (`/language`, the web's DE/EN switch). Dates as Discord timestamps;
  orga/admin texts in the bot stay German. Details: docs/bot-commands.md („Sprache des Bots“).
- Discord interactions and the API clients are never hit for real in tests: `mockInteraction()`
  from `test/helpers/mockInteraction.js`; assert on which helper (`botReply`/`botEditReply`) was
  called with which arguments.
