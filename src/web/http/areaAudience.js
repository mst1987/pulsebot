// Who may open each menu area — what the client marks as "Orga-Bereich" (design
// canvas Oct 2026, E + B): an area the base access opens is for everyone; any
// other area belongs to the orga, and the mark names who sees it after all
// (the roles whose rights open it, and how many single accounts). So a raider
// role that may read too much shows up right in the bar of the page.
//
// Read from the permission settings only (config.baseAccess, rolePermissions,
// userPermissions, adminRoleIds) — admins see every area and are not listed.
// Role names come from the bot's role cache; a role it does not know keeps its id.
const { AREA_IDS, can } = require("../../config/permissions");

/**
 * @param {object} config        getConfig()
 * @param {{ id: string, name: string }[]} roles  the permission server's roles (names)
 * @returns {Object<string, { everyone: boolean, roles: string[], writers: string[], accounts: number }>}
 *   `roles` may open the area, `writers` may change in it (a part the orga sees by its write right names those)
 */
function areaAudience(config, roles = []) {
    const cfg = config || {};
    const names = new Map((roles || []).map((r) => [String(r.id), String(r.name || r.id)]));
    const admins = new Set((cfg.adminRoleIds || []).map(String));
    const out = {};
    for (const area of AREA_IDS) {
        const everyone = can(cfg.baseAccess || {}, area, "read");
        const holders = (level) => Object.entries(cfg.rolePermissions || {})
            .filter(([roleId, access]) => !admins.has(String(roleId)) && can(access, area, level))
            .map(([roleId]) => names.get(String(roleId)) || String(roleId))
            .sort((a, b) => a.localeCompare(b));
        const accounts = Object.values(cfg.userPermissions || {}).filter((access) => can(access, area, "read")).length;
        out[area] = { everyone, roles: holders("read"), writers: holders("write"), accounts };
    }
    return out;
}

module.exports = { areaAudience };
