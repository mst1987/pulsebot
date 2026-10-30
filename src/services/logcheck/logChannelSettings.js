// Log channels per Discord server (#921, epic #926):
//
//   config.serverSettings[guildId].logChannels = [{ channelId, versionId }]
//
// The bot watches these channels of a server for Warcraft Logs links. Every
// channel names the game version its logs belong to: a new log takes the
// version of its linked raid first, then the channel's, then the host's, then
// TBC (logStore.saveLog, logVersion.resolveReportVersion). A channel without a
// known version ("") says nothing, the host decides.
//
// Before #921 the channels were one global list (config.logChannelIds); the bot
// hands that list to the servers once it is online (logChannelMigration.js).
const { serverSetting } = require("../discord/serverSettings");
const { knownVersion, mainVersionFor } = require("../versions/mainVersion");

/**
 * A logChannels list in its final shape: channel ids trimmed, one entry per
 * channel (the first wins), a version no rule set knows becomes "".
 * @param {*} raw
 * @returns {{ channelId: string, versionId: string }[]}
 */
function normalizeLogChannels(raw) {
    const out = [];
    const seen = new Set();
    for (const entry of Array.isArray(raw) ? raw : []) {
        const src = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : { channelId: entry };
        const channelId = String(src.channelId === undefined || src.channelId === null ? "" : src.channelId).trim();
        if (!channelId || seen.has(channelId)) continue;
        seen.add(channelId);
        out.push({ channelId, versionId: knownVersion(src.versionId) });
    }
    return out;
}

/** The log channels of one server (normalised; [] without any). */
function logChannelsOf(guildId, { config } = {}) {
    return normalizeLogChannels(serverSetting(guildId, "logChannels", { config }));
}

/**
 * Every log channel of every server: [{ guildId, channelId, versionId }].
 * @param {{ config?: object }} [opts]
 */
function allLogChannels({ config } = {}) {
    const cfg = config || require("../../stores/settingsStore").getConfig();
    const out = [];
    for (const guildId of Object.keys((cfg && cfg.serverSettings) || {})) {
        for (const c of logChannelsOf(guildId, { config: cfg })) out.push({ guildId, ...c });
    }
    return out;
}

/** The entry of `channelId` on `guildId`, or null when that server does not watch it. */
function logChannelEntry(guildId, channelId, { config } = {}) {
    const id = String(channelId || "").trim();
    if (!id) return null;
    return logChannelsOf(guildId, { config }).find((c) => c.channelId === id) || null;
}

/**
 * The list a settings PATCH sends for one server, in its final shape. An entry
 * may be a bare channel id (the channel page only knows ids) or an object
 * without a versionId: it keeps the version the channel already has there,
 * else takes the main version of the channel's category, else the main
 * version (like the migration). An object with a versionId sets that version
 * ("" = none, the host decides).
 * @param {*} raw                  the body's list
 * @param {{ current?: Array, parentOf?: (channelId: string) => string, config?: object }} [opts]
 * @returns {{ channelId: string, versionId: string }[]}
 */
function logChannelsFromBody(raw, { current = [], parentOf = () => "", config } = {}) {
    const before = new Map(normalizeLogChannels(current).map((c) => [c.channelId, c.versionId]));
    const list = (Array.isArray(raw) ? raw : []).map((entry) => {
        const src = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : { channelId: entry };
        const channelId = String(src.channelId === undefined || src.channelId === null ? "" : src.channelId).trim();
        if (src.versionId !== undefined) return { channelId, versionId: src.versionId };
        const versionId = before.has(channelId)
            ? before.get(channelId)
            : mainVersionFor({ categoryId: channelId ? parentOf(channelId) : "", config });
        return { channelId, versionId };
    });
    return normalizeLogChannels(list);
}

module.exports = { normalizeLogChannels, logChannelsOf, allLogChannels, logChannelEntry, logChannelsFromBody };
