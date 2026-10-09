// Raid rosters (#653, docs/roster-profile.md "Roster je Kategorie (Store)"):
// who belongs to a raid, with a status, their characters and who may manage it.
//
//   data/settings/rosters.json = {
//     rosters: { [rosterId]: {
//       id, guildId, name,                  // name free (≤ 40), default = category name
//       categoryId | null,                  // at most one roster per category
//       versionId,                          // game version of its characters
//       roleIds: [],                        // Discord roles that mean "in the roster" (first = main role)
//       trialRoleId: null,                  // optional extra role for status "trial"
//       managers: { roleIds: [], userIds: [] },   // ≤ 20 each: who manages this roster
//       slots: { total, tank, healer, bench },
//       allowMultipleChars: false,          // off: a member keeps at most one character
//       signupOnly: false,
//       source: { kind: "manual" | "kader" | "migration", kaderId? },
//       kaderId | null,                     // the Kader of the Kaderplaner linked to it (1:1, see below)
//       lootSystem: "" | "softres" | "lootcouncil" | "gdkp" | "other",  // only read WITHOUT category (#676)
//       lootProfileId: "",                  // its Loot-Council profile ("" = the default profile, #676)
//       members: { [userId]: {              // ≤ 500
//         status: "core" | "trial" | "bench" | "pause", since, by,
//         chars: [charKey],                 // profile keys (characterKeyOf(name, versionId))
//         charNames: { [charKey]: name },   // the name as it was entered, for display
//         note,                             // ≤ 500
//         spec,                             // "" or the orga's spec key for the first character
//         trialUntil | null } },
//       history: [{ at, by, userId, what, detail }],   // the newest 500
//       createdAt, createdBy } },
//     migratedCategories: [categoryId]      // categories the start-up migration handled
//   }
//
// Normalised strictly on every read and write: unknown fields drop out, limits
// are cut. `charNames` is the one field beyond the issue's shape: a key is the
// lower-case name without realm, and the facade in raiderCharactersStore.js has
// to hand out the name exactly as it was assigned ("Keslight-Thunderstrike"),
// so the name rides along with its key.
//
// `migratedCategories` makes the migration (settingsMigration.js) run once per
// category: a roster deleted afterwards is not created again on the next start.
//
// `kaderId` is the explicit link to a Kader of the Kaderplaner, independent of
// `source` (a migrated roster can be linked too): a Kader belongs to one roster
// at most ("kader_taken"). A roster stored before the field existed gets the
// Kader it was created from (`source.kaderId`); `null` stored means unlinked.
//
// A member's `spec` is the orga's choice of spec for the first character in
// this roster ("Spec in diesem Roster"): a spec key of the roster's version, ""
// for "automatisch". It is cleared when the first character changes; that it
// belongs to the character's class is the writer's check
// (services/roster/rosterMembers.js) and the reader's (memberSpec.js).
//
// `lootSystem` and `lootProfileId` (#676): a roster WITH category runs on the
// category's loot system (config.categoryLootSystem, services/loot/lootSystem.js
// rosterLootSystem) - its stored `lootSystem` is ignored then, so there is one
// truth; a roster without category keeps its own here. `lootProfileId` names
// its Loot-Council profile (councilProfilesStore.js); that it exists is the
// writer's check (services/roster/rosterSettings.js), a reader falls back to
// the default profile (services/loot/councilProfiles.js).
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { newId } = require("../utils/ids");
const { characterKeyOf, VERSION_KEY_SEP } = require("../utils/loot/lootImport");
const { knownVersion, mainVersionFor } = require("../services/events/mainVersion");
const { spec: specOfVersion } = require("../config/gameVersions");
const { normalizeLootSystem } = require("../services/loot/lootSystem");

const ROSTERS_FILE = settingsPath("rosters.json");

const LIMITS = Object.freeze({
    name: 40,
    note: 500,
    members: 500,
    managers: 20,
    roleIds: 20,
    chars: 12,
    history: 500,
    charName: 64,
    what: 40,
    detail: 200,
    slot: 200,
});
const STATUSES = ["core", "trial", "bench", "pause"];
const SOURCE_KINDS = ["manual", "kader", "migration"];
const ID_MAX = 32;

const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const text = (v, max) => str(v).slice(0, max);
const idOf = (v) => {
    const s = str(v);
    return s && s.length <= ID_MAX ? s : "";
};

class RosterError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = "RosterError";
        this.code = code;
    }
}

/** A list of ids (users, roles): trimmed, non-empty, unique, at most `max`. */
function idList(raw, max) {
    const out = [];
    for (const v of Array.isArray(raw) ? raw : []) {
        const id = idOf(v);
        if (id && !out.includes(id)) out.push(id);
        if (out.length >= max) break;
    }
    return out;
}

/** A moment as an ISO string: a valid date string or a number, else `fallback`. */
function isoOf(raw, fallback = "") {
    if (raw === null || raw === undefined || raw === "") return fallback;
    const d = new Date(typeof raw === "number" ? raw : String(raw));
    return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

const slotOf = (v) => Math.max(0, Math.min(LIMITS.slot, Math.floor(Number(v) || 0)));

function normalizeSlots(raw) {
    const s = isMap(raw) ? raw : {};
    return { total: slotOf(s.total), tank: slotOf(s.tank), healer: slotOf(s.healer), bench: slotOf(s.bench) };
}

function normalizeSource(raw) {
    const s = isMap(raw) ? raw : {};
    const kind = SOURCE_KINDS.includes(s.kind) ? s.kind : "manual";
    const kaderId = kind === "kader" ? idOf(s.kaderId) : "";
    return kaderId ? { kind, kaderId } : { kind };
}

/** Character keys: lower-case, unique; one at most without `multi`. */
function normalizeChars(raw, multi) {
    const out = [];
    for (const v of Array.isArray(raw) ? raw : []) {
        const key = characterKeyOf(v);
        if (key && key.length <= 80 && !out.includes(key)) out.push(key);
    }
    return out.slice(0, multi ? LIMITS.chars : 1);
}

function normalizeCharNames(raw, chars) {
    const src = isMap(raw) ? raw : {};
    const out = {};
    for (const key of chars) {
        const name = text(src[key], LIMITS.charName);
        if (name) out[key] = name;
    }
    return out;
}

/** A spec key of the version's rule set ("Druid-Balance"), else "". */
function specKeyOf(raw, versionId) {
    const key = str(raw);
    if (!key) return "";
    const found = specOfVersion(key, versionId);
    return found ? found.key : "";
}

/** One member, or null for something that is not one. */
function normalizeMember(raw, multi, versionId) {
    if (!isMap(raw)) return null;
    const chars = normalizeChars(raw.chars, multi);
    return {
        status: STATUSES.includes(raw.status) ? raw.status : "core",
        since: isoOf(raw.since),
        by: idOf(raw.by),
        chars,
        charNames: normalizeCharNames(raw.charNames, chars),
        note: text(raw.note, LIMITS.note),
        // without a character there is nothing a spec could belong to
        spec: chars.length ? specKeyOf(raw.spec, versionId) : "",
        trialUntil: isoOf(raw.trialUntil, null),
    };
}

function normalizeMembers(raw, multi, versionId) {
    const out = {};
    let count = 0;
    for (const [userId, member] of Object.entries(isMap(raw) ? raw : {})) {
        if (count >= LIMITS.members) break;
        const uid = idOf(userId);
        const m = uid ? normalizeMember(member, multi, versionId) : null;
        if (!m) continue;
        out[uid] = m;
        count += 1;
    }
    return out;
}

function normalizeHistoryEntry(raw) {
    if (!isMap(raw)) return null;
    const what = text(raw.what, LIMITS.what);
    if (!what) return null;
    return {
        at: isoOf(raw.at) || new Date(0).toISOString(),
        by: idOf(raw.by),
        userId: idOf(raw.userId),
        what,
        detail: text(raw.detail, LIMITS.detail),
    };
}

/** The newest `LIMITS.history` entries, oldest first. */
function normalizeHistory(raw) {
    const list = (Array.isArray(raw) ? raw : []).map(normalizeHistoryEntry).filter(Boolean);
    return list.slice(-LIMITS.history);
}

/** One roster, or null when it lacks an id. */
function normalizeRoster(raw, id = raw && raw.id) {
    if (!isMap(raw)) return null;
    const rid = idOf(id);
    if (!rid) return null;
    const categoryId = idOf(raw.categoryId) || null;
    const multi = raw.allowMultipleChars === true;
    const managers = isMap(raw.managers) ? raw.managers : {};
    const versionId = knownVersion(raw.versionId) || mainVersionFor({ categoryId: categoryId || "" });
    const source = normalizeSource(raw.source);
    // never stored yet: the Kader it was created from; stored null = unlinked
    const kaderId = raw.kaderId === undefined ? (source.kaderId || null) : (idOf(raw.kaderId) || null);
    return {
        id: rid,
        guildId: idOf(raw.guildId),
        name: text(raw.name, LIMITS.name) || text(categoryId || rid, LIMITS.name),
        categoryId,
        versionId,
        roleIds: idList(raw.roleIds, LIMITS.roleIds),
        trialRoleId: idOf(raw.trialRoleId) || null,
        managers: { roleIds: idList(managers.roleIds, LIMITS.managers), userIds: idList(managers.userIds, LIMITS.managers) },
        slots: normalizeSlots(raw.slots),
        allowMultipleChars: multi,
        signupOnly: raw.signupOnly === true,
        source,
        kaderId,
        lootSystem: normalizeLootSystem(raw.lootSystem),
        lootProfileId: /^[a-z0-9_-]{1,40}$/i.test(str(raw.lootProfileId)) ? str(raw.lootProfileId) : "",
        members: normalizeMembers(raw.members, multi, versionId),
        history: normalizeHistory(raw.history),
        createdAt: isoOf(raw.createdAt),
        createdBy: idOf(raw.createdBy),
    };
}

/**
 * The whole file: rosters by id (a second roster of a category drops out, a
 * second link to the same Kader is cut) and the migrated categories.
 */
function normalizeFile(data) {
    const src = isMap(data) ? data : {};
    const rosters = {};
    const categories = new Set();
    const kaders = new Set();
    for (const [id, raw] of Object.entries(isMap(src.rosters) ? src.rosters : {})) {
        const r = normalizeRoster(raw, id);
        if (!r) continue;
        if (r.categoryId && categories.has(r.categoryId)) continue;
        if (r.categoryId) categories.add(r.categoryId);
        if (r.kaderId && kaders.has(r.kaderId)) r.kaderId = null;
        if (r.kaderId) kaders.add(r.kaderId);
        rosters[r.id] = r;
    }
    return { rosters, migratedCategories: idList(src.migratedCategories, 10000) };
}

const store = createJsonStore({
    file: ROSTERS_FILE,
    defaults: () => ({ rosters: {}, migratedCategories: [] }),
    normalize: normalizeFile,
});

function readAll() {
    return store.read();
}

function writeAll(data) {
    store.write(normalizeFile(data));
}

/** Every roster of a server ("" = of every server), by name. */
function listRosters(guildId = "") {
    const gid = str(guildId);
    return Object.values(readAll().rosters)
        .filter((r) => !gid || r.guildId === gid)
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** One roster by id, or null. */
function getRoster(id) {
    return readAll().rosters[str(id)] || null;
}

/** The roster of a raid category, or null. */
function rosterForCategory(categoryId) {
    const cat = str(categoryId);
    if (!cat) return null;
    return Object.values(readAll().rosters).find((r) => r.categoryId === cat) || null;
}

const KADER_TAKEN = "Dieser Kader ist schon mit einem anderen Roster verknüpft.";

/** Whether a roster other than `exceptId` is linked to the Kader. */
function kaderTaken(all, kaderId, exceptId) {
    return Object.values(all.rosters).some((r) => r.id !== exceptId && r.kaderId === kaderId);
}

/** The roster linked to a Kader (`kaderId`) on that server ("" = any), or null. */
function rosterForKader(kaderId, guildId = "") {
    const id = str(kaderId);
    const gid = str(guildId);
    if (!id) return null;
    return Object.values(readAll().rosters).find((r) => r.kaderId === id && (!gid || r.guildId === gid)) || null;
}

/** A short, readable id unique in `taken`: the name as a slug plus a random part. */
function makeId(name, taken) {
    const slug = str(name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20);
    for (;;) {
        const id = `${slug || "roster"}-${newId(3)}`;
        if (!taken[id]) return id;
    }
}

function historyEntry({ at, by, userId = "", what, detail = "" }) {
    return normalizeHistoryEntry({ at, by, userId, what, detail });
}

/**
 * A category that got a roster in the tool counts as migrated: deleting that
 * roster later must not bring a migrated one back on the next start (its roles
 * are mirrored into config.categoryRoles, which the migration reads).
 */
function markMigrated(all, categoryId) {
    if (categoryId && !all.migratedCategories.includes(categoryId)) all.migratedCategories.push(categoryId);
}

const FIXED_FIELDS = ["id", "members", "history", "createdAt", "createdBy"];

/**
 * A new roster. `data` as the stored shape (missing fields get their defaults);
 * `name` defaults to the category id. Throws RosterError "category_taken" when
 * the category already has a roster, "invalid_name" without name and category.
 * @returns {object} the stored roster
 */
function createRoster(data = {}, { actor = "", now = new Date().toISOString() } = {}) {
    const all = readAll();
    const categoryId = idOf(data.categoryId) || null;
    if (categoryId && Object.values(all.rosters).some((r) => r.categoryId === categoryId)) {
        throw new RosterError("category_taken", "Diese Kategorie hat schon ein Roster.");
    }
    if (!text(data.name, LIMITS.name) && !categoryId) throw new RosterError("invalid_name", "Name fehlt.");
    const wantedKader = data.kaderId !== undefined ? idOf(data.kaderId) : idOf(normalizeSource(data.source).kaderId);
    if (wantedKader && kaderTaken(all, wantedKader, "")) throw new RosterError("kader_taken", KADER_TAKEN);
    const id = makeId(data.name || categoryId, all.rosters);
    const roster = normalizeRoster({
        ...data,
        id,
        categoryId,
        createdAt: isoOf(data.createdAt, now),
        createdBy: actor || data.createdBy,
        history: [historyEntry({ at: now, by: actor, what: "created", detail: text(data.name, LIMITS.name) })],
    }, id);
    all.rosters[id] = roster;
    markMigrated(all, categoryId);
    writeAll(all);
    return getRoster(id);
}

/**
 * Change a roster's settings. `patch` may hold every field but id, members,
 * history, createdAt and createdBy (members go through upsertMember). Moving it
 * to a category that has another roster throws RosterError "category_taken".
 * @returns {object|null} the stored roster, null when there is none
 */
function updateRoster(id, patch = {}, { actor = "", now = new Date().toISOString() } = {}) {
    const all = readAll();
    const current = all.rosters[str(id)];
    if (!current) return null;
    const clean = { ...(isMap(patch) ? patch : {}) };
    for (const key of FIXED_FIELDS) delete clean[key];
    if (clean.managers !== undefined) clean.managers = { ...current.managers, ...(isMap(clean.managers) ? clean.managers : {}) };
    if (clean.slots !== undefined) clean.slots = { ...current.slots, ...(isMap(clean.slots) ? clean.slots : {}) };
    const next = normalizeRoster({ ...current, ...clean }, current.id);
    if (next.categoryId && Object.values(all.rosters).some((r) => r.id !== current.id && r.categoryId === next.categoryId)) {
        throw new RosterError("category_taken", "Diese Kategorie hat schon ein Roster.");
    }
    if (next.kaderId && kaderTaken(all, next.kaderId, current.id)) throw new RosterError("kader_taken", KADER_TAKEN);
    const changed = Object.keys(clean).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(current[k]));
    if (changed.length) next.history.push(historyEntry({ at: now, by: actor, what: "settings", detail: changed.join(", ") }));
    all.rosters[current.id] = next;
    markMigrated(all, next.categoryId);
    writeAll(all);
    return getRoster(current.id);
}

/**
 * The council-profile migration (#676, councilProfilesStore.migrateLegacy):
 * give a roster its profile without a history line - nobody changed a
 * setting, the profile only took over what the category had.
 * @returns {boolean} whether the roster exists
 */
function assignLootProfile(rosterId, profileId) {
    const all = readAll();
    const roster = all.rosters[str(rosterId)];
    if (!roster) return false;
    roster.lootProfileId = str(profileId);
    writeAll(all);
    return true;
}

/** Delete a roster. @returns {boolean} whether there was one */
function deleteRoster(id) {
    const all = readAll();
    const key = str(id);
    if (!all.rosters[key]) return false;
    delete all.rosters[key];
    writeAll(all);
    return true;
}

/** What changed between two versions of a member, for the history: "status core → bench, chars …". */
function memberChange(before, after) {
    const parts = [];
    if (before.status !== after.status) parts.push(`status ${before.status} → ${after.status}`);
    if (before.chars.join(",") !== after.chars.join(",")) parts.push(`chars ${after.chars.join(", ") || "-"}`);
    if (before.note !== after.note) parts.push("note");
    if ((before.spec || "") !== (after.spec || "")) parts.push(`spec ${after.spec || "-"}`);
    if (before.trialUntil !== after.trialUntil) parts.push(`trialUntil ${after.trialUntil || "-"}`);
    return parts.join("; ");
}

/** The history detail with where a change came from: "via Discord" (#656) before the rest. */
function viaDetail(via, detail) {
    if (via !== "discord") return detail;
    return detail ? `via Discord · ${detail}` : "via Discord";
}

/**
 * Add a member or change one. `patch`: status, chars (keys or names - made keys
 * of the roster's version), charNames, note, trialUntil. A new member starts as
 * "core" since `now`. Throws RosterError "member_limit" past 500 members.
 * `via: "discord"` marks the history line as caused by a Discord role (#656).
 * @returns {object|null} the stored member, null without roster or user id
 */
function upsertMember(rosterId, userId, patch = {}, { actor = "", now = new Date().toISOString(), via = "" } = {}) {
    const all = readAll();
    const roster = all.rosters[str(rosterId)];
    const uid = idOf(userId);
    if (!roster || !uid) return null;
    const before = roster.members[uid] || null;
    if (!before && Object.keys(roster.members).length >= LIMITS.members) {
        throw new RosterError("member_limit", `Ein Roster hat höchstens ${LIMITS.members} Mitglieder.`);
    }
    const p = isMap(patch) ? patch : {};
    const base = before || { status: "core", since: now, by: actor, chars: [], charNames: {}, note: "", spec: "", trialUntil: null };
    const chars = p.chars === undefined ? base.chars : (Array.isArray(p.chars) ? p.chars : []).map((c) => characterKeyOf(c, roster.versionId));
    // the orga's spec belongs to the first character: a new first one starts on "automatisch"
    const firstChanged = (chars[0] || "") !== (base.chars[0] || "");
    const spec = p.spec !== undefined ? p.spec : (firstChanged ? "" : base.spec);
    // a name handed in as a char (not a key) is its own display name; charNames sent along win
    const typed = {};
    if (Array.isArray(p.chars)) p.chars.forEach((c, i) => { if (chars[i] && !str(c).includes(VERSION_KEY_SEP)) typed[chars[i]] = str(c); });
    const charNames = { ...base.charNames, ...typed, ...(isMap(p.charNames) ? p.charNames : {}) };
    const statusChanged = p.status !== undefined && p.status !== base.status;
    const next = normalizeMember({
        ...base,
        ...(p.status !== undefined ? { status: p.status } : {}),
        ...(p.note !== undefined ? { note: p.note } : {}),
        ...(p.trialUntil !== undefined ? { trialUntil: p.trialUntil } : {}),
        ...(statusChanged ? { since: now, by: actor } : {}),
        chars,
        charNames,
        spec,
    }, roster.allowMultipleChars, roster.versionId);
    roster.members[uid] = next;
    const detail = before ? memberChange(before, next) : `${next.status}${next.chars.length ? `, ${next.chars.join(", ")}` : ""}`;
    if (!before || detail) roster.history.push(historyEntry({ at: now, by: actor, userId: uid, what: before ? "member" : "member-added", detail: viaDetail(via, detail) }));
    writeAll(all);
    return getRoster(roster.id).members[uid];
}

/** Remove a member (`via` as in upsertMember). @returns {boolean} whether they were one */
function removeMember(rosterId, userId, { actor = "", now = new Date().toISOString(), via = "" } = {}) {
    const all = readAll();
    const roster = all.rosters[str(rosterId)];
    const uid = idOf(userId);
    if (!roster || !uid || !roster.members[uid]) return false;
    delete roster.members[uid];
    roster.history.push(historyEntry({ at: now, by: actor, userId: uid, what: "member-removed", detail: viaDetail(via, "") }));
    writeAll(all);
    return true;
}

/** Add one line to a roster's history (the newest 500 stay). @returns {boolean} whether the roster exists and the entry was valid */
function appendHistory(rosterId, entry = {}, { now = new Date().toISOString() } = {}) {
    const all = readAll();
    const roster = all.rosters[str(rosterId)];
    const line = roster ? historyEntry({ ...entry, at: entry.at || now }) : null;
    if (!line) return false;
    roster.history.push(line);
    writeAll(all);
    return true;
}

/**
 * The facade's write (raiderCharactersStore.setCategoryAssignments): every
 * member's first character set from `firsts` ({ [userId]: { key, name } }) in
 * one write. A user not yet a member joins as "core"; a member left out of
 * `firsts` loses his characters but stays a member with his status — the
 * assignment says which character, membership is the roster's own business.
 * @returns {boolean} whether the roster exists
 */
function setFirstChars(rosterId, firsts = {}, { actor = "", now = new Date().toISOString() } = {}) {
    const all = readAll();
    const roster = all.rosters[str(rosterId)];
    if (!roster) return false;
    const log = (userId, what, detail) => roster.history.push(historyEntry({ at: now, by: actor, userId, what, detail }));
    for (const [userId, { key, name }] of Object.entries(firsts)) {
        const uid = idOf(userId);
        if (!uid || !key) continue;
        const member = roster.members[uid];
        if (!member) {
            if (Object.keys(roster.members).length >= LIMITS.members) continue;
            roster.members[uid] = { status: "core", since: now, by: actor, chars: [key], charNames: { [key]: name }, note: "", spec: "", trialUntil: null };
            log(uid, "member-added", `core, ${key}`);
            continue;
        }
        const chars = roster.allowMultipleChars ? [key, ...member.chars.filter((c) => c !== key)] : [key];
        if (chars.join(",") !== member.chars.join(",")) log(uid, "member", `chars ${chars.join(", ")}`);
        if (chars[0] !== member.chars[0]) member.spec = "";
        member.chars = chars;
        member.charNames = { ...member.charNames, [key]: name };
    }
    for (const [uid, member] of Object.entries(roster.members)) {
        if (firsts[uid] || !member.chars.length) continue;
        member.chars = [];
        member.charNames = {};
        member.spec = "";
        log(uid, "member", "chars -");
    }
    writeAll(all);
    return true;
}

/**
 * The start-up migration (settingsMigration.js): one roster per entry of
 * `categories` ([{ categoryId, guildId, name, versionId, roleIds, members:
 * { [userId]: { key, name } } }]) whose category has no roster and was never
 * migrated. An existing roster is never touched. Every handled category is
 * remembered, so the next start finds nothing to do.
 * @returns {{ id, categoryId, name, members, roleIds }[]} the rosters created
 */
function migrateCategories(categories = [], { now = new Date().toISOString() } = {}) {
    const all = readAll();
    const done = new Set(all.migratedCategories);
    const created = [];
    let touched = false;
    for (const c of categories) {
        const categoryId = idOf(c && c.categoryId);
        if (!categoryId || done.has(categoryId)) continue;
        done.add(categoryId);
        touched = true;
        if (Object.values(all.rosters).some((r) => r.categoryId === categoryId)) continue;
        const members = {};
        for (const [userId, first] of Object.entries(c.members || {})) {
            members[userId] = { status: "core", since: now, by: "", chars: [first.key], charNames: { [first.key]: first.name }, note: "", trialUntil: null };
        }
        const id = makeId(c.name || categoryId, all.rosters);
        all.rosters[id] = normalizeRoster({
            id,
            guildId: c.guildId,
            name: c.name,
            categoryId,
            versionId: c.versionId,
            roleIds: c.roleIds,
            source: { kind: "migration" },
            members,
            history: [{ at: now, by: "", what: "created", detail: "migration" }],
            createdAt: now,
            createdBy: "",
        }, id);
        const r = all.rosters[id];
        created.push({ id, categoryId, name: r.name, guildId: r.guildId, members: Object.keys(r.members).length, roleIds: r.roleIds.length });
    }
    if (touched) {
        all.migratedCategories = [...done];
        writeAll(all);
    }
    return created;
}

module.exports = {
    listRosters, getRoster, rosterForCategory, rosterForKader, createRoster, updateRoster, deleteRoster,
    upsertMember, removeMember, appendHistory, setFirstChars, migrateCategories, assignLootProfile,
    normalizeRoster, normalizeFile, RosterError, LIMITS, STATUSES, SOURCE_KINDS, ROSTERS_FILE,
    useFile: store.useFile,
};
