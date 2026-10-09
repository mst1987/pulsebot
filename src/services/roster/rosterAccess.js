// Who may manage one raid roster (#653, docs/roster-profile.md):
//
//   - a full admin (user.isAdmin) - every roster; only full admins create rosters
//     and sets their managers,
//   - an account listed in roster.managers.userIds,
//   - a member holding one of roster.managers.roleIds on the roster's server.
//
// Managing = members, status, characters and Discord roles of that roster.
// Reading rosters needs the area `roster` (read) - that is apiAccess.js' job,
// not this module's.
const discord = require("../discord/discord");

const ids = (list) => (Array.isArray(list) ? list.map((v) => String(v)) : []);

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

module.exports = { canManageRoster, canManageRosterLive };
