// The Raid-Helper event lists as the sync job last fetched them (services/events/
// raidhelperSync.js) — the only copy every page, bot command and job reads.
//
// `data/settings/raidhelper-events.json` = { servers: { [guildId]: { syncedAt,
// since, events, error, errorAt } } } — one list per Discord server with
// Raid-Helper switched on (#927, utils/raidhelper/servers.js): `events` is
// Raid-Helper's `postedEvents` (signups included) of every event that starts at
// or after `since` (unix seconds), as of `syncedAt` (ms). `error`/`errorAt`
// describe the last failed sync of that server; a failure keeps the list of the
// last good one. On disk so a restart serves the last lists right away instead
// of asking Raid-Helper again (1000 requests a day, utils/raidhelper/budget.js).
//
// A file from before #927 held one flat list. It is read as `legacy` until the
// start migration (settingsMigration.migrateRaidhelperServers) hands it to the
// server that owned Raid-Helper back then (moveLegacy).

const { settingsPath } = require("../../config/paths");
const { createJsonStore } = require("../jsonStore");

const EMPTY_LIST = () => ({ syncedAt: 0, since: 0, events: [], error: "", errorAt: 0 });
const EMPTY = () => ({ servers: {} });

const isMap = (value) => !!value && typeof value === "object" && !Array.isArray(value);

function normalizeList(data) {
    if (!isMap(data)) return EMPTY_LIST();
    return {
        syncedAt: Number(data.syncedAt) || 0,
        since: Number(data.since) || 0,
        events: Array.isArray(data.events) ? data.events.filter((e) => e && typeof e === "object") : [],
        error: String(data.error || ""),
        errorAt: Number(data.errorAt) || 0,
    };
}

// The flat shape of one list (before #927): it has an `events` array or a sync time.
const isFlat = (data) => Array.isArray(data.events) || "syncedAt" in data || "errorAt" in data;

function normalize(data) {
    if (!isMap(data)) return EMPTY();
    if (!isMap(data.servers) && isFlat(data)) return { servers: {}, legacy: normalizeList(data) };
    const servers = {};
    for (const [guildId, list] of Object.entries(isMap(data.servers) ? data.servers : {})) {
        if (guildId) servers[guildId] = normalizeList(list);
    }
    const out = { servers };
    if (isMap(data.legacy)) out.legacy = normalizeList(data.legacy);
    return out;
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

const key = (guildId) => String(guildId || "").trim();

/**
 * The last synced list of one server, every field present (syncedAt 0 = never
 * synced). Without a guild id: every server's lists in one (the latest sync
 * time, all events) — for readers that only look an event up by its id.
 */
function readSnapshot(guildId) {
    const data = store.read();
    if (guildId !== undefined) return data.servers[key(guildId)] || EMPTY_LIST();
    const lists = Object.values(data.servers);
    if (!lists.length) return EMPTY_LIST();
    return {
        syncedAt: Math.max(...lists.map((l) => l.syncedAt)),
        since: Math.min(...lists.map((l) => l.since)),
        events: lists.flatMap((l) => l.events),
        error: "",
        errorAt: 0,
    };
}

/** The servers that have a list (synced or failed). */
function snapshotGuilds() {
    return Object.keys(store.read().servers);
}

function writeServer(guildId, list) {
    const data = store.read();
    store.write({ ...data, servers: { ...data.servers, [key(guildId)]: normalizeList(list) } });
}

/** A successful sync of one server: the new list replaces the old one and clears the error. */
function saveSnapshot(guildId, { syncedAt, since, events }) {
    writeServer(guildId, { syncedAt, since, events: events || [], error: "", errorAt: 0 });
}

/** A failed sync of one server: its list stays, the reason is kept for the settings page. */
function saveSyncError(guildId, message, at) {
    const current = readSnapshot(guildId);
    writeServer(guildId, { ...current, error: String(message || "").slice(0, 300), errorAt: at });
}

/**
 * The list of a file from before #927 goes to `guildId` (the start migration).
 * Idempotent: nothing happens once there is no legacy list; a list the server
 * already has wins. Returns whether it wrote.
 */
function moveLegacy(guildId) {
    const data = store.read();
    if (!data.legacy) return false;
    const servers = { ...data.servers };
    const id = key(guildId);
    if (id && !servers[id]) servers[id] = data.legacy;
    store.write({ servers });
    return true;
}

module.exports = { readSnapshot, snapshotGuilds, saveSnapshot, saveSyncError, moveLegacy, useFile };
