// Loot of the active Discord server only (#919, epic #926).
//
// Loot belongs to a server over its raid (services/discord/serverOf.js):
//   1. the raid of the row (own event or Raid-Helper snapshot) -> guildOfEvent
//      (its guildId, else the server of its category),
//   2. else the server a bucket without a raid was imported on (the row's
//      `guildId`, written by the import since #919),
//   3. else the row's own category (set on import or by "Kategorie setzen")
//      -> the server of that category in the category-name snapshot,
//   4. else the first server (discordServers.servers[0], else config.guildId);
//      with no server configured at all it counts for the active one.
// Nothing is stored; the rule is evaluated per request. Linked servers see no
// loot of their partners' raids (user decision for #919): only the active
// server counts.
//
// Same shape as the version filter (characterVersions.eventVersion): one
// context per request caches the snapshot and every event lookup.
const eventStore = require("../../stores/eventStore");
const raidEventStore = require("../../stores/raidEventStore");
const { getConfig } = require("../../stores/settingsStore");
const { firstServerId, storedCategoryGuilds, guildOfEvent } = require("../discord/serverOf");

const str = (value) => String(value === undefined || value === null ? "" : value).trim();

/**
 * A per-request context. Everything is optional; tests hand in their own.
 * @param {{ config?: object, categoryGuilds?: Map<string,string>, eventOf?: (id: string) => object|null }} [opts]
 */
function serverContext({ config, categoryGuilds, eventOf } = {}) {
    return {
        firstGuildId: firstServerId(config || getConfig()),
        categoryGuilds: categoryGuilds || storedCategoryGuilds(),
        eventOf: eventOf || ((id) => eventStore.getEvent(id) || raidEventStore.getRaidEvent(id)),
        cache: new Map(),
    };
}

/**
 * The server of a raid id. Hints for a bucket without a raid: the server it was
 * imported on (`importGuildId`, the row's `guildId`), then its category.
 * Never "" when a first server exists.
 */
function guildOfLootEvent(ctx, eventId, categoryId = "", importGuildId = "") {
    const id = str(eventId);
    const key = `${id}|${str(categoryId)}|${str(importGuildId)}`;
    if (ctx.cache.has(key)) return ctx.cache.get(key);
    let guildId = "";
    if (id) {
        let event;
        try { event = ctx.eventOf(id); } catch { event = null; }
        guildId = guildOfEvent(event, { categoryGuilds: ctx.categoryGuilds });
    }
    if (!guildId) guildId = str(importGuildId);
    if (!guildId && str(categoryId)) guildId = str(ctx.categoryGuilds.get(str(categoryId)));
    if (!guildId) guildId = ctx.firstGuildId;
    ctx.cache.set(key, guildId);
    return guildId;
}

/**
 * True when a loot row (or a row of eventsWithLoot) belongs to `guildId`. No
 * active server: everything. A row no rule can place (no server configured at
 * all - a single-server install) counts for whichever server is active.
 */
function lootInGuild(ctx, row, guildId) {
    const active = str(guildId);
    if (!active) return true;
    const owner = guildOfLootEvent(ctx, row && row.eventId, row && row.categoryId, row && row.guildId);
    return !owner || owner === active;
}

/** The rows of the active server; `ctx` is created when not given. */
function lootOfGuild(rows, guildId, ctx) {
    const list = Array.isArray(rows) ? rows : [];
    if (!str(guildId)) return list;
    const c = ctx || serverContext();
    return list.filter((row) => lootInGuild(c, row, guildId));
}

/** A raid id belongs to the active server (import and inbox targets). */
function eventInGuild(ctx, eventId, guildId, categoryId = "") {
    return lootInGuild(ctx, { eventId, categoryId }, guildId);
}

module.exports = { serverContext, guildOfLootEvent, lootInGuild, lootOfGuild, eventInGuild };
