// Shared by server.js's SSR CLA routes and apiRoutes/cla.js's JSON routes:
// the events a detected log could plausibly belong to (for the assignment
// dropdown / auto-match), and the fields stored when a log is linked to one.
// Extracted out of server.js so both call sites re-resolve events the same
// way (never trust a client-supplied event label — always look it up here).
const { createRaidhelperClient } = require("../utils/raidhelperClient");
const discord = require("./discord");
const { EVENT_LOOKBACK_DAYS } = require("./raidEventGroups");
const { listRaidEvents } = require("./raidEventStore");

/**
 * Flat list of the guild's already started raids that a detected log could
 * belong to, newest start first. Returns { events, error }.
 *
 * Each event is placed via a live Discord-channel join when possible; if its
 * channel is missing from the live join (deleted/archived after the raid), it
 * falls back to the snapshot raidEventScan.js keeps in raidEventStore.js — the
 * same fallback loadEventGroups() uses for the event detail page, so a past
 * raid whose channel is gone doesn't drop out here as "Event nicht gefunden"
 * while its detail page still resolves it fine.
 */
async function loadMatchableEvents(guildId, days = EVENT_LOOKBACK_DAYS) {
    if (!guildId) return { events: [], error: null };
    try {
        const rh = createRaidhelperClient();
        const from = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
        const events = await rh.getPastEvents(from);
        const catMap = discord.getChannelCategoryMap(guildId);
        const persistedById = new Map(listRaidEvents(guildId).map((e) => [e.id, e]));
        const out = [];
        for (const ev of events || []) {
            const meta = catMap[ev.channelId];
            const persisted = !meta ? persistedById.get(ev.id) : null;
            if (!meta && !persisted) continue; // channel gone from Discord AND never scanned — nowhere to place it
            out.push({
                id: ev.id,
                title: ev.title,
                startTime: ev.startTime,
                channelId: ev.channelId,
                channelName: meta ? (meta.name || "") : (persisted.channelName || ""),
                categoryId: meta ? (meta.categoryId || "") : (persisted.categoryId || ""),
                categoryName: meta ? (meta.categoryName || "") : (persisted.categoryName || ""),
            });
        }
        out.sort((a, b) => (Number(b.startTime) || 0) - (Number(a.startTime) || 0));
        return { events: out, error: null };
    } catch (e) {
        return { events: [], error: (e && e.message) || "Events konnten nicht geladen werden (Raid-Helper API)." };
    }
}

// A log's event assignment as stored: label + start snapshot, so it keeps its
// name once Raid-Helper no longer lists the event.
function eventLinkFields(event, source) {
    return {
        eventId: event.id,
        eventLabel: event.title || event.id,
        eventStartTime: Number(event.startTime) || 0,
        source,
    };
}

module.exports = { loadMatchableEvents, eventLinkFields };
