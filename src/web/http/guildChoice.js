// Which servers a person may enter and which one a request works on, given the
// server picked in its session. Shared by activeGuild.js (every route), auth.js
// (the rights of a request are those of its active server, #925) and the session
// routes (the switcher, #1074) - one rule, no require cycle.
const discord = require("../../services/discord/discord");
const { getConfig } = require("../../stores/settings/settingsStore");
const { accessSettings } = require("../../services/discord/servers/serverAccess");
const { accessForUser, hasAnyAccess } = require("../../config/permissions");

const isFullAdmin = (viewer) => !!(viewer && viewer.guildAccess && viewer.guildAccess.isAdmin);

/**
 * Whether a person may enter a server - see it in the switcher, switch to it, have it active
 * (#1074). A full admin everywhere; everybody else on a server they are a member of, or
 * where a grant of their own (Einstellungen > Berechtigungen, Einzelkonto) is configured. A
 * role only ever counts through its membership. The base access alone never counts: it says
 * what a guest may read, not that the server's name is theirs to see.
 *
 * Reads the session and the settings, never Discord: this runs on every request.
 * @param {{ id: string, guildAccess: object }|null} viewer the real session (auth.guildViewerOf)
 * @param {string} guildId
 * @returns {boolean}
 */
function mayEnterGuild(viewer, guildId) {
    if (!viewer || !guildId) return false;
    if (isFullAdmin(viewer)) return true;
    const entry = viewer.guildAccess && viewer.guildAccess.guilds && viewer.guildAccess.guilds[guildId];
    if (entry && entry.isMember) return true;
    return hasAnyAccess(accessForUser(accessSettings(guildId, getConfig()).userPermissions, viewer.id));
}

/** The bot's servers this person may enter, in the bot's order. */
function enterableGuilds(viewer) {
    return discord.listGuilds().filter((g) => mayEnterGuild(viewer, g.id));
}

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
 *
 * For a logged-in person who is no full admin (#1074) only servers they may enter count:
 * their selection when mayEnterGuild, the configured guild when it is among them, else the
 * first of them, and "" without any - never a foreign server, so its rights cannot slide
 * onto them. The stored selection stays as it is and counts again once it is allowed again.
 * @param {string|null} selected the session's own choice
 * @param {{ id: string, guildAccess: object }|null} [viewer] the real session; without one
 *   (no login) the rights are empty anyway
 * @returns {string} the guild id, "" when none fits
 */
function pickActiveGuild(selected, viewer) {
    if (!viewer || isFullAdmin(viewer)) {
        if (selected) return selected;
        const guilds = discord.listGuilds();
        const configured = String(getConfig().guildId || "").trim();
        if (configured && guilds.some((g) => g.id === configured)) return configured;
        return guilds.length === 1 ? guilds[0].id : "";
    }
    if (selected && mayEnterGuild(viewer, selected)) return selected;
    const allowed = enterableGuilds(viewer);
    const configured = String(getConfig().guildId || "").trim();
    if (configured && allowed.some((g) => g.id === configured)) return configured;
    return allowed.length ? allowed[0].id : "";
}

module.exports = { mayEnterGuild, enterableGuilds, pickActiveGuild };
