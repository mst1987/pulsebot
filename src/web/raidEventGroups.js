// Shared by server.js's SSR raid routes and apiRoutes/raids.js: the guild's
// Raid-Helper events grouped by Discord category.
const { createRaidhelperClient } = require("../utils/raidhelperClient");
const discord = require("./discord");
const { listRaidEvents } = require("./raidEventStore");
const { signupStatus } = require("../utils/attendance");

// How far back events are looked up when a past raid has to be found again — for
// the log→event assignment and for the event detail page, which the dashboard's
// "Latest Events" card links to.
const EVENT_LOOKBACK_DAYS = 60;
const eventLookbackSince = () => Math.floor(Date.now() / 1000) - EVENT_LOOKBACK_DAYS * 24 * 60 * 60;

// loadEventGroups() is called on almost every admin page (raids list, event
// detail, loot import, notify templates, ping-missing, ...), so without any
// caching a single admin session hammers Raid-Helper's API dozens of times a
// minute — the actual cause of the "Raid-Helper nicht erreichbar" errors admins
// kept seeing. Cache the raw event list per request "shape" (there are only two
// today: "upcoming only" and "since <lookback>") instead of re-deriving a wider
// fetch client-side — that would require re-filtering by start time ourselves,
// duplicating (and risking drifting from) Raid-Helper's own StartTimeFilter
// semantics. `cacheBySince` dedupes calls within a short TTL; `lastGoodBySince`
// is kept indefinitely (until the next successful fetch for that shape) so a
// transient outage still serves recent data instead of failing every page that
// touches events.
const EVENTS_CACHE_TTL_MS = 30_000;
const cacheBySince = new Map(); // key -> { at, events }
const lastGoodBySince = new Map(); // key -> { at, events }

// Coarse bucket so near-simultaneous calls share one cache entry even though
// `sinceSeconds` (derived from Date.now()) drifts by the second.
function cacheKeyFor(sinceSeconds) {
    return sinceSeconds ? `since:${Math.floor(sinceSeconds / 300)}` : "upcoming";
}

// Raw Raid-Helper event list for one request shape, cached. Returns
// { events, stale } — `stale` is true only when a fresh fetch failed and the
// last known-good result for this shape was served instead. Throws only when
// there is nothing cached at all to fall back to (e.g. right after a restart
// with Raid-Helper already down).
async function fetchEventsCached(sinceSeconds) {
    const key = cacheKeyFor(sinceSeconds);
    const now = Date.now();
    const cached = cacheBySince.get(key);
    if (cached && now - cached.at < EVENTS_CACHE_TTL_MS) return { events: cached.events, stale: false };
    try {
        const rh = createRaidhelperClient();
        const events = sinceSeconds ? await rh.fetchEvents(sinceSeconds) : await rh.getAllEvents();
        const entry = { at: now, events };
        cacheBySince.set(key, entry);
        lastGoodBySince.set(key, entry);
        return { events, stale: false };
    } catch (e) {
        const good = lastGoodBySince.get(key);
        if (good) return { events: good.events, stale: true };
        throw e;
    }
}

// Test-only: clear the module-level cache. Production code never calls this.
function _resetEventsCacheForTests() {
    cacheBySince.clear();
    lastGoodBySince.clear();
}

// Fetch the guild's Raid-Helper events and group them by the Discord category
// their channel lives in. By default only UPCOMING events (Raid-Helper filters by
// start time); pass `sinceSeconds` to include raids that already took place.
//
// Each event is placed via a live Discord-channel join when possible; if its
// channel is missing from the live join (deleted/archived after the raid, or
// Raid-Helper itself is unreachable and even the cache above is empty), it
// falls back to the snapshot raidEventScan.js already keeps in
// raidEventStore.js — the same data the "Vergangene Raids" list uses, which is
// why that list keeps working for raids whose channel is long gone while a live
// join alone would silently drop them. Returns { groups, error, stale }: `error`
// is a message when the live fetch failed (groups may still be usable — check
// group event counts, don't just bail on `error` alone, unless the caller
// specifically wants to fail fast on any Raid-Helper trouble, e.g. mutating
// actions like posting/pinging).
async function loadEventGroups(guildId, { sinceSeconds } = {}) {
    if (!guildId) return { groups: [], error: null, stale: false };
    const catMap = discord.getChannelCategoryMap(guildId);
    const persistedById = new Map(listRaidEvents(guildId).map((e) => [e.id, e]));

    let liveEvents = [];
    let error = null;
    let stale = false;
    try {
        const result = await fetchEventsCached(sinceSeconds);
        liveEvents = result.events;
        stale = result.stale;
    } catch (e) {
        error = (e && e.message) || "Events konnten nicht geladen werden (Raid-Helper API).";
    }

    const byCat = new Map();
    const place = (categoryId, categoryName, row) => {
        const key = categoryId || "__none__";
        if (!byCat.has(key)) {
            byCat.set(key, { categoryId: categoryId || "", categoryName: categoryName || "Ohne Kategorie", events: [] });
        }
        byCat.get(key).events.push(row);
    };

    const seen = new Set();
    for (const ev of liveEvents) {
        const meta = catMap[ev.channelId];
        const snapshot = persistedById.get(ev.id);
        const persisted = !meta ? snapshot : null;
        if (!meta && !persisted) continue; // channel gone from Discord AND never scanned — nowhere to place it
        const categoryId = meta ? (meta.categoryId || "") : (persisted.categoryId || "");
        const categoryName = meta ? (meta.categoryName || "Ohne Kategorie") : (persisted.categoryName || "Ohne Kategorie");
        // Raid-Helper drops an event's signups some time after the raid: the event
        // is still listed, just with an empty roster. Falling back to the snapshot
        // raidEventScan.js took while they were still there keeps a past raid's
        // detail page from reporting "0 Anmeldungen" and everyone as missing.
        // `status` is normalised here rather than kept raw: Raid-Helper spreads
        // a bench/absence over several fields this reduction drops, so the
        // attendance list would otherwise see every reaction as a plain signup.
        const liveSignUps = (ev.signUps || []).map((s) => ({
            userId: s.userId, specName: s.specName, status: signupStatus(s),
        }));
        const signUps = liveSignUps.length ? liveSignUps : ((snapshot && snapshot.signUps) || []);
        place(categoryId, categoryName, {
            id: ev.id,
            title: ev.title,
            startTime: ev.startTime,
            leaderId: ev.leaderId,
            channelId: ev.channelId,
            channelName: meta ? meta.name : (persisted.channelName || ""),
            categoryId,
            templateId: (ev.templateId !== null && ev.templateId !== undefined) ? String(ev.templateId) : "",
            description: ev.description || "",
            signupCount: signUps.filter((s) => s.specName !== "Absence").length,
            signUps,
            signUpsFromSnapshot: !liveSignUps.length && signUps.length > 0,
        });
        seen.add(ev.id);
    }

    // Merge in persisted events the live fetch didn't return, so past raids stay
    // reachable via their detail page even when Raid-Helper itself no longer
    // lists them (not just a deleted Discord channel, which the per-event
    // fallback above already covers) — e.g. Raid-Helper prunes old events on its
    // side, or a caller-supplied `sinceSeconds` cutoff (the event detail page
    // uses EVENT_LOOKBACK_DAYS) excludes an event the dashboard's unbounded
    // "Latest Events" list still surfaces from the local snapshot. Runs whenever
    // a lookback window is requested (that's the shape callers use to look up a
    // specific past event) or the live fetch failed outright; skipped for a
    // bare "upcoming" call so old persisted raids don't pollute that list.
    if (error || sinceSeconds) {
        for (const e of persistedById.values()) {
            if (seen.has(e.id) || (sinceSeconds && (e.startTime || 0) < sinceSeconds)) continue;
            const signUps = e.signUps || [];
            place(e.categoryId, e.categoryName, {
                id: e.id, title: e.title, startTime: e.startTime, leaderId: "",
                channelId: e.channelId, channelName: e.channelName, categoryId: e.categoryId || "",
                templateId: "", description: "",
                signupCount: signUps.filter((s) => s && s.specName !== "Absence").length,
                signUps,
                signUpsFromSnapshot: signUps.length > 0,
            });
        }
    }

    const groups = [...byCat.values()].sort((a, b) => a.categoryName.localeCompare(b.categoryName));
    return { groups, error, stale: stale || !!error };
}

module.exports = { EVENT_LOOKBACK_DAYS, eventLookbackSince, loadEventGroups, _resetEventsCacheForTests };
