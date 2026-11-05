// Who may manage one raid roster (#653, docs/roster-profile.md):
//
//   - a full admin (user.isAdmin) - every roster,
//   - the server-admin rank (user.isServerAdmin) - the rosters of its active server, never
//     one without a server; these two create rosters and set their managers,
//   - an account listed in roster.managers.userIds,
//   - a member holding one of roster.managers.roleIds on the roster's server.
//
// Managing = members, status, characters and Discord roles of that roster.
// Reading rosters needs the area `roster` (read) - that is apiAccess.js' job,
// not this module's.
const discord = require("../discord/discord");
const { userIsOrga } = require("../../config/permissions");

const ids = (list) => (Array.isArray(list) ? list.map((v) => String(v)) : []);

/** The rank holds for the active server only (`user.guildId`) and fails closed on a roster without a server. */
const rankOnRosterServer = (user, roster) => !!(user && user.isServerAdmin === true && roster && roster.guildId && String(roster.guildId) === String(user.guildId));

/** Whether `user` may change what only admins may change on `roster`: a full admin, or the rank on its server. */
const mayAdminRoster = (user, roster) => !!user && (user.isAdmin === true || rankOnRosterServer(user, roster));

/** Whether `user` may create rosters on the active server: a full admin, or the rank (it holds for that server). */
const mayCreateRosters = (user) => !!user && (user.isAdmin === true || user.isServerAdmin === true);

/**
 * Whether `user` may manage `roster`. `memberRoleIds` = the user's roles on the
 * roster's server (null/undefined when unknown - then only admin and the
 * account list count).
 * @param {{ id?: string, isAdmin?: boolean } | null} user
 * @param {{ managers?: { roleIds?: string[], userIds?: string[] } } | null} roster
 * @param {string[] | null} [memberRoleIds]
 */
function canManageRoster(user, roster, memberRoleIds) {
    if (!user) return false;
    if (user.isAdmin === true) return true;
    if (!roster) return false;
    if (rankOnRosterServer(user, roster)) return true;
    const managers = roster.managers || {};
    const uid = String(user.id || "").trim();
    if (uid && ids(managers.userIds).includes(uid)) return true;
    const roles = ids(managers.roleIds);
    return ids(memberRoleIds).some((r) => roles.includes(r));
}

/**
 * The same, with the user's roles fetched from Discord (discord.memberRoleIds
 * on the roster's server). The fetch is skipped when the answer does not need
 * it; an unknown member (bot offline) counts as holding no role.
 * @returns {Promise<boolean>}
 */
async function canManageRosterLive(user, roster, { memberRoleIds = discord.memberRoleIds } = {}) {
    if (canManageRoster(user, roster, null)) return true;
    if (!user || !roster || !ids((roster.managers || {}).roleIds).length || !roster.guildId) return false;
    const roles = await memberRoleIds(roster.guildId, String(user.id || ""));
    return canManageRoster(user, roster, roles);
}

/**
 * Whether `user` is the orga of `roster` (epic #723): a full admin, a role in
 * config.orgaRoleIds (the session's `isOrga`), or a manager of that very roster.
 * The people data of a roster (members, attendance, Discord roles, history) is for
 * them only; a raider with `roster` read sees the Komposition.
 * @returns {Promise<boolean>}
 */
async function isRosterOrga(user, roster, opts) {
    if (userIsOrga(user)) return true;
    return canManageRosterLive(user, roster, opts);
}

module.exports = { canManageRoster, canManageRosterLive, isRosterOrga, mayAdminRoster, mayCreateRosters };
