// Which Discord server a piece of data belongs to (#917, epic #926).
//
//   - a log: its linked raid's server, else the server of the channel it was
//     posted in, else the first server. `guildId` on the log holds the result,
//     `guildFrom` says which rule gave it ("event" | "channel" | "first") and
//     `postGuildId` keeps the server of the post, so a log that loses its raid
//     falls back to the channel again. The start migration
//     (settingsMigration.migrateLogGuilds) writes it down for every log.
//   - loot: over its raid (guildOfEvent); nothing extra is stored.
//
// No settingsStore here: settingsMigration needs these rules, and the settings
// store requires the migration (a cycle). Callers hand the config in.
const { readJsonFile } = require("../../stores/jsonStore");
const { settingsPath } = require("../../config/paths");

const str = (value) => String(value === undefined || value === null ? "" : value).trim();

/** The first server: discordServers.servers[0], else config.guildId, else "". */
function firstServerId(config) {
    const cfg = config || {};
    const servers = (cfg.discordServers && Array.isArray(cfg.discordServers.servers)) ? cfg.discordServers.servers : [];
    return str(servers[0] && servers[0].guildId) || str(cfg.guildId);
}

/**
 * categoryId -> guildId from the category-name snapshot
 * (services/discord/categoryNames.js, `{ guilds: { guildId: { categoryId: name } } }`).
 */
function categoryGuildIndex(guilds) {
    const src = guilds && typeof guilds === "object" ? guilds : {};
    const index = new Map();
    for (const [guildId, categories] of Object.entries(src)) {
        if (!categories || typeof categories !== "object") continue;
        for (const categoryId of Object.keys(categories)) if (!index.has(categoryId)) index.set(categoryId, guildId);
    }
    return index;
}

/** The index of the stored category-name snapshot (read from disk, no Discord). */
function storedCategoryGuilds() {
    const data = readJsonFile(settingsPath("category-names.json"), {});
    return categoryGuildIndex(data && data.guilds);
}

/**
 * The server of a raid (own event or Raid-Helper snapshot): its `guildId`,
 * else the server its category belongs to. "" when neither is known.
 * @param {{ categoryGuilds?: Map<string, string> }} [opts] defaults to the stored snapshot
 */
function guildOfEvent(event, { categoryGuilds } = {}) {
    if (!event) return "";
    const own = str(event.guildId);
    if (own) return own;
    const categoryId = str(event.categoryId);
    if (!categoryId) return "";
    const index = categoryGuilds || storedCategoryGuilds();
    return str(index.get(categoryId));
}

/**
 * The server of the post a log came from. Before #917 `guildId` was exactly
 * that for every log posted in Discord (it has a channel); a log without a
 * channel (added by URL) has no post.
 */
function postGuildOf(log) {
    if (!log) return "";
    if (log.postGuildId) return str(log.postGuildId);
    if (str(log.channelId) && !log.guildFrom) return str(log.guildId);
    return "";
}

/**
 * The server fields of a log by the rule raid -> channel -> first server.
 * A log still linked to a raid that can no longer be found keeps the raid's
 * server it already has.
 * @param {object} log
 * @param {{ eventGuildId?: string, firstGuildId?: string }} opts
 * @returns {{ guildId: string, guildFrom: string, postGuildId: string }}
 */
function logGuild(log, { eventGuildId = "", firstGuildId = "" } = {}) {
    const postGuildId = postGuildOf(log);
    const fromEvent = str(eventGuildId)
        || (log && str(log.eventId) && log.guildFrom === "event" ? str(log.guildId) : "");
    if (fromEvent) return { guildId: fromEvent, guildFrom: "event", postGuildId };
    if (postGuildId) return { guildId: postGuildId, guildFrom: "channel", postGuildId };
    const first = str(firstGuildId);
    return { guildId: first, guildFrom: first ? "first" : "", postGuildId };
}

module.exports = { firstServerId, categoryGuildIndex, storedCategoryGuilds, guildOfEvent, postGuildOf, logGuild };
