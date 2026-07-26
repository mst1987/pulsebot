const fs = require("fs");
const path = require("path");

// Records which Raid-Helper events have a softres.it soft-reserve list created
// via the admin menu (POST /admin/raids/softres). Keyed by event id, this is the
// only local trace of the created list, so the event page can link back to it
// (view + edit URLs) instead of re-creating one every time.
const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const SOFTRES_FILE = path.join(SETTINGS_DIR, "event-softres.json");

function ensureDir() {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

function writeJson(file, data) {
    ensureDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/** All recorded softres lists, newest first. */
function listEventSoftres() {
    const data = readJson(SOFTRES_FILE, { events: [] });
    const events = Array.isArray(data.events) ? data.events : [];
    return events.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** The softres record for a single event id, or null. */
function getEventSoftres(eventId) {
    const id = String(eventId || "").trim();
    if (!id) return null;
    return listEventSoftres().find((e) => e.eventId === id) || null;
}

/**
 * Record (or replace) the softres list created for an event. Keyed by eventId so
 * re-creating just overwrites the previous link. Returns the saved record.
 */
function saveEventSoftres(eventId, data = {}) {
    const id = String(eventId || "").trim();
    if (!id) return null;
    const events = listEventSoftres().filter((e) => e.eventId !== id);
    const saved = {
        eventId: id,
        raidId: String(data.raidId || "").trim(),
        token: String(data.token || "").trim(),
        url: String(data.url || "").trim(),
        editUrl: String(data.editUrl || "").trim(),
        edition: String(data.edition || "").trim(),
        instances: Array.isArray(data.instances) ? data.instances.map(String) : [],
        amount: Number(data.amount || 1),
        hardReserveCount: Number(data.hardReserveCount || 0),
        createdAt: Date.now(),
    };
    events.push(saved);
    writeJson(SOFTRES_FILE, { events });
    return saved;
}

/**
 * Point an event at a manually chosen softres.it link instead of one created
 * via the API — e.g. a list already set up directly on softres.it. Keeps any
 * existing metadata (instances/amount/edition/hardReserveCount) and only
 * overwrites the url/editUrl (+ the raidId/token parsed back out of them, so
 * "Softres posten" and future edits still resolve to the new list).
 */
function setEventSoftresLink(eventId, { url, editUrl } = {}) {
    const id = String(eventId || "").trim();
    if (!id) return null;
    const existing = getEventSoftres(id) || {};
    const u = String(url || "").trim();
    const eu = String(editUrl || "").trim() || u;
    const raidMatch = u.match(/\/raid\/([a-zA-Z0-9]+)/);
    const tokenMatch = eu.match(/\/raid\/[a-zA-Z0-9]+\/([a-zA-Z0-9]+)/);
    return saveEventSoftres(id, {
        ...existing,
        raidId: raidMatch ? raidMatch[1] : existing.raidId,
        token: tokenMatch ? tokenMatch[1] : existing.token,
        url: u,
        editUrl: eu,
    });
}

/** Remove the record for an event id. Returns true if one was removed. */
function deleteEventSoftres(eventId) {
    const id = String(eventId || "").trim();
    const events = listEventSoftres();
    const next = events.filter((e) => e.eventId !== id);
    if (next.length === events.length) return false;
    writeJson(SOFTRES_FILE, { events: next });
    return true;
}

module.exports = {
    listEventSoftres, getEventSoftres, saveEventSoftres, setEventSoftresLink, deleteEventSoftres,
};
