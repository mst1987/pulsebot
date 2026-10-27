// The Discord servers this bot works with (issue #251, #361; federation #890):
//
//   servers — every server, as equals (`discordServers.servers`). Each may hold
//             raids (event channels, Raid-Helper, the admin-role check).
//   links   — directed: `{ from, to, channelId }` posts the raid list of `from`
//             to channelId on `to` (from = to is allowed).
// All come from settingsStore's `discordServers`; no server at all falls back
// to the old single `guildId`. There is no separate talk server any more (#897):
// a server that used to be one is an ordinary server of the list. The web
// menu's server switcher is independent of this: it still picks any server the
// bot is on, and only shows these roles as a badge.
const discord = require("./discord");
const { getConfig } = require("../../stores/settingsStore");
const { normalizeDiscordServers } = require("../../stores/configSchema");

// getConfig() always hands over the federation shape; a block without
// `servers` (an old `eventGuilds` block handed in directly) is migrated the
// same way configSchema reads it, so every reader sees one shape.
function blockOf(config) {
    const block = (config && config.discordServers) || {};
    if (Array.isArray(block.servers)) return block;
    return normalizeDiscordServers(block, { fallbackGuildId: (config && config.guildId) || "" });
}

/** Every configured server's id, in the order they were added (fallback: the old single guildId). */
function serverIds(config = getConfig()) {
    const list = blockOf(config).servers;
    const ids = Array.isArray(list) ? list.map((s) => String((s && s.guildId) || "").trim()) : [];
    const deduped = [...new Set(ids.filter(Boolean))];
    // Bootstrap path for an install that only ever set the env GUILD_ID.
    return deduped.length ? deduped : [String((config && config.guildId) || "").trim()].filter(Boolean);
}

/** The label a server was given in the settings ("" = none). */
function serverLabel(guildId, config = getConfig()) {
    const list = blockOf(config).servers;
    const entry = Array.isArray(list) ? list.find((s) => s && String(s.guildId) === String(guildId)) : null;
    return (entry && entry.label) || "";
}

/** Every stored link `{ from, to, channelId, lang, versions }` (normalised by configSchema). */
function links(config = getConfig()) {
    const list = blockOf(config).links;
    return Array.isArray(list) ? list.filter((l) => l && l.from && l.to && l.channelId) : [];
}

/** The links whose raid list is posted on `guildId` (it is their `to`). */
function linkedSources(guildId, config = getConfig()) {
    const id = String(guildId || "");
    return id ? links(config).filter((l) => l.to === id) : [];
}

/** The links that post the raid list of `guildId` elsewhere (it is their `from`). */
function linkedTargets(guildId, config = getConfig()) {
    const id = String(guildId || "");
    return id ? links(config).filter((l) => l.from === id) : [];
}

/** Every server that may hold raids — since #890 simply every server. */
function eventGuildIds(config = getConfig()) {
    return serverIds(config);
}

/** Every configured server id (= serverIds; kept for the callers that warm or scan every server). */
function configuredGuildIds(config = getConfig()) {
    return serverIds(config);
}

function isEventGuild(guildId, config = getConfig()) {
    return !!guildId && eventGuildIds(config).includes(String(guildId));
}

/** "event" | "" — the badge the server switcher shows at a configured server. */
function guildRole(guildId, config = getConfig()) {
    return isEventGuild(guildId, config) ? "event" : "";
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

/** Every server's card, with the first link of its own as the overview target (settings UI). */
function eventGuildCards(config = getConfig()) {
    return serverIds(config).map((guildId) => {
        const card = describeGuild(guildId, "event");
        if (!card) return null;
        const first = linkedTargets(guildId, config)[0];
        const overviewGuild = first ? discord.getGuild(first.to) : null;
        return {
            ...card,
            label: serverLabel(guildId, config),
            overviewGuildId: first ? first.to : "",
            overviewChannelId: first ? first.channelId : "",
            overviewGuildName: overviewGuild ? overviewGuild.name : "",
        };
    }).filter(Boolean);
}

/**
 * How many members two servers share (#896: per role-sync pair) — same rules
 * bots do not count, and any failure comes back as `error` instead of a throw,
 * because a missing overlap must never cost anyone the settings page. Needs the
 * GuildMembers intent on both servers.
 * @returns {Promise<null | { fromCount, toCount, both, error }>} null without two different servers
 */
async function guildOverlap(fromId, toId) {
    const a = String(fromId || "");
    const b = String(toId || "");
    // One server for both: everybody is "on both", nothing to fetch.
    if (!a || !b || a === b) return null;
    const fromG = discord.getGuild(a);
    const toG = discord.getGuild(b);
    if (!fromG || !toG) {
        return { fromCount: null, toCount: null, both: null, error: "Der Bot ist nicht auf beiden Servern." };
    }
    try {
        const [fromMembers, toMembers] = await Promise.all([
            discord.fetchGuildMembersCached(a, fromG),
            discord.fetchGuildMembersCached(b, toG),
        ]);
        // Bots are no raiders; counting them would make the overlap look worse.
        const humans = (list) => new Set(list.filter((m) => !(m.user && m.user.bot)).map((m) => m.id));
        const fromIds = humans(fromMembers);
        const toIds = humans(toMembers);
        let both = 0;
        for (const id of fromIds) if (toIds.has(id)) both += 1;
        return { fromCount: fromIds.size, toCount: toIds.size, both, error: null };
    } catch (e) {
        return {
            fromCount: null, toCount: null, both: null,
            error: (e && e.message) || "Mitglieder konnten nicht geladen werden (GuildMembers-Intent aktiv?).",
        };
    }
}

/**
 * The server a web request means (#895): `guildId` must be one of the servers,
 * else null (the route answers 400 unknown_guild); without one the first server.
 * "" when no server is configured at all.
 * @param {{ guildId?: string }} wanted
 * @returns {string|null}
 */
function resolveServer({ guildId = "" } = {}, config = getConfig()) {
    const ids = serverIds(config);
    const wanted = String(guildId || "").trim();
    if (wanted) return ids.includes(wanted) ? wanted : null;
    return ids[0] || "";
}

/**
 * The servers a page offers to pick from (#895), in the order of the server list:
 * the Discord name is the main text, the label an optional extra title.
 * @returns {Array<{ guildId, name, label, online, iconUrl }>}
 */
function serverChoices(config = getConfig()) {
    return serverIds(config).map((guildId) => {
        const guild = discord.getGuild(guildId);
        return {
            guildId,
            name: guild ? String(guild.name || "") : "",
            label: serverLabel(guildId, config),
            online: !!guild,
            iconUrl: guild && typeof guild.iconURL === "function" ? (guild.iconURL({ size: 64 }) || "") : "",
        };
    });
}

/**
 * The server a role message belongs to: its `guildId`, else the first server.
 * The start wrote the server of every entry of before #895 down once
 * (settingsMigration.js, migrateRoleMessageGuilds); this fallback only covers an
 * entry it could not place.
 */
function roleMessageGuild(entry, config = getConfig()) {
    const own = String((entry && entry.guildId) || "").trim();
    if (own) return own;
    return serverIds(config)[0] || "";
}

module.exports = {
    serverIds, serverLabel, resolveServer, serverChoices, roleMessageGuild, links, linkedSources, linkedTargets,
    eventGuildIds, configuredGuildIds, isEventGuild, guildRole,
    eventGuildCards, describeGuild, guildOverlap,
};
