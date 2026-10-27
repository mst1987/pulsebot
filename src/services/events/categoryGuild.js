// Which Discord server a raid category belongs to, and whether it is proven
// gone (#926, prod incident 2026-10-27).
//
// `config.categoryIds` is one list over every server. A category id carries no
// server, so "deleted in Discord" may only be judged where its server is
// PROVEN: before this module a category whose server had dropped out of
// discordServers.servers read as "deleted" (it was missing from the configured
// servers' channel lists) and "Kategorie abschließen" wiped its settings.
//
// The owner of a category, first hit wins:
//   1. live: any server the bot is on (discord.listGuilds(), configured or not)
//   2. the category-name snapshot (category-names.json, categoryNames.js)
//   3. own events, Raid-Helper snapshots and rosters with guildId + categoryId
//
// A category's state:
//   live     some server the bot is on has it right now
//   missing  proven gone: the bot is online, its owner is a configured server
//            the bot has cached, and that server no longer has it
//   unknown  everything else (bot offline, owner unknown, owner not configured
//            or not reachable) — never treated as deleted
//
// Built once per request (categoryContext) — the stores are read once, never
// per category.
const discord = require("../discord/discord");
const guildRoles = require("../discord/guildRoles");
const { storedCategoryGuilds, firstServerId } = require("../discord/serverOf");
const eventStore = require("../../stores/eventStore");
const { listRaidEvents } = require("../../stores/raidEventStore");
const rosterStore = require("../../stores/rosterStore");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** Add `guildId + categoryId` pairs of stored records to the index (first hit wins). */
function addRecords(index, read) {
    let list;
    try {
        list = read() || [];
    } catch {
        list = []; // an unreadable store proves nothing
    }
    for (const r of list) {
        const categoryId = str(r && r.categoryId);
        const guildId = str(r && r.guildId);
        if (categoryId && guildId && !index.has(categoryId)) index.set(categoryId, guildId);
    }
}

/**
 * Everything a category judgement needs, read once.
 * @returns {{ config: object, online: boolean, live: Map<string, string>, owners: Map<string, string>, servers: string[], first: string }}
 */
function categoryContext(config) {
    const cfg = config || {};
    const online = typeof discord.isOnline === "function" ? !!discord.isOnline() : true;
    const live = new Map();
    if (online) {
        const guilds = typeof discord.listGuilds === "function" ? discord.listGuilds() || [] : [];
        for (const g of guilds) {
            const guildId = str(g && g.id);
            if (!guildId) continue;
            for (const c of discord.listCategories(guildId) || []) {
                const id = str(c && c.id);
                if (id && !live.has(id)) live.set(id, guildId);
            }
        }
    }
    const owners = new Map(live);
    let snapshot;
    try {
        snapshot = storedCategoryGuilds();
    } catch {
        snapshot = new Map();
    }
    for (const [categoryId, guildId] of snapshot) if (str(guildId) && !owners.has(str(categoryId))) owners.set(str(categoryId), str(guildId));
    addRecords(owners, () => eventStore.listEvents(""));
    addRecords(owners, () => listRaidEvents(""));
    addRecords(owners, () => rosterStore.listRosters(""));
    return { config: cfg, online, live, owners, servers: guildRoles.eventGuildIds(cfg).map(str).filter(Boolean), first: firstServerId(cfg) };
}

/**
 * The state of one category.
 * @returns {{ state: "live"|"missing"|"unknown", guildId: string, reason: string }}
 *   reason (unknown only): "offline" | "no_server" | "server_not_configured" | "server_unreachable"
 */
function categoryState(categoryId, ctx) {
    const id = str(categoryId);
    const guildId = str(ctx.owners.get(id));
    if (!ctx.online) return { state: "unknown", guildId, reason: "offline" };
    if (ctx.live.has(id)) return { state: "live", guildId, reason: "" };
    if (!guildId) return { state: "unknown", guildId, reason: "no_server" };
    if (!ctx.servers.includes(guildId)) return { state: "unknown", guildId, reason: "server_not_configured" };
    if (!discord.getGuild(guildId)) return { state: "unknown", guildId, reason: "server_unreachable" };
    return { state: "missing", guildId, reason: "" };
}

/**
 * The server a category is shown and edited on: its proven owner when that is a
 * configured server, else the first server (so a category of an unknown or
 * unlisted server stays visible and editable somewhere, marked as unproven).
 */
function displayServerOf(categoryId, ctx) {
    return hasProvenServer(categoryId, ctx) ? str(ctx.owners.get(str(categoryId))) : ctx.first;
}

/** Whether a category's server is proven and configured (an owner from one of the sources, in the server list). */
function hasProvenServer(categoryId, ctx) {
    const owner = str(ctx.owners.get(str(categoryId)));
    return !!owner && ctx.servers.includes(owner);
}

/** The ids (of `ids`) that belong on `guildId` (by displayServerOf). */
function idsOnServer(ids, guildId, ctx) {
    const gid = str(guildId) || ctx.first;
    return (Array.isArray(ids) ? ids : []).map(str).filter((id) => id && displayServerOf(id, ctx) === gid);
}

/**
 * Merge a list edited on one server into the stored one: the ids of every
 * other server stay as stored, the ids of `guildId` become what was sent.
 * Sent ids that belong to another server are ignored — a save on server A can
 * never add or remove a category of server B.
 */
function mergeServerCategoryIds({ stored, sent, guildId, ctx }) {
    const gid = str(guildId) || ctx.first;
    const mine = new Set(idsOnServer(sent, gid, ctx));
    // stored order first, so a save does not reshuffle the list
    const kept = (Array.isArray(stored) ? stored : []).map(str)
        .filter((id) => id && (displayServerOf(id, ctx) !== gid || mine.has(id)));
    return [...new Set([...kept, ...mine])];
}

module.exports = { categoryContext, categoryState, displayServerOf, hasProvenServer, idsOnServer, mergeServerCategoryIds };
