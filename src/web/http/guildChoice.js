// Which server a request works on, given the server picked in its session.
// Shared by activeGuild.js (every route) and auth.js (the rights of a request
// are those of its active server, #925) - one rule, no require cycle.
const discord = require("../../services/discord/discord");
const { getConfig } = require("../../stores/settings/settingsStore");

/**
 * The active server, in this order:
 *   1. the guild explicitly selected in this session (the topbar switcher),
 *   2. the configured guild (Einstellungen -> Discord & Raid-Helper, default in
 *      config/variables.js) - the guild this bot is installed in, so it is what
 *      the switcher shows without anyone picking a server first,
 *   3. the bot's only guild, when it is in exactly one.
 * The configured guild only counts when the bot is actually a member of it:
 * otherwise every request would carry a guild id whose channels/roles can never
 * be loaded, which reads as "everything is empty" instead of "wrong server".
 * @param {string|null} selected the session's own choice
 * @returns {string} the guild id, "" when none fits
 */
function pickActiveGuild(selected) {
    if (selected) return selected;
    const guilds = discord.listGuilds();
    const configured = String(getConfig().guildId || "").trim();
    if (configured && guilds.some((g) => g.id === configured)) return configured;
    return guilds.length === 1 ? guilds[0].id : "";
}

module.exports = { pickActiveGuild };
