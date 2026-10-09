// Raid nights whose attendance the orga set by hand (#677).
//
// The attendance itself is derived on read (services/characters/rosterAttendance.js):
// the log, the signup, the setup's bench, an absence entry. Where that is wrong
// - a raider stood in for somebody and is not in the log under their own name,
// a bench player went home early, a sign-off that came by whisper - the orga
// overrides one night for one Discord account. An override always wins over the
// automatic verdict; "Automatisch" removes it again.
//
// `data/settings/attendance-overrides.json` =
//   { overrides: { [eventId]: { [userId]: { status, reason, by, byName, at } } } }
//
//   status  one of STATUSES (the attendance codes of rosterAttendance.js)
//   reason  the orga's free text, at most REASON_MAX characters ("" = none)
//   by      the Discord id of whoever set it, byName their name at that moment
//   at      when (ms)
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

/** The attendance codes a night can be set to — the same as the automatic ones. */
const STATUSES = ["present", "bench", "vacation", "absence", "noSignup", "noShow"];
const REASON_MAX = 200;
const NAME_MAX = 80;

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** One stored override, or null when it is not one. */
function clean(entry) {
    if (!isObject(entry) || !STATUSES.includes(entry.status)) return null;
    return {
        status: entry.status,
        reason: str(entry.reason).slice(0, REASON_MAX),
        by: str(entry.by),
        byName: str(entry.byName).slice(0, NAME_MAX),
        at: Number(entry.at) || 0,
    };
}

function normalize(data) {
    const out = {};
    const all = isObject(data && data.overrides) ? data.overrides : {};
    for (const [eventId, perUser] of Object.entries(all)) {
        if (!str(eventId) || !isObject(perUser)) continue;
        const users = {};
        for (const [userId, entry] of Object.entries(perUser)) {
            const c = str(userId) ? clean(entry) : null;
            if (c) users[str(userId)] = c;
        }
        if (Object.keys(users).length) out[str(eventId)] = users;
    }
    return out;
}

const store = createJsonStore({
    file: settingsPath("attendance-overrides.json"),
    defaults: () => ({}),
    normalize,
    cache: true,
});

/** Every override: `{ [eventId]: { [userId]: entry } }`. */
function listOverrides() {
    return store.read();
}

/** The overrides of one raid night: `{ [userId]: entry }` ({} without any). */
function overridesForEvent(eventId) {
    return listOverrides()[str(eventId)] || {};
}

/** One account's override of one night, or null. */
function getOverride(eventId, userId) {
    return overridesForEvent(eventId)[str(userId)] || null;
}

/**
 * Set one night of one account. Returns the stored entry, or `{ error }` with a
 * code: "bad_request" (no event or account), "invalid_status", "reason_too_long".
 */
function setOverride(eventId, userId, { status, reason = "", by = "", byName = "" } = {}, { now = Date.now() } = {}) {
    const eid = str(eventId);
    const uid = str(userId);
    if (!eid || !uid) return { error: "bad_request" };
    if (!STATUSES.includes(status)) return { error: "invalid_status" };
    if (str(reason).length > REASON_MAX) return { error: "reason_too_long" };
    const entry = clean({ status, reason, by, byName, at: now });
    const all = listOverrides();
    all[eid] = { ...(all[eid] || {}), [uid]: entry };
    store.write({ overrides: all });
    return entry;
}

/** Back to the automatic verdict. True when there was an override to remove. */
function clearOverride(eventId, userId) {
    const eid = str(eventId);
    const uid = str(userId);
    const all = listOverrides();
    if (!all[eid] || !all[eid][uid]) return false;
    delete all[eid][uid];
    if (!Object.keys(all[eid]).length) delete all[eid];
    store.write({ overrides: all });
    return true;
}

module.exports = {
    STATUSES, REASON_MAX,
    listOverrides, overridesForEvent, getOverride, setOverride, clearOverride,
    useFile: store.useFile,
};
