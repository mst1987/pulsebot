// Whether a role may serve as the addon centre's update role, which every member can
// take themselves with "Updates abonnieren" (addonCenterBot.subscription). A role that
// carries rights must never be handed out that way:
//   - bot rights: a full-admin role (config.adminRoleIds or ADMIN_ROLE_IDS), an orga role
//     (config.orgaRoleIds), a role with area grants (config.rolePermissions) — holding it
//     opens the web admin, the orga views or the downloads (userAccess.computeAccess);
//   - Discord permissions: any bit in the role's own permissions.
// The button is hidden for such a role, a click on an old one is refused, and the
// settings card warns (apiRoutes/addonCenter.js flags the role).
const { normalizeRolePermissions } = require("../../config/permissions");
const { adminRoleIds: envAdminRoleIds } = require("../../config/variables");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/**
 * Why the role must not be self-service ("" when it may): its bot rights from the
 * config, then (when the Discord role is at hand) its Discord permissions.
 * @param {object} config the bot config (configStore.getConfig())
 * @param {string} roleId
 * @param {{ permissions?: { bitfield?: bigint } }|null} [role] the Discord role, when resolvable
 * @returns {string}
 */
function privilegedReason(config, roleId, role = null) {
    const id = str(roleId);
    if (!id) return "";
    const cfg = config || {};
    const admins = [...(cfg.adminRoleIds || []), ...(envAdminRoleIds || [])].map(str);
    if (admins.includes(id)) return "the role is a full-admin role";
    if ((cfg.orgaRoleIds || []).map(str).includes(id)) return "the role is an orga role";
    if (normalizeRolePermissions(cfg.rolePermissions || {})[id]) return "the role has rights under Einstellungen -> Berechtigungen";
    const bits = role && role.permissions ? role.permissions.bitfield : undefined;
    if (bits !== undefined && bits !== null && BigInt(bits) !== 0n) return "the role carries Discord permissions";
    return "";
}

module.exports = { privilegedReason };
