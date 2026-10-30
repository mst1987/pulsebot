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
 * True when a loot row (or a row of eventsWithLoot) belongs to `guildId`.
 * `undefined` means "no server filter" (internal callers, admin export, tests);
 * any other empty value means "no active server" and matches nothing (fail
 * closed, same as the logs of #920). A row no rule can place (no server
 * configured at all - a single-server install) counts for the active server.
 */
function lootInGuild(ctx, row, guildId) {
    if (guildId === undefined) return true;
    const active = str(guildId);
    if (!active) return false;
    const owner = guildOfLootEvent(ctx, row && row.eventId, row && row.categoryId, row && row.guildId);
    return !owner || owner === active;
}

/**
 * The rows of the active server; `ctx` is created when not given.
 * `guildId === undefined`: every row; "" (no active server): none.
 */
function lootOfGuild(rows, guildId, ctx) {
    const list = Array.isArray(rows) ? rows : [];
    if (guildId === undefined) return list;
    if (!str(guildId)) return [];
    const c = ctx || serverContext();
    return list.filter((row) => lootInGuild(c, row, guildId));
}

/** A raid id belongs to the active server (import and inbox targets). */
function eventInGuild(ctx, eventId, guildId, categoryId = "") {
    return lootInGuild(ctx, { eventId, categoryId }, guildId);
}

/**
 * An addon inbox card (a pending session) shows on the server of its suggested
 * raid - the server the upload's match stored, else the raid's own rule. One
 * without a suggestion shows on the server of its upload key (`session.guildId`,
 * #994), and on every server when the key had none: the addon does not know
 * the server (#919). Same `undefined`/"" meaning as lootInGuild.
 */
function sessionInGuild(ctx, session, guildId) {
    if (guildId === undefined) return true;
    if (!str(guildId)) return false;
    const suggested = session && session.match && session.match.suggested;
    if (!suggested || !str(suggested.eventId)) {
        const own = str(session && session.guildId);
        return !own || own === str(guildId);
    }
    if (str(suggested.guildId)) return str(suggested.guildId) === str(guildId);
    return eventInGuild(ctx, suggested.eventId, guildId, suggested.categoryId || "");
}

/**
 * The server a request without a session works on (the sync tool's token
 * routes): the server of the named category, else the first server - the same
 * rule 4 as above, never a guess from the bot's guild list.
 */
function serverWithoutSession(categoryId = "", ctx) {
    return guildOfLootEvent(ctx || serverContext(), "", categoryId);
}

/**
 * The server a bot command answers for: the Discord server it was used on; in
 * a DM (no server) the first server - the same rule 4 (#919).
 */
function serverOfInteraction(interaction, ctx) {
    const own = str(interaction && (interaction.guildId || (interaction.guild && interaction.guild.id)));
    return own || serverWithoutSession("", ctx);
}

module.exports = { serverContext, guildOfLootEvent, lootInGuild, lootOfGuild, eventInGuild, sessionInGuild, serverWithoutSession, serverOfInteraction };
