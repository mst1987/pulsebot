const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

// Which spec a raider signed up with at Raid-Helper, imported once when a guild
// moves to the EventHelper's own events (#291, scripts/import-raidhelper-history.js
// and Einstellungen → Verbindungen → Raid-Helper). It is *history*, not signups:
// no event is created or mirrored here, only "Zibbo came as Shadow 12 times, last
// on 03.09.". Readers use it where nothing better exists — signupStore.lastSignupOf
// falls back to it (the "zuletzt" of the Discord character select) and the
// profile page offers the specs as a suggestion.
//
// data/settings/spec-history.json:
//   { users: { [userId]: { [entryKey]: { count, lastAt, lastEventId, character, versionId } } },
//     importedEventIds: [eventId, …], runs: [{ at, byName, events, entries, users }] }
//
// Per game version (#543): the spec keys are the same in every rule set, so an
// entry carries its `versionId` and a non-TBC entry is stored under
// "<versionId>~<specKey>" — a TBC entry keeps the bare spec key it always had.
// An entry without a version is TBC (Raid-Helper only ever ran TBC raids here);
// migrateVersions() writes that down once at start.
//
// Importing is idempotent per event: an event id in `importedEventIds` is never
// counted twice, so running the import again only adds raids that are new.

const HISTORY_FILE = settingsPath("spec-history.json");
const LEGACY_VERSION = "tbc";
const SEP = "~";

/** Where an entry of this spec and version lives in a user's map. */
function entryKey(spec, versionId) {
    const v = String(versionId || LEGACY_VERSION);
    return v === LEGACY_VERSION ? spec : `${v}${SEP}${spec}`;
}

/** The spec and version of a stored entry. */
function parseEntry(key, value) {
    const at = key.indexOf(SEP);
    const spec = at === -1 ? key : key.slice(at + 1);
    const versionId = (value && value.versionId) || (at === -1 ? LEGACY_VERSION : key.slice(0, at));
    return { spec, versionId };
}

const MAX_RUNS = 20;

const store = createJsonStore({
    file: HISTORY_FILE,
    defaults: () => ({ users: {}, importedEventIds: [], runs: [] }),
    normalize: (data) => {
        return {
            users: data && typeof data.users === "object" && !Array.isArray(data.users) ? data.users : {},
            importedEventIds: Array.isArray(data.importedEventIds) ? data.importedEventIds.map(String) : [],
            runs: Array.isArray(data.runs) ? data.runs : [],
        };
    },
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

function readAll() {
    return store.read();
}

function writeAll(data) {
    store.write(data);
}

/** The event ids that were imported already. */
function importedEventIds() {
    return new Set(readAll().importedEventIds);
}

/**
 * Add imported entries. `entries` = [{ userId, spec, eventId, at (ms), character, versionId? }] (no version = TBC);
 * `eventIds` = every event the run covered (also those without a mappable
 * signup, so they are not looked at again). Entries of an event that was
 * imported before are skipped.
 * @returns {{ events: number, entries: number, users: number }}
 */
function applyImport(entries, { eventIds = [], byName = "", now = Date.now() } = {}) {
    const data = readAll();
    const done = new Set(data.importedEventIds);
    const fresh = new Set((eventIds || []).map(String).filter((id) => id && !done.has(id)));
    let added = 0;
    const users = new Set();
    for (const e of entries || []) {
        const eventId = String((e && e.eventId) || "");
        const userId = String((e && e.userId) || "");
        const spec = String((e && e.spec) || "");
        if (!fresh.has(eventId) || !userId || !spec) continue;
        const versionId = String(e.versionId || LEGACY_VERSION);
        const key = entryKey(spec, versionId);
        const byUser = data.users[userId] || {};
        const prev = byUser[key] || { count: 0, lastAt: 0, lastEventId: "", character: "" };
        const at = Number(e.at) || 0;
        const newer = at >= prev.lastAt;
        byUser[key] = {
            count: prev.count + 1,
            lastAt: newer ? at : prev.lastAt,
            lastEventId: newer ? eventId : prev.lastEventId,
            character: newer && e.character ? String(e.character).slice(0, 40) : prev.character,
            versionId,
        };
        data.users[userId] = byUser;
        users.add(userId);
        added += 1;
    }
    data.importedEventIds = [...done, ...fresh];
    const run = { at: now, byName: String(byName || "").slice(0, 100), events: fresh.size, entries: added, users: users.size };
    data.runs = [...data.runs, run].slice(-MAX_RUNS);
    writeAll(data);
    return { events: fresh.size, entries: added, users: users.size };
}

/**
 * One user's imported specs, most used first (then most recent). With
 * `versionId` only that version's (#543).
 */
function specHistoryOf(userId, { versionId = "" } = {}) {
    const byUser = readAll().users[String(userId || "")] || {};
    return Object.entries(byUser)
        .map(([key, v]) => ({ ...parseEntry(key, v), count: Number(v.count) || 0, lastAt: Number(v.lastAt) || 0, lastEventId: v.lastEventId || "", character: v.character || "" }))
        .filter((e) => !versionId || e.versionId === versionId)
        .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

/** The spec a user signed up with most recently at Raid-Helper (in `versionId`, when given), or null. */
function lastImportedSpecOf(userId, { versionId = "" } = {}) {
    const list = specHistoryOf(userId, { versionId });
    if (!list.length) return null;
    const last = list.slice().sort((a, b) => b.lastAt - a.lastAt)[0];
    return { spec: last.spec, character: last.character, eventId: last.lastEventId, at: last.lastAt };
}

/** What the retirement checklist says about the import. */
function importStatus() {
    const data = readAll();
    return {
        importedEvents: data.importedEventIds.length,
        users: Object.keys(data.users).length,
        lastRun: data.runs.length ? data.runs[data.runs.length - 1] : null,
    };
}

/**
 * One-off upgrade at start (#543, settingsMigration.js): an entry without a
 * version is a TBC one — its key stays the bare spec key. Idempotent.
 * @returns {number} how many entries got a version
 */
function migrateVersions(versionId = LEGACY_VERSION) {
    const data = readAll();
    let changed = 0;
    for (const byUser of Object.values(data.users)) {
        for (const [key, entry] of Object.entries(byUser || {})) {
            if (!entry || typeof entry !== "object" || entry.versionId) continue;
            entry.versionId = key.includes(SEP) ? key.slice(0, key.indexOf(SEP)) : versionId;
            changed += 1;
        }
    }
    if (changed) writeAll(data);
    return changed;
}

module.exports = { useFile, applyImport, migrateVersions, importedEventIds, specHistoryOf, lastImportedSpecOf, importStatus, HISTORY_FILE };
