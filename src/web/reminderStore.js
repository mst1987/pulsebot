// Which automatic reminders already went out (#264), so every reminder is sent
// exactly once per event and kind — across restarts, and however often the
// sweep in reminders.js runs.
//
// `data/settings/reminders-sent.json` = { events: { [eventId]: { [kind]: at } } }
// with kind "missing" | "signed" and `at` the ms timestamp it was marked. Old
// marks are pruned once the raid is long over; nothing else reads them.

const fs = require("fs");
const path = require("path");

let file = path.join(__dirname, "..", "..", "data", "settings", "reminders-sent.json");

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        return data && data.events && typeof data.events === "object" && !Array.isArray(data.events) ? data.events : {};
    } catch {
        return {};
    }
}

function writeAll(events) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ events }, null, 2));
}

/** The marks of one event: `{ [kind]: at }`, empty when nothing was sent. */
function getSent(eventId) {
    return { ...(readAll()[String(eventId)] || {}) };
}

/**
 * Mark a reminder as sent. Returns false when it already was — the caller then
 * must not send it, which is what makes the sweep safe to run twice.
 */
function markSent(eventId, kind, at = Date.now()) {
    const id = String(eventId || "");
    if (!id || !kind) return false;
    const events = readAll();
    const marks = events[id] || {};
    if (marks[kind]) return false;
    events[id] = { ...marks, [kind]: at };
    writeAll(events);
    return true;
}

/** Take a mark back (the send failed), so the next sweep tries again. */
function clearSent(eventId, kind) {
    const id = String(eventId || "");
    const events = readAll();
    if (!events[id] || !events[id][kind]) return false;
    delete events[id][kind];
    if (!Object.keys(events[id]).length) delete events[id];
    writeAll(events);
    return true;
}

/** Drop marks older than `maxAgeMs` (default 30 days). Returns how many events were dropped. */
function prune(maxAgeMs = 30 * 24 * 60 * 60 * 1000, now = Date.now()) {
    const events = readAll();
    let dropped = 0;
    for (const [id, marks] of Object.entries(events)) {
        const newest = Math.max(0, ...Object.values(marks).map(Number).filter(Number.isFinite));
        if (now - newest > maxAgeMs) {
            delete events[id];
            dropped += 1;
        }
    }
    if (dropped) writeAll(events);
    return dropped;
}

/** Test-only: point the store at another file. */
function _setFileForTests(next) {
    file = next;
}

module.exports = { getSent, markSent, clearSent, prune, _setFileForTests };
