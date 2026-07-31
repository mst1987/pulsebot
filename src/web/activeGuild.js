// Shared by server.js's SSR routes and apiRouter.js's JSON routes: which guild
// the admin is currently managing.
const discord = require("./discord");
const auth = require("./auth");
const { getConfig } = require("./settingsStore");

/**
 * The server the admin is managing, in this order:
 *   1. the guild explicitly selected in this session (the topbar switcher),
 *   2. the configured guild (Einstellungen → Zugang, default in
 *      config/variables.js) — the guild this bot is installed in, so it is what
 *      the switcher shows without anyone picking a server first,
 *   3. the bot's only guild, when it is in exactly one.
 * The configured guild only counts when the bot is actually a member of it:
 * otherwise every request would carry a guild id whose channels/roles can never
 * be loaded, which reads as "everything is empty" instead of "wrong server".
 */
function activeGuildFor(req) {
    const selected = auth.getActiveGuild(req);
    if (selected) return selected;
    const guilds = discord.listGuilds();
    const configured = String(getConfig().guildId || "").trim();
    if (configured && guilds.some((g) => g.id === configured)) return configured;
    return guilds.length === 1 ? guilds[0].id : "";
}

module.exports = { activeGuildFor };
