// "Ansicht als Rolle" — a full admin looks at the menu with the rights of one
// or more Discord roles, like Discord's "View server as role".
//
// The session keeps the admin's own rights untouched and only carries a
// `viewAs = { roleIds, at }` beside them. auth.getUser() then hands every
// reader the rights those roles would have — so the API gate (apiAccess.js),
// every requireAdmin/requireFullAdmin and the client's hidden tabs all show the
// view of that role, with nothing to keep in sync anywhere else.
//
// What a role gets is what a member holding exactly those roles would get:
//   * one of them is an admin role → full admin;
//   * else the base access (config.baseAccess — every logged-in account has
//     it) unioned with the role permissions of those roles.
// Grants for single accounts (config.userPermissions) are left out on purpose:
// they belong to a person, not to the role being looked at.
//
// Safety: only a *real* full admin can start it (auth.getRealUser), stopping
// works whatever the viewed role may do, and a view older than MAX_AGE_MS ends
// by itself — nobody should stay stuck in a raider's view by accident.
//
// Pure: config in, rights out.
const { fullAccess, emptyAccess, mergeAccess, baseAccessMap, accessForRoles } = require("../../config/permissions");
const { isSnowflake } = require("../../utils/ids");

const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_ROLES = 25;

/** The role ids of a request body: strings, unique, at most MAX_ROLES. */
function normalizeRoleIds(raw) {
    const list = Array.isArray(raw) ? raw : [];
    return [...new Set(list.map((id) => String(id || "").trim()).filter((id) => isSnowflake(id)))].slice(0, MAX_ROLES);
}

/**
 * The rights a member with exactly these roles would have.
 * @param {object} config the settings config
 * @param {string[]} roleIds
 * @param {string[]} [envAdminRoleIds] ADMIN_ROLE_IDS from .env
 * @returns {{ isAdmin: boolean, access: object }}
 */
function accessAsRoles(config, roleIds, envAdminRoleIds = []) {
    const cfg = config || {};
    const ids = normalizeRoleIds(roleIds);
    const adminRoleIds = new Set([...(cfg.adminRoleIds || []), ...(envAdminRoleIds || [])].map(String));
    if (ids.some((id) => adminRoleIds.has(id))) return { isAdmin: true, access: fullAccess() };
    const base = baseAccessMap(cfg.baseAccess);
    return { isAdmin: false, access: mergeAccess(base || emptyAccess(), accessForRoles(cfg.rolePermissions || {}, ids)) };
}

/** Whether a stored view is still valid at `now`. */
function viewAsActive(viewAs, now = Date.now()) {
    return !!(viewAs && Array.isArray(viewAs.roleIds) && now - (Number(viewAs.at) || 0) < MAX_AGE_MS);
}

/**
 * The user object every reader sees for a session: the session itself, or —
 * while its real admin looks at the menu as a role — a copy carrying that
 * role's rights and a `viewAs` note. The session is never changed.
 */
function effectiveUser(session, config, envAdminRoleIds = [], now = Date.now()) {
    if (!session || !session.isAdmin || !viewAsActive(session.viewAs, now)) return session;
    const { isAdmin, access } = accessAsRoles(config, session.viewAs.roleIds, envAdminRoleIds);
    return { ...session, isAdmin, access, viewAs: { roleIds: session.viewAs.roleIds.slice(), at: session.viewAs.at } };
}

module.exports = { MAX_AGE_MS, MAX_ROLES, normalizeRoleIds, accessAsRoles, viewAsActive, effectiveUser };
