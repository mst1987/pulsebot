// Which Discord server a raid category belongs to, and whether it is proven
// gone (#926, prod incident 2026-10-27).
//
// `config.categoryIds` is one list over every server. A category id carries no
// server, so "deleted in Discord" may only be judged where its server is
// PROVEN: before this module a category whose server had dropped out of
// discordServers.servers read as "deleted" (it was missing from the configured
// servers' channel lists) and "Kategorie abschließen" wiped its settings.
//
// Two owners per category:
//   proof    reliable sources only — live (any usable server the bot is on) and
//            the category-name snapshot (category-names.json, written from live
//            Discord data). Only this owner can make a category "missing".
//   display  the proof owner, else own events, Raid-Helper snapshots and
//            rosters with guildId + categoryId. Their guildId may be guessed
//            (a roster takes the active web server, the roster migration falls
//            back to the first server), so they only decide on which server a
//            category is shown — never that it is deleted.
//
// A category's state:
//   live     some usable server the bot is on has it right now
//   missing  proven gone: the bot is online, its proof owner is a configured
//            server that is cached, available and lists categories, and that
//            server no longer has it
//   unknown  everything else (bot offline, no proof owner, owner not configured,
//            not reachable or unavailable, or listing no category at all) —
//            never treated as deleted
//
// Built once per request (categoryContext) — the stores are read once, never
// per category.
const discord = require("../discord/discord");
const guildRoles = require("../discord/roles/guildRoles");
const { storedCategoryGuilds, firstServerId } = require("../discord/servers/serverOf");
const eventStore = require("../../stores/eventStore");
const { listRaidEvents } = require("../../stores/raidEventStore");
const rosterStore = require("../../stores/rosterStore");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/**
 * Whether a server is cached AND usable. During a Discord outage discord.js v14
 * keeps it in the cache with `available === false` and no channels.
 */
function guildUsable(guildId) {
    if (typeof discord.isGuildAvailable === "function") return !!discord.isGuildAvailable(guildId);
    const guild = discord.getGuild(guildId);
    return !!guild && guild.available !== false;
}

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

/** The live categories of every usable bot server, and how many each server lists. */
function liveCategories() {
    const live = new Map();
    const counts = new Map();
    const guilds = typeof discord.listGuilds === "function" ? discord.listGuilds() || [] : [];
    for (const g of guilds) {
        const guildId = str(g && g.id);
        if (!guildId || !guildUsable(guildId)) continue;
        const list = discord.listCategories(guildId) || [];
        counts.set(guildId, list.length);
        for (const c of list) {
            const id = str(c && c.id);
            if (id && !live.has(id)) live.set(id, guildId);
        }
    }
    return { live, counts };
}

/**
 * Everything a category judgement needs, read once.
 * @returns {{ config: object, online: boolean, live: Map<string, string>, liveCounts: Map<string, number>,
 *   proofs: Map<string, string>, owners: Map<string, string>, servers: string[], first: string }}
 *   proofs: the reliable owner (live, snapshot); owners: proofs plus the display-only sources
 */
function categoryContext(config) {
    const cfg = config || {};
    const online = typeof discord.isOnline === "function" ? !!discord.isOnline() : true;
    const { live, counts } = online ? liveCategories() : { live: new Map(), counts: new Map() };
    const proofs = new Map(live);
    let snapshot;
    try {
        snapshot = storedCategoryGuilds();
    } catch {
        snapshot = new Map();
    }
    for (const [categoryId, guildId] of snapshot) if (str(guildId) && !proofs.has(str(categoryId))) proofs.set(str(categoryId), str(guildId));
    const owners = new Map(proofs);
    addRecords(owners, () => eventStore.listEvents(""));
    addRecords(owners, () => listRaidEvents(""));
    addRecords(owners, () => rosterStore.listRosters(""));
    return {
        config: cfg, online, live, liveCounts: counts, proofs, owners,
        servers: guildRoles.eventGuildIds(cfg).map(str).filter(Boolean), first: firstServerId(cfg),
    };
}

/**
 * The state of one category.
 * @returns {{ state: "live"|"missing"|"unknown", guildId: string, reason: string }}
 *   guildId: the proof owner, else the display owner (unknown only)
 *   reason (unknown only): "offline" | "no_server" | "server_not_configured" | "server_unreachable" | "server_empty"
 */
function categoryState(categoryId, ctx) {
    const id = str(categoryId);
    const proof = str(ctx.proofs.get(id));
    const guildId = proof || str(ctx.owners.get(id));
    if (!ctx.online) return { state: "unknown", guildId, reason: "offline" };
    if (ctx.live.has(id)) return { state: "live", guildId, reason: "" };
    if (!proof) return { state: "unknown", guildId, reason: "no_server" };
    if (!ctx.servers.includes(proof)) return { state: "unknown", guildId, reason: "server_not_configured" };
    if (!guildUsable(proof)) return { state: "unknown", guildId, reason: "server_unreachable" };
    // a server that lists no category at all although the snapshot knows some of its
    // categories is not trusted: its channels are probably not loaded
    if (!ctx.liveCounts.get(proof)) return { state: "unknown", guildId, reason: "server_empty" };
    return { state: "missing", guildId, reason: "" };
}

/**
 * The server a category is shown and edited on: its owner (proof or display
 * source) when that is a configured server, else the first server (so a
 * category of an unknown or unlisted server stays visible and editable
 * somewhere, marked as unproven).
 */
function displayServerOf(categoryId, ctx) {
    return hasKnownServer(categoryId, ctx) ? str(ctx.owners.get(str(categoryId))) : ctx.first;
}

/** Whether a category's display owner is known and configured (says nothing about deleted). */
function hasKnownServer(categoryId, ctx) {
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

module.exports = { categoryContext, categoryState, displayServerOf, hasKnownServer, idsOnServer, mergeServerCategoryIds };
