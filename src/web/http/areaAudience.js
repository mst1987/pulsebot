// Who may open each menu area — what the client marks as "Orga-Bereich" (design
// canvas Oct 2026, E + B). Which roles are orga is set in Einstellungen →
// Berechtigungen (config.orgaRoleIds); every other role is a raider role
// ("Mo Raider", "Mi Raider"), whatever areas the guild hands it.
//
//   an area the base access or ANY raider role opens          -> a raider page, no mark
//   an area only admins, orga roles and single accounts open   -> "Orga-Bereich",
//     naming the orga roles that open it (admins see everything, never listed)
//
// Read from the permission settings only; role names come from the bot's role
// cache, a role it does not know keeps its id.
const { AREA_IDS, can } = require("../../config/permissions");

/**
 * @param {object} config        getConfig() (admin role ids merged in by the caller)
 * @param {{ id: string, name: string }[]} roles  the permission server's roles (names)
 * @returns {Object<string, { everyone: boolean, roles: string[], writers: string[], raiders: string[], accounts: number }>}
 *   `everyone`: the base access or a raider role opens it; `roles`/`writers`: the orga roles that
 *   may open it / change in it; `raiders`: the raider roles that open it; `accounts`: single accounts
 */
function areaAudience(config, roles = []) {
    const cfg = config || {};
    const names = new Map((roles || []).map((r) => [String(r.id), String(r.name || r.id)]));
    const admins = new Set((cfg.adminRoleIds || []).map(String));
    const orga = new Set((cfg.orgaRoleIds || []).map(String));
    const out = {};
    for (const area of AREA_IDS) {
        const holders = (level, wantOrga) => Object.entries(cfg.rolePermissions || {})
            .filter(([roleId, access]) => !admins.has(String(roleId)) && orga.has(String(roleId)) === wantOrga && can(access, area, level))
            .map(([roleId]) => names.get(String(roleId)) || String(roleId))
            .sort((a, b) => a.localeCompare(b));
        const raiders = holders("read", false);
        const accounts = Object.values(cfg.userPermissions || {}).filter((access) => can(access, area, "read")).length;
        out[area] = {
            everyone: can(cfg.baseAccess || {}, area, "read") || raiders.length > 0,
            roles: holders("read", true),
            writers: holders("write", true),
            raiders,
            accounts,
        };
    }
    return out;
}

/** The names of the orga roles (admin roles left out — admins are named as such), sorted. */
function orgaRoleNames(config, roles = []) {
    const cfg = config || {};
    const names = new Map((roles || []).map((r) => [String(r.id), String(r.name || r.id)]));
    const admins = new Set((cfg.adminRoleIds || []).map(String));
    return [...new Set((cfg.orgaRoleIds || []).map(String))]
        .filter((id) => !admins.has(id))
        .map((id) => names.get(id) || id)
        .sort((a, b) => a.localeCompare(b));
}

module.exports = { areaAudience, orgaRoleNames };
