const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

// Raid-Helper events the periodic/on-view scan (raidEventScan.js) has already
// seen are snapshotted here — including their channel/category NAME, not just
// the id — so the dashboard's "Latest Events" card keeps showing a raid once it
// has been scanned once, even after Raid-Helper stops returning it (its lookback
// window, or the event being cleaned up on their end) or its Discord channel is
// renamed/deleted. Stored as a single JSON file next to the other editable
// settings under data/settings/raid-events.json.
const RAID_EVENTS_FILE = settingsPath("raid-events.json");

const store = createJsonStore({
    file: RAID_EVENTS_FILE,
    defaults: () => [],
    normalize: (data) => (Array.isArray(data.events) ? data.events : []),
    // Read on the dashboard, the raid lists and per event (getRaidEvent): parsed once per change.
    cache: true,
});

/** Every snapshot, as a copy to change and write back. */
function readAll() {
    return store.read();
}

function writeAll(events) {
    store.write({ events });
}

/** All persisted events for a guild, newest start first. Copies, the caller may change them. */
function listRaidEvents(guildId) {
    const id = String(guildId || "").trim();
    return store.peek()
        .filter((e) => e && (!id || e.guildId === id))
        .map((e) => structuredClone(e))
        .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
}

/** A single persisted event by its Raid-Helper id (a copy), or null. */
function getRaidEvent(id) {
    if (!id) return null;
    const hit = store.peek().find((e) => e.id === id);
    return hit ? structuredClone(hit) : null;
}

// What a scan refreshes on a snapshot; `updatedAt` follows only a real change.
const SNAPSHOT_FIELDS = ["guildId", "title", "channelId", "channelName", "categoryId", "categoryName", "startTime", "signUps", "setup", "firstSeenAt"];

/** Whether `merged` says anything `existing` does not already hold. */
function snapshotChanged(existing, merged) {
    return SNAPSHOT_FIELDS.some((key) => JSON.stringify(existing[key]) !== JSON.stringify(merged[key]));
}

/**
 * Upsert a batch of scanned events in one read/write cycle (a scan typically
 * finds several events at once). Each entry is merged by Raid-Helper id: the
 * first-seen timestamp is preserved across re-scans, everything else (title,
 * channel/category name, start time) is refreshed from the latest scan. Blank
 * ids are skipped. Returns how many were newly seen for the first time.
 *
 * The signup roster (`signUps`) and the raidplan (`setup`) are treated
 * differently from the meta fields: they are only ever replaced by a NON-EMPTY
 * incoming value. Raid-Helper stops returning an event's signups some time after
 * the raid, and a later scan handing us an empty list must not wipe the roster
 * captured while it was still there — that emptiness means "we no longer know",
 * not "nobody signed up". This is what lets a past raid's detail page show the
 * roster as it was at raid time instead of "0 Anmeldungen, alle fehlen".
 *
 * The file is written only when a snapshot was added or changed; `updatedAt`
 * is the moment of the last real change, not of the last scan.
 */
function saveRaidEvents(list) {
    const events = readAll();
    const byId = new Map(events.map((e) => [e.id, e]));
    const now = Date.now();
    let added = 0;
    let changed = 0;
    for (const data of list || []) {
        const id = String((data && data.id) || "").trim();
        if (!id) continue;
        const existing = byId.get(id);
        const keepNonEmpty = (incoming, current) =>
            (Array.isArray(incoming) && incoming.length ? incoming : (current || []));
        const merged = {
            id,
            guildId: data.guildId || (existing && existing.guildId) || "",
            title: data.title || (existing && existing.title) || "",
            channelId: data.channelId || (existing && existing.channelId) || "",
            channelName: data.channelName || (existing && existing.channelName) || "",
            categoryId: data.categoryId || (existing && existing.categoryId) || "",
            categoryName: data.categoryName || (existing && existing.categoryName) || "",
            startTime: Number(data.startTime) || (existing && existing.startTime) || 0,
            signUps: keepNonEmpty(data.signUps, existing && existing.signUps),
            setup: keepNonEmpty(data.setup, existing && existing.setup),
            firstSeenAt: (existing && existing.firstSeenAt) || now,
            updatedAt: now,
        };
        if (existing) {
            // A rescan that brings nothing new leaves the snapshot - and the file - alone.
            if (!snapshotChanged(existing, merged)) continue;
            Object.assign(existing, merged);
            changed += 1;
        } else {
            events.push(merged);
            byId.set(id, merged);
            added += 1;
        }
    }
    // The dashboard scans on every view; rewriting an unchanged file each time was pure cost.
    if (added || changed) writeAll(events);
    return added;
}

module.exports = { listRaidEvents, getRaidEvent, saveRaidEvents, RAID_EVENTS_FILE, useFile: store.useFile };
