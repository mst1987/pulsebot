// The Discord servers this bot works with (issue #251, #361; federation #890):
//
//   servers — every server, as equals (`discordServers.servers`). Each may hold
//             raids (event channels, Raid-Helper, the admin-role check).
//   links   — directed: `{ from, to, channelId }` posts the raid list of `from`
//             to channelId on `to` (from = to is allowed).
//   talk    — the communication server: sign-up per bot, pings. Still a single
//             scalar for now (until #892), and always one of `servers` — a
//             server may hold raids and be the talk server at once.
//
// All come from settingsStore's `discordServers`; no server at all falls back
// to the old single `guildId`, an empty talk server means "no separate
// communication server" — which is exactly how the bot behaved before. The web
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

/**
 * The first configured server's id — kept for call sites that intentionally
 * still operate on "the primary event server" rather than looping over all of
 * them (role sync, Raid-Helper retirement, a series' default guild, the
 * talk-overview sign-up fallback). Check those call sites before "fixing" this
 * to loop — it is deliberate, not an oversight.
 */
function eventGuildId(config = getConfig()) {
    return eventGuildIds(config)[0] || "";
}

/**
 * The talk server's id, "" when none is set. Since #890 it may be a server
 * with raids too (even the primary one) — callers that send to "event and
 * talk" check for the same server themselves (pingDelivery: no double ping).
 */
function talkGuildId(config = getConfig()) {
    return String(blockOf(config).talkGuildId || "").trim();
}

/** Every configured server id, servers first, without duplicates or blanks. */
function configuredGuildIds(config = getConfig()) {
    return [...new Set([...serverIds(config), talkGuildId(config)].filter(Boolean))];
}

function isEventGuild(guildId, config = getConfig()) {
    return !!guildId && eventGuildIds(config).includes(String(guildId));
}

function isTalkGuild(guildId, config = getConfig()) {
    const talk = talkGuildId(config);
    return !!guildId && !!talk && String(guildId) === talk;
}

/**
 * "event" | "talk" | "" — the badge the server switcher shows at a server.
 * The talk server is named "talk" first: it is one of `servers` now, and the
 * role sync tells its sides apart by this badge.
 */
function guildRole(guildId, config = getConfig()) {
    if (isTalkGuild(guildId, config)) return "talk";
    if (isEventGuild(guildId, config)) return "event";
    return "";
}

/**
 * Transition until the new Discord-Server page (#891): the servers as the old
 * `eventGuilds` list — every server but the talk server (unless the talk
 * server posts a raid list of its own), each with the first link of its own
 * as the overview target. Read by the settings route and eventGuildCards().
 */
function legacyEventGuilds(config = getConfig()) {
    const list = Array.isArray(blockOf(config).servers) ? blockOf(config).servers : [];
    const talk = talkGuildId(config);
    return list
        .filter((s) => s && s.guildId)
        .map((s) => {
            const first = linkedTargets(s.guildId, config)[0];
            return {
                guildId: s.guildId,
                label: s.label || "",
                overviewGuildId: first ? first.to : "",
                overviewChannelId: first ? first.channelId : "",
            };
        })
        .filter((e) => e.guildId !== talk || e.overviewGuildId);
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

/** Every event server's card, plus its overview target (settings UI; old shape until #891). */
function eventGuildCards(config = getConfig()) {
    return legacyEventGuilds(config).map((entry) => {
        const card = describeGuild(entry.guildId, "event");
        if (!card) return null;
        const overviewGuild = entry.overviewGuildId ? discord.getGuild(entry.overviewGuildId) : null;
        return {
            ...card,
            label: entry.label || "",
            overviewGuildId: entry.overviewGuildId || "",
            overviewChannelId: entry.overviewChannelId || "",
            overviewGuildName: overviewGuild ? overviewGuild.name : "",
        };
    }).filter(Boolean);
}

/** The talk server's card, or null without a talk server. */
function talkGuild(config = getConfig()) {
    return describeGuild(talkGuildId(config), "talk");
}

/**
 * How many members of the event server are on the talk server too — the ones
 * who are not can only be reached by DM there. Needs the GuildMembers intent on
 * both servers; any failure comes back as `error` instead of a throw, because a
 * missing overlap must never cost anyone the settings page.
 *
 * @returns {Promise<null | { eventCount, talkCount, both, error }>} null without two different servers
 */
async function memberOverlap(config = getConfig()) {
    const eventId = eventGuildId(config);
    const talkId = talkGuildId(config);
    // One server for both: everybody is "on both", nothing to fetch.
    if (!eventId || !talkId || eventId === talkId) return null;
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
    serverIds, serverLabel, links, linkedSources, linkedTargets,
    eventGuildId, eventGuildIds, talkGuildId, configuredGuildIds,
    isEventGuild, isTalkGuild, guildRole, legacyEventGuilds,
    eventGuild, eventGuildCards, talkGuild, describeGuild, memberOverlap,
};
