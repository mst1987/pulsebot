const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { spec: specOf, ROLES, DEFAULT_VERSION } = require("../config/gameVersions");
const { SIGNUP_STATUSES } = require("../utils/attendance");

// The signups of the EventHelper's own events (eventStore.js). Raid-Helper
// events keep theirs at Raid-Helper; nothing is mirrored in here.
//
// data/settings/signups.json: { signups: { [eventId]: { [userId]: signup } } }
// with signup = { userId, character, spec, role, characters[], status, canAlso[], comment, at }.
//
// `characters` (#293) are the raider's own characters for this raid in priority
// order: the first is the preferred one, the others "kann auch mit". The
// top-level character/spec/role always mirror characters[0], so every reader
// that knows only one character keeps working. A signup stored before #293
// has no `characters` and gets them on read (migrateSignup).
//
// `spec` is a rule-set key ("Priest-Shadow", config/gameVersions), `status` one
// of attendance.js' SIGNUP_STATUSES — so eventSources.js can hand the signups
// to every reader in the shape Raid-Helper's normalised signups already have.
const SIGNUPS_FILE = settingsPath("signups.json");

const MAX_COMMENT = 300;
const { MAX_CHARACTERS, migrateSignup, characterStatus } = require("./signupCharacters");

// Whoever wants to know that a roster changed (the bot's event message).
const listeners = new Set();

const store = createJsonStore({
    file: SIGNUPS_FILE,
    defaults: () => ({}),
    normalize: (data) => (data && data.signups && typeof data.signups === "object" ? data.signups : {}),
});

function readAll() {
    return store.read();
}

function writeAll(signups) {
    store.write({ signups });
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
        .map(migrateSignup)
        .sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
}

/** One user's signup to an event, or null. */
function getSignup(eventId, userId) {
    const byUser = readAll()[String(eventId || "")] || {};
    const found = byUser[String(userId || "")];
    return found ? migrateSignup(found) : null;
}

/**
 * Validate a signup. Every spec must exist in the event's game version; the
 * role follows from it, `canAlso` only names roles that are not the preferred
 * character's own. An absence needs no spec — somebody signing off is not
 * choosing a character.
 *
 * `characters` = [{ character, spec, status? }] in priority order (#293; a
 * character without `status` takes the signup's, the signup's status becomes
 * the first character's — an absence stores no per-character status); without it the
 * single `character`/`spec` is the one entry. The same character twice counts
 * once (its first spec); more than MAX_CHARACTERS are refused.
 * @returns {{ value?: object, error?: string }}
 */
function normalizeSignup(input = {}, { versionId = DEFAULT_VERSION } = {}) {
    const status = String(input.status || "signed").trim();
    if (!SIGNUP_STATUSES.includes(status)) return { error: `Unbekannter Anmeldestatus „${status}“.` };
    const raw = Array.isArray(input.characters)
        ? input.characters
        : [{ character: input.character, spec: input.spec }];
    const characters = [];
    const seen = new Set();
    for (const entry of raw) {
        const specKey = String((entry && entry.spec) || "").trim();
        const name = String((entry && entry.character) || "").trim();
        if (!specKey) continue;
        const found = specOf(specKey, versionId);
        if (!found) return { error: `Unbekannte Spezialisierung „${specKey}“.` };
        const key = name.toLowerCase();
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        if (characters.length >= MAX_CHARACTERS) return { error: `Höchstens ${MAX_CHARACTERS} Charaktere je Anmeldung.` };
        const entryStatus = String((entry && entry.status) || "").trim();
        if (entryStatus && !characterStatus(entryStatus)) return { error: `Unbekannter Status „${entryStatus}“ für ${name || specKey}.` };
        const out = { character: name, spec: found.key, role: found.role };
        // A character's own status (Discord's "Spät" moves only the first); an absence carries none.
        if (status !== "absence") out.status = entryStatus || status;
        characters.push(out);
    }
    const first = characters[0] || null;
    if (!first && status !== "absence") return { error: "Für eine Anmeldung fehlt die Spezialisierung." };
    const role = first ? first.role : "";
    const canAlso = [...new Set((Array.isArray(input.canAlso) ? input.canAlso : []).map((r) => String(r).trim()))]
        .filter((r) => ROLES.includes(r) && r !== role);
    const firstRaw = raw[0] || {};
    return {
        value: {
            character: first ? first.character : String(firstRaw.character || "").trim(),
            spec: first ? first.spec : "",
            role,
            characters,
            // The signup's status mirrors its first character's.
            status: first && status !== "absence" ? first.status : status,
            canAlso,
            comment: String(input.comment || "").trim().slice(0, MAX_COMMENT),
        },
    };
}

/**
 * A user's most recently saved signup with a spec, over every event — the
 * "zuletzt" of the Discord character select (#287). Without any own signup the
 * spec imported from Raid-Helper stands in (#291, specHistoryStore), marked
 * `imported` — its `character` is the name Raid-Helper had, which may not be a
 * profile character. Null without either.
 * @returns {{ eventId: string, character: string, spec: string, imported?: true }|null}
 */
function lastSignupOf(userId) {
    const own = lastOwnSignupOf(userId);
    if (own) return own;
    // Lazily: the history is only needed for a raider without any own signup.
    const imported = require("./specHistoryStore").lastImportedSpecOf(userId);
    return imported ? { eventId: imported.eventId, character: imported.character, spec: imported.spec, imported: true } : null;
}

function lastOwnSignupOf(userId) {
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
 * Every signup of one raider, keyed by event id (#312, the calendar feed).
 * One pass over the file instead of a `getSignup` per event — a raider with a
 * season of raids behind them would otherwise re-parse it a hundred times.
 */
function signupsOfUser(userId) {
    const uid = String(userId || "");
    const out = {};
    if (!uid) return out;
    for (const [eventId, byUser] of Object.entries(readAll())) {
        const s = byUser && byUser[uid];
        if (s && s.userId) out[eventId] = migrateSignup(s);
    }
    return out;
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
    listSignups, getSignup, signupsOfUser, lastSignupOf, saveSignup, removeSignup, deleteEventSignups,
    normalizeSignup, migrateSignup, onSignupsChanged, SIGNUPS_FILE, MAX_CHARACTERS, useFile: store.useFile,
};
