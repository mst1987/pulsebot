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
 * same per-event fallback loadEventGroups() uses for the event detail page.
 *
 * Beyond that, an event can be missing from Raid-Helper's own live response
 * entirely (pruned on their side, or the channel-based join isn't even reached
 * because the event id itself never came back) — so any persisted event within
 * the lookback window that the live fetch didn't return is merged in too, the
 * same way loadEventGroups() does for a lookback request. Without this, a raid
 * whose detail page resolves fine (loadEventGroups() has the merge) could still
 * fail to accept a log assignment here with "Event nicht gefunden".
 */
async function loadMatchableEvents(guildId, days = EVENT_LOOKBACK_DAYS) {
    if (!guildId) return { events: [], error: null };
    const from = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
    const persistedById = new Map(listRaidEvents(guildId).map((e) => [e.id, e]));
    // Snapshot rows, shaped like the live ones. Used both to fill gaps in a
    // successful fetch and as the whole answer when the fetch fails.
    const fromPersisted = (e) => ({
        id: e.id,
        title: e.title,
        startTime: e.startTime,
        channelId: e.channelId,
        channelName: e.channelName || "",
        categoryId: e.categoryId || "",
        categoryName: e.categoryName || "",
    });
    try {
        const rh = createRaidhelperClient();
        const events = await rh.getPastEvents(from);
        const catMap = discord.getChannelCategoryMap(guildId);
        const out = [];
        const seen = new Set();
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
            seen.add(ev.id);
        }
        for (const e of persistedById.values()) {
            if (seen.has(e.id) || (e.startTime || 0) < from) continue;
            out.push(fromPersisted(e));
        }
        out.sort((a, b) => (Number(b.startTime) || 0) - (Number(a.startTime) || 0));
        return { events: out, error: null };
    } catch (e) {
        // Raid-Helper unreachable: serve the local snapshot rather than nothing.
        // A time-based match only needs id/title/startTime/categoryId, all of
        // which raidEventScan.js already persisted — so the automatic log
        // assignment keeps working through an outage instead of stalling until
        // Raid-Helper is back. `error` stays set, so callers that need live data
        // (the CLA assignment UI) can still say so.
        const fallback = [...persistedById.values()]
            .filter((e) => (e.startTime || 0) >= from)
            .map(fromPersisted)
            .sort((a, b) => (Number(b.startTime) || 0) - (Number(a.startTime) || 0));
        return { events: fallback, error: (e && e.message) || "Events konnten nicht geladen werden (Raid-Helper API)." };
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
