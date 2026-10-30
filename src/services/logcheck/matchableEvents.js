// Shared by server.js's SSR CLA routes and apiRoutes/system/cla.js's JSON routes:
// the events a detected log could plausibly belong to (for the assignment
// dropdown / auto-match), and the fields stored when a log is linked to one.
// Extracted out of server.js so both call sites re-resolve events the same
// way (never trust a client-supplied event label — always look it up here).
const { createRaidhelperClient } = require("../../utils/raidhelper/client");
const discord = require("../discord/discord");
const { EVENT_LOOKBACK_DAYS } = require("../events/raidEventGroups");
const { listRaidEvents } = require("../../stores/raidEventStore");
const { ownMatchableEvents, withEraName } = require("../events/eventSources");
const { versionOfEvent } = require("../versions/mainVersion");
const { LOG_WINDOW_BEFORE_MS } = require("../events/overview/recentEvents");
const { guildOfEvent } = require("../discord/serverOf");

// Every row carries its raid's game version (#746): a log is matched only to a
// raid of its own version (logEventMatch.js) and takes that version when linked.
// Every row also carries the server it was loaded for (#917): a linked log takes it.
const withVersion = (row, stored) => ({ ...row, versionId: versionOfEvent({ versionId: (stored && stored.versionId) || row.versionId, categoryId: row.categoryId }) });

// The live channel join, or {} when Discord cannot give one right now.
function safeCategoryMap(guildId) {
    try {
        return discord.getChannelCategoryMap(guildId) || {};
    } catch {
        return {};
    }
}

/**
 * Flat list of the guild's already started raids that a detected log could
 * belong to, newest start first — Raid-Helper's and the EventHelper's own
 * (eventSources.js), each with its `source`. Returns { events, error }.
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
    // Up to the start a log may still be posted before (logEventMatch.js): a log
    // posted at the pull, minutes before the raid's start time, belongs to it and
    // is linked right away instead of after the raid started and the next sweep ran.
    const until = Math.floor((Date.now() + LOG_WINDOW_BEFORE_MS) / 1000);
    const persistedById = new Map(listRaidEvents(guildId).map((e) => [e.id, e]));
    // A raid of a closed section of its category keeps the name it had then (#744).
    const erasConfig = require("../../stores/configStore").getConfig();
    // Snapshot rows, shaped like the live ones. Used both to fill gaps in a
    // successful fetch and as the whole answer when the fetch fails.
    const fromPersisted = (e) => withVersion({
        id: e.id,
        source: "raidhelper",
        title: e.title,
        startTime: e.startTime,
        channelId: e.channelId,
        channelName: e.channelName || "",
        categoryId: e.categoryId || "",
        categoryName: e.categoryName || "",
    }, e);
    try {
        const rh = createRaidhelperClient();
        const events = await rh.getPastEvents(from, { untilSeconds: until });
        const catMap = discord.getChannelCategoryMap(guildId);
        const out = [];
        const seen = new Set();
        for (const ev of events || []) {
            const meta = catMap[ev.channelId];
            const persisted = !meta ? persistedById.get(ev.id) : null;
            if (!meta && !persisted) continue; // channel gone from Discord AND never scanned — nowhere to place it
            out.push(withVersion({
                id: ev.id,
                source: "raidhelper",
                title: ev.title,
                startTime: ev.startTime,
                channelId: ev.channelId,
                channelName: meta ? (meta.name || "") : (persisted.channelName || ""),
                categoryId: meta ? (meta.categoryId || "") : (persisted.categoryId || ""),
                categoryName: meta ? (meta.categoryName || "") : (persisted.categoryName || ""),
            }, persistedById.get(ev.id)));
            seen.add(ev.id);
        }
        for (const e of persistedById.values()) {
            if (seen.has(e.id) || (e.startTime || 0) < from) continue;
            out.push(fromPersisted(e));
        }
        // The EventHelper's own raids of the window — a log or a loot export can
        // belong to one of them exactly like to a Raid-Helper event.
        for (const e of ownMatchableEvents(guildId, from, { catMap, untilSeconds: until })) {
            if (!seen.has(e.id)) out.push(withVersion(e));
        }
        out.sort((a, b) => (Number(b.startTime) || 0) - (Number(a.startTime) || 0));
        return { events: out.map((ev) => ({ ...withEraName(ev, { config: erasConfig }), guildId })), error: null };
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
            .concat(ownMatchableEvents(guildId, from, { catMap: safeCategoryMap(guildId), untilSeconds: until }).map((e) => withVersion(e)))
            .sort((a, b) => (Number(b.startTime) || 0) - (Number(a.startTime) || 0));
        return { events: fallback.map((ev) => ({ ...withEraName(ev, { config: erasConfig }), guildId })), error: (e && e.message) || "Events konnten nicht geladen werden (Raid-Helper API)." };
    }
}

// A log's event assignment as stored: label + start snapshot, so it keeps its
// name once Raid-Helper no longer lists the event, and the event's game version
// the log takes while it is linked (#746).
function eventLinkFields(event, source) {
    return {
        eventId: event.id,
        eventLabel: event.title || event.id,
        eventStartTime: Number(event.startTime) || 0,
        source,
        versionId: event.versionId || "",
        // the log moves to its raid's server at once (#917)
        guildId: guildOfEvent(event),
    };
}

module.exports = { loadMatchableEvents, eventLinkFields };
