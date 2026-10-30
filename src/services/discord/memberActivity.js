// Joins and leaves of the configured Discord servers,
// for the Discord overview of the web admin (docs/discord-servers.md
// "Discord-Übersicht"). The bot calls onMemberAdd / onMemberRemove from its
// guildMemberAdd / guildMemberRemove listeners; the overview reads
// recentActivity(), each entry told whether the person is in a roster or has
// characters — "Ostrava, TBC-Raider, im Roster, gegangen" is what the orga wants
// to see, a bare name is not.
//
// Nothing here calls Discord: a leave's roles come from the member object the
// event hands over (the member cache), names and relations from the stores.
// The client has no Partials.GuildMember (src/bot.js), so discord.js only emits
// guildMemberRemove for a member it has cached: a leave of a member that was
// not cached is not noted (a known gap, accepted; the overview is a hint, not
// a register).
const guildRoles = require("./guildRoles");
const memberActivityStore = require("../../stores/memberActivityStore");
const memberRelation = require("./memberRelation");
const signalRecorder = require("../vermerke/signalRecorder");
const eventStore = require("../../stores/eventStore");
const signupStore = require("../../stores/signupStore");
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

/** guildMemberAdd: note the join. Never throws (it runs before the role syncs in bot.js). */
function onMemberAdd(member) {
    try {
        if (!relevant(member)) return null;
        return recordSafe({ guildId: guildIdOf(member), userId: str(member.id), name: nameOf(member), kind: "join" });
    } catch (e) {
        logger.warn("could not note a join:", (e && e.message) || e);
        return null;
    }
}

/**
 * Whether `userId` is tied to the raids of `guildId` - the server he left, not any other: an open
 * roster of that server, or a signup at one of its raids (Raid-Helper raids are not in the event
 * store and do not count). Reads the stores once per leave; leaves are rare.
 */
function tiedToServer(guildId, userId) {
    if (!guildId || !userId) return false;
    if (memberRelation.openRosters().some((r) => r.guildId === guildId && r.members && r.members[userId])) return true;
    const signedUp = Object.keys(signupStore.signupsOfUser(userId));
    if (!signedUp.length) return false;
    const own = new Set(eventStore.listEvents(guildId, { siblings: true }).map((e) => e.id));
    return signedUp.some((id) => own.has(id));
}

/**
 * A person tied to the raids of the server he left (tiedToServer) left it: a hint for the orga's
 * Vermerke (#982, signalRecorder.js). Best-effort, never throws.
 */
function noteLeaveSignal(member) {
    try {
        const userId = str(member.id);
        const guildId = guildIdOf(member);
        if (!tiedToServer(guildId, userId)) return null;
        return signalRecorder.recordLeave(guildId, userId, { name: nameOf(member) });
    } catch (e) {
        logger.warn("could not note a leave hint:", (e && e.message) || e);
        return null;
    }
}

/** guildMemberRemove: note the leave with the roles the member had. Never throws. */
function onMemberRemove(member) {
    try {
        if (!relevant(member)) return null;
        const entry = recordSafe({ guildId: guildIdOf(member), userId: str(member.id), name: nameOf(member), kind: "leave", roles: rolesOf(member) });
        noteLeaveSignal(member);
        return entry;
    } catch (e) {
        logger.warn("could not note a leave:", (e && e.message) || e);
        return null;
    }
}

/**
 * How a Discord account is tied to the raids, in the overview's short form: the
 * open rosters it is in (`{ id, name, categoryId, status }`) and how many
 * characters it has (memberRelation.js, each name once).
 */
function relationOf(userId) {
    const full = memberRelation.relationOf(userId);
    return {
        rosters: full.rosters.map(({ id, name, categoryId, status }) => ({ id, name, categoryId, status })),
        characters: full.characters.length,
    };
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
