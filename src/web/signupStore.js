const fs = require("fs");
const path = require("path");
const { spec: specOf, ROLES, DEFAULT_VERSION } = require("../config/gameVersions");
const { SIGNUP_STATUSES } = require("../utils/attendance");

// The signups of the EventHelper's own events (eventStore.js). Raid-Helper
// events keep theirs at Raid-Helper; nothing is mirrored in here.
//
// data/settings/signups.json: { signups: { [eventId]: { [userId]: signup } } }
// with signup = { userId, character, spec, role, status, canAlso[], comment, at }.
//
// `spec` is a rule-set key ("Priest-Shadow", config/gameVersions), `status` one
// of attendance.js' SIGNUP_STATUSES — so eventSources.js can hand the signups
// to every reader in the shape Raid-Helper's normalised signups already have.
const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const SIGNUPS_FILE = path.join(SETTINGS_DIR, "signups.json");

const MAX_COMMENT = 300;

// Whoever wants to know that a roster changed (the bot's event message).
const listeners = new Set();

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(SIGNUPS_FILE, "utf8"));
        return data && data.signups && typeof data.signups === "object" ? data.signups : {};
    } catch {
        return {};
    }
}

function writeAll(signups) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    fs.writeFileSync(SIGNUPS_FILE, JSON.stringify({ signups }, null, 2));
}

function notify(eventId) {
    for (const fn of listeners) {
        try {
            fn(eventId);
        } catch (e) {
            console.error("[signupStore] listener failed:", e.message);
        }
    }
}

/** Subscribe to roster changes; the listener gets the event id. Returns the unsubscribe function. */
function onSignupsChanged(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** An event's signups, oldest first (the order people reacted in). */
function listSignups(eventId) {
    const byUser = readAll()[String(eventId || "")] || {};
    return Object.values(byUser)
        .filter((s) => s && s.userId)
        .sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
}

/** One user's signup to an event, or null. */
function getSignup(eventId, userId) {
    const byUser = readAll()[String(eventId || "")] || {};
    return byUser[String(userId || "")] || null;
}

/**
 * Validate a signup. The spec must exist in the event's game version; the role
 * follows from it, `canAlso` only names roles that are not the spec's own.
 * An absence needs no spec — somebody signing off is not choosing a character.
 * @returns {{ value?: object, error?: string }}
 */
function normalizeSignup(input = {}, { versionId = DEFAULT_VERSION } = {}) {
    const status = String(input.status || "signed").trim();
    if (!SIGNUP_STATUSES.includes(status)) return { error: `Unbekannter Anmeldestatus „${status}“.` };
    const specKey = String(input.spec || "").trim();
    const found = specKey ? specOf(specKey, versionId) : null;
    if (specKey && !found) return { error: `Unbekannte Spezialisierung „${specKey}“.` };
    if (!found && status !== "absence") return { error: "Für eine Anmeldung fehlt die Spezialisierung." };
    const role = found ? found.role : "";
    const canAlso = [...new Set((Array.isArray(input.canAlso) ? input.canAlso : []).map((r) => String(r).trim()))]
        .filter((r) => ROLES.includes(r) && r !== role);
    return {
        value: {
            character: String(input.character || "").trim(),
            spec: found ? found.key : "",
            role,
            status,
            canAlso,
            comment: String(input.comment || "").trim().slice(0, MAX_COMMENT),
        },
    };
}

/**
 * A user's most recently saved signup with a spec, over every event — the
 * "zuletzt" of the Discord character select (#287). Null without one.
 * @returns {{ eventId: string, character: string, spec: string }|null}
 */
function lastSignupOf(userId) {
    const uid = String(userId || "");
    if (!uid) return null;
    let best = null;
    let bestAt = -1;
    for (const [eventId, byUser] of Object.entries(readAll())) {
        const s = byUser && byUser[uid];
        if (!s || !s.spec || s.status === "absence") continue;
        const at = Number(s.updatedAt) || Number(s.at) || 0;
        if (at > bestAt) {
            best = { eventId, character: s.character || "", spec: s.spec };
            bestAt = at;
        }
    }
    return best;
}

/**
 * Create or replace a user's signup. `at` is kept from a previous signup, so
 * changing the spec does not move somebody to the end of the list.
 * @returns {{ signup?: object, error?: string }}
 */
function saveSignup(eventId, userId, input, opts) {
    const eid = String(eventId || "").trim();
    const uid = String(userId || "").trim();
    if (!eid || !uid) return { error: "Event oder Nutzer fehlt." };
    const checked = normalizeSignup(input, opts);
    if (checked.error) return { error: checked.error };
    const all = readAll();
    const byUser = all[eid] || {};
    const previous = byUser[uid];
    const signup = { userId: uid, ...checked.value, at: (previous && previous.at) || Date.now(), updatedAt: Date.now() };
    all[eid] = { ...byUser, [uid]: signup };
    writeAll(all);
    notify(eid);
    return { signup };
}

/** Remove a user's signup. Returns true when there was one. */
function removeSignup(eventId, userId) {
    const eid = String(eventId || "");
    const all = readAll();
    if (!all[eid] || !all[eid][String(userId || "")]) return false;
    delete all[eid][String(userId)];
    if (!Object.keys(all[eid]).length) delete all[eid];
    writeAll(all);
    notify(eid);
    return true;
}

/** Drop every signup of an event (the event itself was deleted). */
function deleteEventSignups(eventId) {
    const all = readAll();
    if (!all[String(eventId || "")]) return false;
    delete all[String(eventId)];
    writeAll(all);
    return true;
}

module.exports = {
    listSignups, getSignup, lastSignupOf, saveSignup, removeSignup, deleteEventSignups,
    normalizeSignup, onSignupsChanged, SIGNUPS_FILE,
};
