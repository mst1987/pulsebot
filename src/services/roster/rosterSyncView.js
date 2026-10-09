// What the roster page's "Abgleich" tab shows (#656): four lists, each a to-do
// with one button per line, plus whether a roster role is mirrored to the
// other server by the role sync (docs/roster-profile.md "Roster und Discord-Rollen").
//
//   inRosterWithoutRole    members who hold none of roleIds        -> "Rolle geben"
//   roleWithoutRoster      holders of a role who are no member      -> "Aufnehmen" / "Rolle nehmen"
//                          (only when the automatic failed; takeFailed = the tool
//                          removed them and could not take the role)
//   withoutChar            members without a character              -> "Vorschlag übernehmen"
//                          (suggestion = first profile character of the roster's version)
//   logCharsWithoutPerson  characters in the logs of the category's last raid
//                          nights that no member plays and nobody hid -> "Person zuordnen" / "Ausblenden"
//
// Nothing is stored; computed on read. A failed member fetch leaves the two
// role lists empty and says so in `membersError` (never "everyone lacks the role").
const discord = require("../discord/discord");
const { canManageRoles } = require("../discord/roleSync");
const memberRoles = require("../discord/memberRoles");
const raiderProfileStore = require("../../stores/raiderProfileStore");
const rosterHidden = require("../../stores/rosterHiddenStore");
const { buildAttendanceContext } = require("../characters/rosterAttendance");
const { nameKeyOf } = require("../../utils/loot/lootImport");
const { takeFailedPending } = require("./rosterRoleSync");

const MAX_LOG_CHARS = 50;

/** "devi res" -> "Devi Res": a report key back to a readable name. */
const titleCase = (key) => String(key || "").replace(/(^|[\s-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());

/**
 * Which roster roles the role sync (config.roleSync) touches:
 * `[{ roleId, otherRoleId, direction, side, incoming, outgoing }]`. `incoming`:
 * the sync gives this role from the other server - a role taken here comes
 * back as long as the person holds the other one. `outgoing`: it is copied to
 * the other server, where taking it here never removes it (the sync only adds).
 */
function mirroredRoles(roster, config = {}) {
    const ids = new Set([...roster.roleIds, roster.trialRoleId].filter(Boolean));
    const out = [];
    for (const rule of Array.isArray(config.roleSync) ? config.roleSync : []) {
        for (const side of ["event", "talk"]) {
            const roleId = side === "event" ? rule.eventRoleId : rule.talkRoleId;
            if (!ids.has(roleId)) continue;
            const toThisSide = side === "event" ? "toEvent" : "toTalk";
            const fromThisSide = side === "event" ? "toTalk" : "toEvent";
            out.push({
                roleId,
                otherRoleId: side === "event" ? rule.talkRoleId : rule.eventRoleId,
                direction: rule.direction,
                side,
                incoming: rule.direction === toThisSide || rule.direction === "both",
                outgoing: rule.direction === fromThisSide || rule.direction === "both",
            });
        }
    }
    return out;
}

/** The roster's roles with their names and whether they still exist. */
function rolesOf(roster) {
    const known = new Map((discord.listRoles(roster.guildId) || []).map((r) => [r.id, r]));
    const ids = [...new Set([...roster.roleIds, roster.trialRoleId].filter(Boolean))];
    return ids.map((id, i) => ({
        id,
        name: known.has(id) ? known.get(id).name : "",
        color: known.has(id) ? known.get(id).color : "",
        main: i === 0 && roster.roleIds[0] === id,
        trial: id === roster.trialRoleId,
        exists: known.has(id),
    }));
}

/** The member list of the roster's server: `{ list }` or `{ error }`. */
async function membersOf(roster) {
    const guild = roster.guildId && discord.isOnline() ? discord.getGuild(roster.guildId) : null;
    if (!guild) return { error: "offline" };
    try {
        const list = await discord.fetchGuildMembersCached(roster.guildId, guild);
        if (!Array.isArray(list) || !list.length) return { error: "members_unavailable" };
        return { list };
    } catch {
        return { error: "members_unavailable" };
    }
}

/** The display name of a user: Discord, else the profile, else the id. */
function namer(byId) {
    return (userId) => {
        const m = byId.get(userId);
        if (m) return m.displayName || (m.user && (m.user.globalName || m.user.username)) || userId;
        const p = raiderProfileStore.getProfile(userId);
        return (p && p.name) || userId;
    };
}

/** The two role lists. */
function roleLists(roster, list, nameOf) {
    const roleIds = roster.roleIds;
    const holds = (m, roleId) => {
        const recent = memberRoles.recentWrite(roster.guildId, m.id, roleId);
        return recent !== undefined ? recent : !!(m.roles && m.roles.cache && m.roles.cache.has(roleId));
    };
    const humans = list.filter((m) => m && m.id && !(m.user && m.user.bot));
    const holders = new Set(humans.filter((m) => roleIds.some((r) => holds(m, r))).map((m) => String(m.id)));
    const byName = (a, b) => a.displayName.localeCompare(b.displayName);
    const inRosterWithoutRole = roleIds.length
        ? Object.entries(roster.members)
            .filter(([uid]) => !holders.has(uid))
            .map(([uid, m]) => ({ userId: uid, displayName: nameOf(uid), status: m.status }))
            .sort(byName)
        : [];
    const roleWithoutRoster = [...holders]
        .filter((uid) => !roster.members[uid])
        .map((uid) => ({ userId: uid, displayName: nameOf(uid), takeFailed: takeFailedPending(roster, uid) }))
        .sort(byName);
    return { inRosterWithoutRole, roleWithoutRoster };
}

/** Members without a character, with the profile's first character of the roster's version as suggestion. */
function withoutCharList(roster, nameOf) {
    return Object.entries(roster.members)
        .filter(([, m]) => !m.chars.length)
        .map(([uid]) => {
            const first = raiderProfileStore.firstCharacter(raiderProfileStore.getProfile(uid), roster.versionId);
            return {
                userId: uid,
                displayName: nameOf(uid),
                suggestion: first ? { key: first.key, name: first.name, className: first.className || "" } : null,
            };
        })
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Characters of the category's recent logs (the attendance window of
 * rosterAttendance.js, the roster's version) that no member plays and that are
 * not hidden: `[{ character, key, className, nights, lastSeen, claimedBy }]`,
 * most nights first. `claimedBy` = accounts whose profile has that character.
 */
function logCharsList(roster, { ctx } = {}) {
    if (!roster.categoryId) return [];
    const context = ctx || buildAttendanceContext(roster.guildId, { versionId: roster.versionId });
    const played = new Set(Object.values(roster.members).flatMap((m) => m.chars.map(nameKeyOf)));
    const seen = new Map();
    for (const raid of context.raidsByCategory.get(roster.categoryId) || []) {
        const keys = new Map();
        for (const rep of raid.logs || []) {
            for (const key of rep.keys) if (!keys.has(key)) keys.set(key, (rep.classes && rep.classes[key]) || "");
        }
        for (const [key, className] of keys) {
            const name = nameKeyOf(key);
            if (!name || played.has(name)) continue;
            const entry = seen.get(name) || { key: name, character: titleCase(name), className: "", nights: 0, lastSeen: 0 };
            entry.nights += 1;
            entry.lastSeen = Math.max(entry.lastSeen, Number(raid.startTime) || 0);
            if (!entry.className && className) entry.className = className;
            seen.set(name, entry);
        }
    }
    return [...seen.values()]
        .filter((e) => !rosterHidden.isHidden(e.key))
        .sort((a, b) => b.nights - a.nights || b.lastSeen - a.lastSeen || a.key.localeCompare(b.key))
        .slice(0, MAX_LOG_CHARS)
        .map((e) => ({ ...e, claimedBy: raiderProfileStore.claimsFor(e.key, "", roster.versionId) }));
}

/**
 * The whole tab for one roster. Never throws for a Discord problem: the role
 * lists stay empty and `membersError` carries the code ("offline",
 * "members_unavailable").
 */
async function rosterSyncView(roster, { config = {}, ctx } = {}) {
    const members = await membersOf(roster);
    const byId = new Map((members.list || []).map((m) => [String(m.id), m]));
    const nameOf = namer(byId);
    const lists = members.list ? roleLists(roster, members.list, nameOf) : { inRosterWithoutRole: [], roleWithoutRoster: [] };
    return {
        rosterId: roster.id,
        guildId: roster.guildId,
        roles: rolesOf(roster),
        canManageRoles: roster.guildId ? canManageRoles(roster.guildId) : false,
        membersError: members.error || null,
        ...lists,
        withoutChar: withoutCharList(roster, nameOf),
        logCharsWithoutPerson: logCharsList(roster, { ctx }),
        mirrored: mirroredRoles(roster, config),
    };
}

module.exports = { rosterSyncView, mirroredRoles, rolesOf, logCharsList, withoutCharList, titleCase, MAX_LOG_CHARS };
