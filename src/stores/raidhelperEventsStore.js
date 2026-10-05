// The Raid-Helper event list as the sync job last fetched it (services/events/
// raidhelperSync.js) — the only copy every page, bot command and job reads.
//
// `data/settings/raidhelper-events.json` = { syncedAt, since, events, error,
// errorAt }: `events` is Raid-Helper's `postedEvents` (signups included) of
// every event that starts at or after `since` (unix seconds), as of `syncedAt`
// (ms). `error`/`errorAt` describe the last failed sync; a failure keeps the
// list of the last good one. On disk so a restart serves the last list right
// away instead of asking Raid-Helper again (1000 requests a day, utils/raidhelper/budget.js).

const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

const EMPTY = () => ({ syncedAt: 0, since: 0, events: [], error: "", errorAt: 0 });

function normalize(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return EMPTY();
    return {
        syncedAt: Number(data.syncedAt) || 0,
        since: Number(data.since) || 0,
        events: Array.isArray(data.events) ? data.events.filter((e) => e && typeof e === "object") : [],
        error: String(data.error || ""),
        errorAt: Number(data.errorAt) || 0,
    };
}

const store = createJsonStore({
    file: settingsPath("raidhelper-events.json"),
    defaults: EMPTY,
    normalize,
    cache: true,
    space: 0,
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

/** The last synced list, every field present (syncedAt 0 = never synced). */
function readSnapshot() {
    return store.read();
}

/** A successful sync: the new list replaces the old one and clears the error. */
function saveSnapshot({ syncedAt, since, events }) {
    store.write({ syncedAt, since, events: events || [], error: "", errorAt: 0 });
}

/** A failed sync: the list stays, the reason is kept for the settings page. */
function saveSyncError(message, at) {
    const current = store.read();
    store.write({ ...current, error: String(message || "").slice(0, 300), errorAt: at });
}

module.exports = { readSnapshot, saveSnapshot, saveSyncError, useFile };
