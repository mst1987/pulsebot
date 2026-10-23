// How a Discord account is tied to the raids: the open rosters it is in (with
// its status there) and its characters (name, class, game version). One place
// for the Discord overview (memberActivity.js, joins and leaves) and the member
// list of System › Discord › Mitglieder (serverMembers.js), so both tell the
// same story.
//
// The characters come from three stores, each name once:
// - the raider profile (raiderProfileStore): name, class and version are known
// - the rosters (rosterStore): a member's character keys; the class comes from
//   the profile character with that key, else it stays "" (the orga typed a
//   name the raider never saved)
// - the category assignments of categories without roster (raiderCharactersStore):
//   only a name
//
// For one account relationOf() reads the stores directly; for a whole server
// relationIndex() reads them once and answers each account from memory (the
// list page asks for hundreds of members at once).
const rosterStore = require("../../stores/rosterStore");
const raiderCharactersStore = require("../../stores/raiderCharactersStore");
const raiderProfileStore = require("../../stores/raiderProfileStore");
const { nameKeyOf } = require("../../utils/loot/lootImport");

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
 * @returns {{ rosters: Array<{id,name,categoryId,versionId,status}>, characters: Array<{name,className,versionId}> }}
 */
function relationFrom(uid, { rosters, assigned, profile }) {
    const mine = rosters
        .filter((r) => r.members && r.members[uid])
        .map((r) => ({ id: r.id, name: r.name, categoryId: r.categoryId || "", versionId: r.versionId || "", status: r.members[uid].status }));
    const characters = [];
    const seen = new Set();
    const add = (name, className, versionId) => {
        const n = str(name);
        if (!n || seen.has(lower(n))) return;
        seen.add(lower(n));
        characters.push({ name: n, className: str(className), versionId: str(versionId) });
    };
    for (const c of (profile && profile.characters) || []) add(c.name, c.className, c.versionId);
    for (const r of rosters) {
        const member = r.members && r.members[uid];
        for (const key of (member && member.chars) || []) {
            const own = profileCharFor(profile, key, r.versionId);
            add(own ? own.name : (member.charNames && member.charNames[key]) || nameKeyOf(key), own ? own.className : "", r.versionId);
        }
    }
    for (const name of assigned) add(name, "", "");
    return { rosters: mine, characters };
}

/** The relation of one account (reads the stores). */
function relationOf(userId) {
    const uid = str(userId);
    if (!uid) return { rosters: [], characters: [] };
    const assigned = raiderCharactersStore.charactersForUser(uid).map((c) => c.character);
    return relationFrom(uid, { rosters: openRosters(), assigned, profile: profileOf(uid) });
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

module.exports = { relationOf, relationIndex };
