// How a Discord account is tied to the raids: the open rosters it is in (with
// its status there) and its characters (name, class, game version). One place
// for the Discord overview (memberActivity.js, joins and leaves) and the member
// list of System › Discord › Mitglieder (serverMembers.js), so both tell the
// same story.
//
// The characters come from three stores, each once per game version and name (a
// TBC and a Forever character of the same name are two characters):
// - the raider profile (raiderProfileStore): name, class and version are known
// - the open rosters (rosterStore): a member's character keys; the class comes
//   from the profile character with that key, else it stays "" (the orga typed
//   a name the raider never saved). Each character lists the ids of the open
//   rosters it stands in (`rosterIds`).
// - the category assignments (raiderCharactersStore.charactersForUser): every
//   category, a roster category read from its rosters (closed ones too); only a
//   name without version, so it is added only when no character of that name
//   is known yet
//
// For one account relationOf() reads the stores directly; for a whole server
// relationIndex() reads them once and answers each account from memory (the
// list page asks for hundreds of members at once).
const rosterStore = require("../../../stores/rosterStore");
const raiderCharactersStore = require("../../../stores/raiderCharactersStore");
const raiderProfileStore = require("../../../stores/raiderProfileStore");
const { nameKeyOf } = require("../../../utils/loot/lootImport");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const lower = (v) => str(v).toLowerCase();

/** The open rosters, read once. */
function openRosters() {
    return rosterStore.listRosters("").filter((r) => !rosterStore.isClosed(r));
}

/** The profile of an account, null without one. */
function profileOf(uid) {
    return raiderProfileStore.hasProfile(uid) ? raiderProfileStore.getProfile(uid) : null;
}

/** The roster's character key as a profile character, null when the profile has none. */
function profileCharFor(profile, key, versionId) {
    if (!profile || typeof raiderProfileStore.findCharacter !== "function") return null;
    return raiderProfileStore.findCharacter(profile, key, versionId);
}

/**
 * The relation of one account from what was read: `rosters` the open rosters,
 * `assigned` the character names of its category assignments.
 * @returns {{ rosters: Array<{id,name,categoryId,versionId,status}>, characters: Array<{name,className,versionId,rosterIds}> }}
 */
function relationFrom(uid, { rosters, assigned, profile }) {
    const mine = rosters
        .filter((r) => r.members && r.members[uid])
        .map((r) => ({ id: r.id, name: r.name, categoryId: r.categoryId || "", versionId: r.versionId || "", status: r.members[uid].status }));
    const characters = [];
    // one character per version and name; a name without version only when the name is new
    const byKey = new Map();
    const names = new Set();
    const add = (name, className, versionId) => {
        const n = str(name);
        const v = str(versionId);
        if (!n || (!v && names.has(lower(n)))) return null;
        const key = `${v}:${lower(n)}`;
        if (!byKey.has(key)) {
            const c = { name: n, className: str(className), versionId: v, rosterIds: [] };
            byKey.set(key, c);
            names.add(lower(n));
            characters.push(c);
        }
        return byKey.get(key);
    };
    for (const c of (profile && profile.characters) || []) add(c.name, c.className, c.versionId);
    for (const r of rosters) {
        const member = r.members && r.members[uid];
        for (const key of (member && member.chars) || []) {
            const own = profileCharFor(profile, key, r.versionId);
            const c = add(own ? own.name : (member.charNames && member.charNames[key]) || nameKeyOf(key), own ? own.className : "", r.versionId);
            if (c && !c.rosterIds.includes(r.id)) c.rosterIds.push(r.id);
        }
    }
    for (const name of assigned) add(name, "", "");
    return { rosters: mine, characters };
}

/**
 * The relation of one account (reads the stores). `rosters`: the open rosters
 * when the caller has read them already (openRosters()).
 */
function relationOf(userId, { rosters = null } = {}) {
    const uid = str(userId);
    if (!uid) return { rosters: [], characters: [] };
    const assigned = raiderCharactersStore.charactersForUser(uid).map((c) => c.character);
    return relationFrom(uid, { rosters: rosters || openRosters(), assigned, profile: profileOf(uid) });
}

/**
 * Every store read once, then `of(userId)` answers from memory — for a whole
 * member list. Same answers as relationOf().
 */
function relationIndex() {
    const rosters = openRosters();
    const assignedBy = new Map();
    for (const map of Object.values(raiderCharactersStore.listAllAssignments())) {
        for (const [uid, name] of Object.entries(map || {})) {
            if (!assignedBy.has(uid)) assignedBy.set(uid, []);
            assignedBy.get(uid).push(name);
        }
    }
    return {
        /** the open rosters the index was built from */
        rosters,
        of(userId) {
            const uid = str(userId);
            if (!uid) return { rosters: [], characters: [] };
            return relationFrom(uid, { rosters, assigned: assignedBy.get(uid) || [], profile: profileOf(uid) });
        },
    };
}

module.exports = { relationOf, relationIndex, openRosters };
