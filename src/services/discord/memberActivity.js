// Joins and leaves of the configured Discord servers (event and talk server),
// for the Discord overview of the web admin (docs/discord-servers.md
// "Discord-Übersicht"). The bot calls onMemberAdd / onMemberRemove from its
// guildMemberAdd / guildMemberRemove listeners; the overview reads
// recentActivity(), each entry told whether the person is in a roster or has
// characters — "Ostrava, TBC-Raider, im Roster, gegangen" is what the orga wants
// to see, a bare name is not.
//
// Nothing here calls Discord: a leave's roles come from the member object the
// event hands over (the member cache; a partial member brings none), names and
// relations from the stores.
const guildRoles = require("./guildRoles");
const memberActivityStore = require("../../stores/memberActivityStore");
const rosterStore = require("../../stores/rosterStore");
const raiderCharactersStore = require("../../stores/raiderCharactersStore");
const raiderProfileStore = require("../../stores/raiderProfileStore");
const logger = require("../../logger").child("memberActivity");

const DAY_MS = 24 * 60 * 60 * 1000;

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** The guild id of a member, "" when it has none. */
function guildIdOf(member) {
    return str(member && (member.guild ? member.guild.id : member.guildId));
}

function nameOf(member) {
    const user = member && member.user;
    return str((member && member.displayName) || (user && (user.globalName || user.username)));
}

/** The roles a member holds (the @everyone role left out), from the member cache. */
function rolesOf(member) {
    const cache = member && member.roles && member.roles.cache;
    if (!cache || typeof cache.values !== "function") return [];
    const everyone = guildIdOf(member);
    return [...cache.values()]
        .filter((r) => r && r.id && r.id !== everyone)
        .map((r) => ({ id: str(r.id), name: str(r.name) }));
}

/** Whether the event belongs to a server the bot is set up for, and is a human. */
function relevant(member) {
    if (!member || (member.user && member.user.bot)) return false;
    const gid = guildIdOf(member);
    return !!gid && guildRoles.guildRole(gid) !== "";
}

function recordSafe(entry) {
    try {
        return memberActivityStore.record(entry);
    } catch (e) {
        logger.warn("could not record member activity:", (e && e.message) || e);
        return null;
    }
}

/** guildMemberAdd: note the join. Never throws. */
function onMemberAdd(member) {
    if (!relevant(member)) return null;
    return recordSafe({ guildId: guildIdOf(member), userId: str(member.id), name: nameOf(member), kind: "join" });
}

/** guildMemberRemove: note the leave with the roles the member had. Never throws. */
function onMemberRemove(member) {
    if (!relevant(member)) return null;
    return recordSafe({ guildId: guildIdOf(member), userId: str(member.id), name: nameOf(member), kind: "leave", roles: rolesOf(member) });
}

/**
 * How a Discord account is tied to the raids: the rosters it is in (open ones;
 * `{ id, name, categoryId, status }`) and how many characters it has (profile
 * characters and category assignments, each name once).
 */
function relationOf(userId) {
    const uid = str(userId);
    if (!uid) return { rosters: [], characters: 0 };
    const rosters = rosterStore.listRosters("")
        .filter((r) => !rosterStore.isClosed(r) && r.members && r.members[uid])
        .map((r) => ({ id: r.id, name: r.name, categoryId: r.categoryId || "", status: r.members[uid].status }));
    const names = new Set();
    const profile = raiderProfileStore.hasProfile(uid) ? raiderProfileStore.getProfile(uid) : null;
    for (const c of (profile && profile.characters) || []) names.add(str(c.name).toLowerCase());
    for (const c of raiderCharactersStore.charactersForUser(uid)) names.add(str(c.character).toLowerCase());
    names.delete("");
    return { rosters, characters: names.size };
}

/**
 * Joins and leaves of one server in the last `days` days, newest first, each
 * with `relation` (relationOf). `guildId` "" = nothing (a side without server).
 */
function recentActivity(guildId, { days = 7, now = Date.now() } = {}) {
    const gid = str(guildId);
    if (!gid) return [];
    return memberActivityStore.listEntries({ guildId: gid, since: now - days * DAY_MS })
        .map((e) => ({ ...e, relation: relationOf(e.userId) }));
}

module.exports = { onMemberAdd, onMemberRemove, relationOf, recentActivity };
