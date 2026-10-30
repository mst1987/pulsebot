// Who already counted as "signed up" for the orga's hint about Vermerke at signup
// (docs/vermerke.md, #983): one mark per raid and person, set at the first
// signup while the server has the hint switched on. A later change of status or
// role, a sign-off and a new signup find the mark and bring no second line.
//
// `data/settings/orga-signup-notices.json` = { events: { [eventId]: { [userId]: at } } }
//
//   at = when the first signup was noted (ms). A raid's marks go once all of
//   them are older than RETENTION_DAYS (pruned on every write).
//
// Nothing about a Vermerk is stored here - only that a person signed up for a
// raid, which the signups say anyway.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

function normalize(data) {
    const events = {};
    for (const [eventId, people] of Object.entries(isObject(data && data.events) ? data.events : {})) {
        if (!str(eventId) || !isObject(people)) continue;
        const block = {};
        for (const [userId, at] of Object.entries(people)) if (str(userId) && Number(at) > 0) block[str(userId)] = Number(at);
        if (Object.keys(block).length) events[str(eventId)] = block;
    }
    return { events };
}

const store = createJsonStore({
    file: settingsPath("orga-signup-notices.json"),
    defaults: () => ({ events: {} }),
    normalize,
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

/** True when the person already has a mark at this raid. */
function hasMark(eventId, userId) {
    const block = store.read().events[str(eventId)];
    return !!(block && block[str(userId)]);
}

/**
 * Set the mark of a person at a raid. Returns true when it is new, false when
 * there already was one (then nothing is written).
 */
function markOnce(eventId, userId, { now = Date.now() } = {}) {
    const eid = str(eventId);
    const uid = str(userId);
    if (!eid || !uid) return false;
    const data = store.read();
    if (data.events[eid] && data.events[eid][uid]) return false;
    data.events[eid] = { ...(data.events[eid] || {}), [uid]: now };
    const cutoff = now - RETENTION_DAYS * DAY_MS;
    for (const [id, block] of Object.entries(data.events)) {
        if (Object.values(block).every((at) => at < cutoff)) delete data.events[id];
    }
    store.write(data);
    return true;
}

module.exports = { hasMark, markOnce, useFile, RETENTION_DAYS };
