const fs = require("fs");
const path = require("path");

// Which spec a raider signed up with at Raid-Helper, imported once when a guild
// moves to the EventHelper's own events (#291, scripts/import-raidhelper-history.js
// and Einstellungen → Verbindungen → Raid-Helper). It is *history*, not signups:
// no event is created or mirrored here, only "Zibbo came as Shadow 12 times, last
// on 03.09.". Readers use it where nothing better exists — signupStore.lastSignupOf
// falls back to it (the "zuletzt" of the Discord character select) and the
// profile page offers the specs as a suggestion.
//
// data/settings/spec-history.json:
//   { users: { [userId]: { [specKey]: { count, lastAt, lastEventId, character } } },
//     importedEventIds: [eventId, …], runs: [{ at, byName, events, entries, users }] }
//
// Importing is idempotent per event: an event id in `importedEventIds` is never
// counted twice, so running the import again only adds raids that are new.

const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const HISTORY_FILE = path.join(SETTINGS_DIR, "spec-history.json");
let historyFile = HISTORY_FILE;

const MAX_RUNS = 20;

/** Tests only: read and write another file. */
function useFile(file) {
    historyFile = file || HISTORY_FILE;
}

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(historyFile, "utf8"));
        return {
            users: data && typeof data.users === "object" && !Array.isArray(data.users) ? data.users : {},
            importedEventIds: Array.isArray(data.importedEventIds) ? data.importedEventIds.map(String) : [],
            runs: Array.isArray(data.runs) ? data.runs : [],
        };
    } catch {
        return { users: {}, importedEventIds: [], runs: [] };
    }
}

function writeAll(data) {
    fs.mkdirSync(path.dirname(historyFile), { recursive: true });
    fs.writeFileSync(historyFile, JSON.stringify(data, null, 2));
}

/** The event ids that were imported already. */
function importedEventIds() {
    return new Set(readAll().importedEventIds);
}

/**
 * Add imported entries. `entries` = [{ userId, spec, eventId, at (ms), character }];
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
        const byUser = data.users[userId] || {};
        const prev = byUser[spec] || { count: 0, lastAt: 0, lastEventId: "", character: "" };
        const at = Number(e.at) || 0;
        const newer = at >= prev.lastAt;
        byUser[spec] = {
            count: prev.count + 1,
            lastAt: newer ? at : prev.lastAt,
            lastEventId: newer ? eventId : prev.lastEventId,
            character: newer && e.character ? String(e.character).slice(0, 40) : prev.character,
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

/** One user's imported specs, most used first (then most recent). */
function specHistoryOf(userId) {
    const byUser = readAll().users[String(userId || "")] || {};
    return Object.entries(byUser)
        .map(([spec, v]) => ({ spec, count: Number(v.count) || 0, lastAt: Number(v.lastAt) || 0, lastEventId: v.lastEventId || "", character: v.character || "" }))
        .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

/** The spec a user signed up with most recently at Raid-Helper, or null. */
function lastImportedSpecOf(userId) {
    const list = specHistoryOf(userId);
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

module.exports = { useFile, applyImport, importedEventIds, specHistoryOf, lastImportedSpecOf, importStatus, HISTORY_FILE };
