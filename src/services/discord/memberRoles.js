// Give and take one Discord role of one member (#656, docs/roster-profile.md
// "Roster und Discord-Rollen"). The one place that removes a role on purpose:
// roleSync.js only ever adds and keeps its own guard for that.
//
// Defence in depth: only a role some roster of that server names (roleIds or
// trialRoleId) is ever touched - whatever a caller hands in, an admin role or
// any other role of the server is refused with "not_roster_role".
//
// Never throws. Every call answers
//   { ok, code, changed, guildId, userId, roleId, roleName, error? }
// with `code` one of
//   "done"            ok, the role was given / taken (changed: true)
//   "unchanged"       ok, the member already had / lacked it (changed: false)
//   "bad_request"     a guild, user or role id is missing
//   "not_roster_role" no roster of that server lists the role
//   "offline"         the bot is not connected or not on that server
//   "no_permission"   the bot lacks "Rollen verwalten" there
//   "unknown_role"    the role does not exist (any more)
//   "role_too_high"   the role is managed or not below the bot's highest role
//   "not_member"      the user is not on that server
//   "failed"          Discord refused for another reason (error carries it)
// The web translates the code (DE/EN), so no sentence is built here.
//
// Every successful write is remembered for WRITE_MEMORY_MS (recentWrite): the
// member list is cached for a minute (discord.fetchGuildMembersCached) and a
// role write only reaches the cached member with the gateway event, so the
// periodic roster reconcile asks here first instead of trusting a stale cache.
const discord = require("./discord");
const { canManageRoles } = require("./roleSync");
const rosterStore = require("../../stores/rosterStore");

const REASON = "EventHelper Roster";
// Longer than the member cache's 60 s, so a reconcile never reads a list older than the write.
const WRITE_MEMORY_MS = 3 * 60 * 1000;

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

// `${guildId}:${userId}:${roleId}` -> { has, at }
const writes = new Map();

/** Every role id some roster of that server names: roleIds and trialRoleId. */
function rosterRoleIds(guildId) {
    const gid = str(guildId);
    const out = new Set();
    if (!gid) return out;
    for (const roster of rosterStore.listRosters(gid)) {
        for (const id of roster.roleIds) out.add(String(id));
        if (roster.trialRoleId) out.add(String(roster.trialRoleId));
    }
    return out;
}

/** Whether the bot can move `role`: not a managed role and below the bot's highest role. */
function roleBelowBot(guild, role) {
    if (role.managed) return false;
    if (role.editable === false) return false;
    const me = guild.members && guild.members.me;
    const highest = me && me.roles ? me.roles.highest : null;
    if (highest && typeof highest.comparePositionTo === "function") return highest.comparePositionTo(role) > 0;
    if (highest && typeof highest.position === "number" && typeof role.position === "number") return highest.position > role.position;
    return true;
}

/** The member object, from the cache or a single fetch (no privileged intent); null when not on the server. */
async function memberOf(guild, userId) {
    const cached = guild.members && guild.members.cache ? guild.members.cache.get(userId) : null;
    if (cached) return cached;
    try {
        return (await guild.members.fetch(userId)) || null;
    } catch {
        return null;
    }
}

/** A Discord API error as one of the codes above. */
function codeOfError(e) {
    const code = e && (e.code || (e.rawError && e.rawError.code));
    if (code === 50013 || code === 50001) return "no_permission";
    if (code === 10011) return "unknown_role";
    if (code === 10007 || code === 10013) return "not_member";
    return "failed";
}

function noteWrite(guildId, userId, roleId, has, now = Date.now()) {
    writes.set(`${guildId}:${userId}:${roleId}`, { has, at: now });
    if (writes.size > 2000) {
        for (const [key, w] of writes) if (now - w.at > WRITE_MEMORY_MS) writes.delete(key);
    }
}

/**
 * What the tool itself last did with this role of this member, within the last
 * few minutes: true (given), false (taken), undefined (nothing recent).
 */
function recentWrite(guildId, userId, roleId, now = Date.now()) {
    const w = writes.get(`${str(guildId)}:${str(userId)}:${str(roleId)}`);
    if (!w) return undefined;
    if (now - w.at > WRITE_MEMORY_MS) return undefined;
    return w.has;
}

async function changeRole(guildId, userId, roleId, give) {
    const gid = str(guildId);
    const uid = str(userId);
    const rid = str(roleId);
    const base = { guildId: gid, userId: uid, roleId: rid, roleName: "", changed: false };
    const refuse = (code, extra = {}) => ({ ...base, ok: false, code, ...extra });
    try {
        if (!gid || !uid || !rid) return refuse("bad_request");
        if (!rosterRoleIds(gid).has(rid)) return refuse("not_roster_role");
        const guild = discord.isOnline() ? discord.getGuild(gid) : null;
        if (!guild) return refuse("offline");
        if (!canManageRoles(gid)) return refuse("no_permission");
        const role = guild.roles && guild.roles.cache ? guild.roles.cache.get(rid) : null;
        if (!role) return refuse("unknown_role");
        base.roleName = String(role.name || "");
        if (!roleBelowBot(guild, role)) return refuse("role_too_high");
        const member = await memberOf(guild, uid);
        if (!member || !member.roles) return refuse("not_member");
        const has = !!(member.roles.cache && member.roles.cache.has(rid));
        if (has === give) return { ...base, ok: true, code: "unchanged" };
        if (give) await member.roles.add(rid, REASON);
        else await member.roles.remove(rid, REASON);
        noteWrite(gid, uid, rid, give);
        return { ...base, ok: true, code: "done", changed: true };
    } catch (e) {
        return refuse(codeOfError(e), { error: (e && e.message) || String(e) });
    }
}

/** Give a roster role to a member. Never throws; see the head comment for the answer. */
function giveRole(guildId, userId, roleId) {
    return changeRole(guildId, userId, roleId, true);
}

/** Take a roster role from a member. Never throws; see the head comment for the answer. */
function takeRole(guildId, userId, roleId) {
    return changeRole(guildId, userId, roleId, false);
}

/** Test-only: forget the remembered writes. */
function _resetForTests() {
    writes.clear();
}

module.exports = { giveRole, takeRole, rosterRoleIds, recentWrite, roleBelowBot, codeOfError, WRITE_MEMORY_MS, REASON, _resetForTests };
