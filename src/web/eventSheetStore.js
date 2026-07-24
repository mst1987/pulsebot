const fs = require("fs");
const path = require("path");

// Records which Raid-Helper events had their setup written into a Google
// raidsheet via the admin menu (POST /admin/raids/fill). Events themselves are
// not persisted (they come from the Raid-Helper API each request), so this is
// the only local trace of "the sheet was made" — keyed by the event id.
const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const EVENT_SHEETS_FILE = path.join(SETTINGS_DIR, "event-sheets.json");

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

/** All recorded fills, newest first. */
function listEventSheets() {
    const data = readJson(EVENT_SHEETS_FILE, { events: [] });
    const events = Array.isArray(data.events) ? data.events : [];
    return events.slice().sort((a, b) => (b.filledAt || 0) - (a.filledAt || 0));
}

/** The fill record for a single event id, or null. */
function getEventSheet(eventId) {
    const id = String(eventId || "").trim();
    if (!id) return null;
    return listEventSheets().find((e) => e.eventId === id) || null;
}

/**
 * Record (or update) that an event's sheet was filled. Keyed by eventId so
 * re-filling the same event just refreshes the timestamp/summary. Returns the
 * saved record.
 */
function markEventSheetFilled(eventId, data = {}) {
    const id = String(eventId || "").trim();
    if (!id) return null;
    const events = listEventSheets();
    const match = events.find((e) => e.eventId === id);
    const clean = {
        eventId: id,
        sheetId: String(data.sheetId || (match && match.sheetId) || "").trim(),
        sheetName: String(data.sheetName || (match && match.sheetName) || "").trim(),
        playerCount: Number(data.playerCount || (match && match.playerCount) || 0),
    };
    let saved;
    if (match) {
        saved = Object.assign(match, clean, { filledAt: Date.now() });
    } else {
        saved = Object.assign(clean, { filledAt: Date.now() });
        events.push(saved);
    }
    writeJson(EVENT_SHEETS_FILE, { events });
    return saved;
}

module.exports = { listEventSheets, getEventSheet, markEventSheetFilled };
