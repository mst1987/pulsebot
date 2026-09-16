// The two fixed roles a Discord server can have for this bot (issue #251):
//
//   event — the event server: event channels, Raid-Helper, the admin-role check
//   talk  — the communication server: overview, sign-up per bot, pings
//
// Both come from settingsStore's `discordServers`; an empty event server falls
// back to the old single `guildId`, an empty talk server means "one server for
// everything" — which is exactly how the bot behaved before. The web menu's
// server switcher is independent of this: it still picks any server the bot is
// on, and only shows these roles as a badge.
const discord = require("./discord");
const { getConfig } = require("./settingsStore");

/** The event server's id: `discordServers.eventGuildId`, else the old `guildId`. */
function eventGuildId(config = getConfig()) {
    const servers = (config && config.discordServers) || {};
    return String(servers.eventGuildId || (config && config.guildId) || "").trim();
}

/** The talk server's id, "" when none is set or it is the event server itself. */
function talkGuildId(config = getConfig()) {
    const servers = (config && config.discordServers) || {};
    const id = String(servers.talkGuildId || "").trim();
    return id && id !== eventGuildId(config) ? id : "";
}

/** Every configured server id, event first, without duplicates or blanks. */
function configuredGuildIds(config = getConfig()) {
    return [...new Set([eventGuildId(config), talkGuildId(config)].filter(Boolean))];
}

function isEventGuild(guildId, config = getConfig()) {
    return !!guildId && String(guildId) === eventGuildId(config);
}

function isTalkGuild(guildId, config = getConfig()) {
    const talk = talkGuildId(config);
    return !!guildId && !!talk && String(guildId) === talk;
}

/** "event" | "talk" | "" — the badge the server switcher shows at a server. */
function guildRole(guildId, config = getConfig()) {
    if (isEventGuild(guildId, config)) return "event";
    if (isTalkGuild(guildId, config)) return "talk";
    return "";
}

/**
 * One server as the settings card shows it. `connected` = the bot is on it;
 * `permissions` null = not knowable (bot offline / not on the server).
 */
function describeGuild(guildId, role) {
    if (!guildId) return null;
    const guild = discord.getGuild(guildId);
    const permissions = guild ? discord.botPermissionsIn(guildId) : null;
    return {
        role,
        id: guildId,
        name: guild ? guild.name : "",
        connected: !!guild,
        memberCount: guild && typeof guild.memberCount === "number" ? guild.memberCount : null,
        iconUrl: guild && typeof guild.iconURL === "function" ? (guild.iconURL({ size: 64 }) || "") : "",
        permissions,
        missing: permissions ? permissions.filter((p) => !p.ok).map((p) => p.label) : [],
    };
}

/** The event server's card, or null when no server is configured at all. */
function eventGuild(config = getConfig()) {
    return describeGuild(eventGuildId(config), "event");
}

/** The talk server's card, or null in the one-server setup. */
function talkGuild(config = getConfig()) {
    return describeGuild(talkGuildId(config), "talk");
}

/**
 * How many members of the event server are on the talk server too — the ones
 * who are not can only be reached by DM there. Needs the GuildMembers intent on
 * both servers; any failure comes back as `error` instead of a throw, because a
 * missing overlap must never cost anyone the settings page.
 *
 * @returns {Promise<null | { eventCount, talkCount, both, error }>} null without two servers
 */
async function memberOverlap(config = getConfig()) {
    const eventId = eventGuildId(config);
    const talkId = talkGuildId(config);
    if (!eventId || !talkId) return null;
    const eventG = discord.getGuild(eventId);
    const talkG = discord.getGuild(talkId);
    if (!eventG || !talkG) {
        return { eventCount: null, talkCount: null, both: null, error: "Der Bot ist nicht auf beiden Servern." };
    }
    try {
        const [eventMembers, talkMembers] = await Promise.all([
            discord.fetchGuildMembersCached(eventId, eventG),
            discord.fetchGuildMembersCached(talkId, talkG),
        ]);
        // Bots are no raiders; counting them would make the overlap look worse.
        const humans = (list) => new Set(list.filter((m) => !(m.user && m.user.bot)).map((m) => m.id));
        const eventIds = humans(eventMembers);
        const talkIds = humans(talkMembers);
        let both = 0;
        for (const id of eventIds) if (talkIds.has(id)) both += 1;
        return { eventCount: eventIds.size, talkCount: talkIds.size, both, error: null };
    } catch (e) {
        return {
            eventCount: null, talkCount: null, both: null,
            error: (e && e.message) || "Mitglieder konnten nicht geladen werden (GuildMembers-Intent aktiv?).",
        };
    }
}

module.exports = {
    eventGuildId, talkGuildId, configuredGuildIds,
    isEventGuild, isTalkGuild, guildRole,
    eventGuild, talkGuild, describeGuild, memberOverlap,
};
