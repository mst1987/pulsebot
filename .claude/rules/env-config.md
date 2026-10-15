---
paths:
  - "src/bot.js"
  - "src/config/**"
  - ".env.example"
---

# Environment and config

`src/bot.js` loads `.env.dev` from the project root when it exists, otherwise `.env` (both
git-ignored). Scripts read the env file relative to the working directory, so run them from the
project root. Only these are needed to run at all; everything else (Google, Warcraft Logs, Blizzard,
OAuth, …) is optional and listed with its purpose in `.env.example`. Most server settings (servers,
channels, roles, rights) live in the web settings, not here.

```
DISCORDJS_BOT_TOKEN=    # Bot token (without it only the web server runs)
CLIENT_ID=              # Discord application id
ADMIN_USER_ID=          # Bootstrap admin who can always log in and configure the rest
DISCORD_CLIENT_SECRET=  # "Login with Discord" on the web (not needed with DEV_AUTO_LOGIN=1 locally)
NODE_ENV=production     # On the server: TLS verification on, dev shortcuts off
```

- Do not move `.env` / `.env.dev` out of the project root without also updating the
  `dotenv.config()` call in `src/bot.js` (and `src/web-client/vite.config.ts`, which mirrors it).
- `DEV_AUTO_LOGIN=1` auto-logs-in the first admin and is hard-gated to non-production
  (`src/config/variables.js`), so it can never weaken auth on the live bot.
- The web server boots **independently of the Discord gateway** (`src/bot.js` `start()`): it comes
  up first, then the bot logs in best-effort. A missing/invalid token or an offline Discord only
  disables the Discord-backed features (guild/channel/role lists, posting) — the admin menu and
  report pages stay reachable.
- Generated data under `src/config/generated/` is never edited by hand — the generators live in
  `scripts/` (`scripts/README.md`).
