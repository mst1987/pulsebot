// Member changes of a roster made in the tool (#656, the routes of #655): the
// store write and the Discord roles together, always in that order - store
// first, role second - so the gateway event of the role write finds nothing
// left to do (rosterRoleSync.js, "No loop").
//
// Every function answers `{ ok, code?, member?, roles }` and never throws for
// a refusal: `code` is a machine code the web translates (DE/EN) -
// "not_found", "bad_request", "invalid_status", "already_member",
// "not_member", "member_limit", "single_char_only", "invalid_chars",
// "note_too_long", "invalid_date", "invalid_spec"; `roles` is rosterRoleSync's answer
// ({ ok, skipped?, results }) so the page can say which role could not be
// given and why.
//
// Characters (#655): a member's `chars` are profile keys of the roster's game
// version (raiderProfileStore, `characterKeyOf(name, versionId)`), the first
// one counts. A name that is no profile character of that person is kept as
// typed ("Charakter von Hand zuweisen": the key of the name, the name itself in
// `charNames`). Without `allowMultipleChars` a member has exactly one - a
// second is refused with "single_char_only" (the store would cut it silently).
// A new member without characters gets the first profile character of the
// roster's version.
const rosterStore = require("../../stores/rosterStore");
const raiderProfileStore = require("../../stores/raiderProfileStore");
const rosterRoleSync = require("./rosterRoleSync");
const memberSpec = require("./memberSpec");
const { characterKeyOf, VERSION_KEY_SEP } = require("../../utils/loot/lootImport");

const NO_ROLES = Object.freeze({ ok: true, skipped: "unchanged", results: [] });
const CHAR_NAME_MAX = 64;
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const validUserId = (v) => /^\d{5,25}$/.test(str(v));
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const refuse = (code) => ({ ok: false, code, roles: NO_ROLES });

/** The roster and the user id, or the refusal. */
function target(rosterId, userId) {
    const roster = rosterStore.getRoster(rosterId);
    if (!roster) return { refusal: refuse("not_found") };
    if (!validUserId(userId)) return { refusal: refuse("bad_request") };
    return { roster, uid: str(userId) };
}

/** A store write that may throw a RosterError, as `{ value }` or `{ refusal }`. */
function storeWrite(fn) {
    try {
        return { value: fn() };
    } catch (e) {
        if (e && e.name === "RosterError") return { refusal: refuse(e.code) };
        throw e;
    }
}

/** The display name of one character: the one sent along, the profile's, the stored one, else what was typed. */
function displayName({ given, own, stored, text }) {
    if (given) return given;
    if (own) return own.name;
    if (stored) return stored;
    return text.includes(VERSION_KEY_SEP) ? "" : text;
}

/**
 * Characters as sent (keys or names) resolved against the person's profile in
 * the roster's version: `{ chars, charNames }` or `{ code }`.
 */
function resolveChars(roster, userId, raw, names = {}) {
    if (!Array.isArray(raw)) return { code: "invalid_chars" };
    const profile = raiderProfileStore.getProfile(userId);
    const storedNames = (roster.members[userId] || {}).charNames || {};
    const chars = [];
    const charNames = {};
    for (const entry of raw) {
        const text = str(entry);
        if (!text || text.length > CHAR_NAME_MAX) return { code: "invalid_chars" };
        const own = raiderProfileStore.findCharacter(profile, text, roster.versionId);
        const key = own ? own.key : characterKeyOf(text, roster.versionId);
        if (!key) return { code: "invalid_chars" };
        if (chars.includes(key)) continue;
        chars.push(key);
        const given = str(names[key] !== undefined ? names[key] : names[text]).slice(0, CHAR_NAME_MAX);
        const name = displayName({ given, own, stored: storedNames[key], text });
        if (name) charNames[key] = name;
    }
    if (chars.length > 1 && !roster.allowMultipleChars) return { code: "single_char_only" };
    if (chars.length > rosterStore.LIMITS.chars) return { code: "invalid_chars" };
    return { chars, charNames };
}

/** The first profile character of the roster's version as `{ chars, charNames }` (empty without one). */
function defaultChars(roster, userId) {
    const first = raiderProfileStore.firstCharacter(raiderProfileStore.getProfile(userId), roster.versionId);
    return first ? { chars: [first.key], charNames: { [first.key]: first.name } } : { chars: [], charNames: {} };
}

/** trialUntil as sent: `{ value }` (an ISO string or null) or `{ code }`. */
function trialUntilOf(raw) {
    if (raw === null || raw === "") return { value: null };
    if (typeof raw !== "string" && typeof raw !== "number") return { code: "invalid_date" };
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? { code: "invalid_date" } : { value: d.toISOString() };
}

/**
 * A member patch from the web, checked: `{ patch }` (as rosterStore.upsertMember
 * takes it) or `{ code }`. `raw`: status, chars, charNames, note, trialUntil, spec -
 * each only when present; a new member without chars gets the profile's first.
 */
function cleanPatch(roster, userId, raw, { isNew = false } = {}) {
    const p = isMap(raw) ? raw : {};
    const patch = {};
    if (p.status !== undefined) {
        if (!rosterStore.STATUSES.includes(p.status)) return { code: "invalid_status" };
        patch.status = p.status;
    }
    if (p.chars !== undefined) {
        const resolved = resolveChars(roster, userId, p.chars, isMap(p.charNames) ? p.charNames : {});
        if (resolved.code) return resolved;
        Object.assign(patch, resolved);
    } else if (isNew) {
        Object.assign(patch, defaultChars(roster, userId));
    }
    if (p.note !== undefined) {
        if (p.note !== null && typeof p.note !== "string") return { code: "bad_request" };
        const note = str(p.note);
        if (note.length > rosterStore.LIMITS.note) return { code: "note_too_long" };
        patch.note = note;
    }
    if (p.trialUntil !== undefined) {
        const until = trialUntilOf(p.trialUntil);
        if (until.code) return until;
        patch.trialUntil = until.value;
    }
    if (p.spec !== undefined) {
        const spec = cleanSpec(roster, userId, p.spec, patch.chars || (roster.members[userId] || {}).chars || []);
        if (spec.code) return spec;
        patch.spec = spec.value;
    }
    return { patch };
}

/**
 * The orga's spec for the first character ("Spec in diesem Roster"): `{ value }`
 * ("" = automatisch) or `{ code: "invalid_spec" }` - not a spec of the roster's
 * version, no character, or a spec of another class than the character is
 * known as (memberSpec.knownClassOf; an unknown class takes any spec).
 */
function cleanSpec(roster, userId, raw, chars) {
    if (raw === null || raw === "") return { value: "" };
    if (typeof raw !== "string" || !chars.length) return { code: "invalid_spec" };
    const rec = memberSpec.specRecord(raw.trim(), roster.versionId);
    if (!rec) return { code: "invalid_spec" };
    const known = memberSpec.knownClassOf(roster, userId, chars[0]);
    return known && known !== rec.classId ? { code: "invalid_spec" } : { value: rec.key };
}

/**
 * Take a user into a roster (`patch` as cleanPatch: status, chars, charNames,
 * note, trialUntil), then give the roster's roles.
 */
async function addMember(rosterId, userId, patch = {}, { actor = "" } = {}) {
    const { roster, uid, refusal } = target(rosterId, userId);
    if (refusal) return refusal;
    if (roster.members[uid]) return refuse("already_member");
    const clean = cleanPatch(roster, uid, patch, { isNew: true });
    if (clean.code) return refuse(clean.code);
    const written = storeWrite(() => rosterStore.upsertMember(roster.id, uid, clean.patch, { actor }));
    if (written.refusal) return written.refusal;
    const roles = await rosterRoleSync.applyMemberAdded(roster.id, uid, { actor });
    return { ok: true, member: written.value, roles };
}

/**
 * Change a member: status, characters (the order counts - a reorder is just
 * the new order), note and trialUntil in one history line; a status change
 * then moves trialRoleId like setStatus.
 */
async function updateMember(rosterId, userId, patch = {}, { actor = "" } = {}) {
    const { roster, uid, refusal } = target(rosterId, userId);
    if (refusal) return refusal;
    const current = roster.members[uid];
    if (!current) return refuse("not_member");
    const clean = cleanPatch(roster, uid, patch);
    if (clean.code) return refuse(clean.code);
    if (!Object.keys(clean.patch).length) return { ok: true, member: current, roles: NO_ROLES };
    const member = rosterStore.upsertMember(roster.id, uid, clean.patch, { actor });
    const roles = member.status !== current.status
        ? await rosterRoleSync.applyStatusChange(roster.id, uid, current.status, member.status, { actor })
        : NO_ROLES;
    return { ok: true, member, roles };
}

/** Take a user out of a roster, then take every role of the roster from them. */
async function removeMember(rosterId, userId, { actor = "" } = {}) {
    const { roster, uid, refusal } = target(rosterId, userId);
    if (refusal) return refusal;
    if (!roster.members[uid]) return refuse("not_member");
    rosterStore.removeMember(roster.id, uid, { actor });
    const roles = await rosterRoleSync.applyMemberRemoved(roster.id, uid, { actor });
    return { ok: true, roles };
}

/** Change a member's status, then move trialRoleId when trial is involved. */
async function setStatus(rosterId, userId, status, { actor = "" } = {}) {
    const { roster, uid, refusal } = target(rosterId, userId);
    if (refusal) return refusal;
    const current = roster.members[uid];
    if (!current) return refuse("not_member");
    if (!rosterStore.STATUSES.includes(status)) return refuse("invalid_status");
    if (current.status === status) return { ok: true, member: current, roles: NO_ROLES };
    const member = rosterStore.upsertMember(roster.id, uid, { status }, { actor });
    const roles = await rosterRoleSync.applyStatusChange(roster.id, uid, current.status, status, { actor });
    return { ok: true, member, roles };
}

module.exports = { addMember, updateMember, removeMember, setStatus, cleanPatch, defaultChars, NO_ROLES };
