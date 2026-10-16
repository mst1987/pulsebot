// Whether a role may serve as the addon centre's update role, which every member can
// take themselves with "Updates abonnieren" (addonCenterBot.subscription). A role that
// grants anything must never be handed out that way:
//   - bot rights: a full-admin role (config.adminRoleIds or ADMIN_ROLE_IDS), an orga role
//     (config.orgaRoleIds), a role with area grants (config.rolePermissions), a role a bot
//     command allows (config.botCommandAccess[*].roleIds), a raider role of a category
//     (config.categoryRoles), a role of a roster (roleIds, trialRoleId, managers.roleIds),
//     a role of the role sync between the servers (config.roleSync, both sides: the sync
//     hands out the other one or gives this one back after an unsubscribe);
//   - Discord: a permission beyond those of @everyone, or a channel overwrite that allows
//     the role anything (it unlocks a hidden channel).
// The button is hidden for such a role, a click on an old one is refused, and the
// settings card warns (apiRoutes/addonCenter.js flags the role).
const { normalizeRolePermissions } = require("../../config/permissions");
const { adminRoleIds: envAdminRoleIds } = require("../../config/variables");
const rosterStore = require("../../stores/rosterStore");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const ids = (list) => (Array.isArray(list) ? list.map(str) : []);
const values = (map) => (map && typeof map === "object" && !Array.isArray(map) ? Object.values(map) : []);

/** Why the role carries bot rights of the config or a roster, "" when it carries none. */
function configReason(cfg, id) {
    if ([...ids(cfg.adminRoleIds), ...ids(envAdminRoleIds)].includes(id)) return "the role is a full-admin role";
    if (ids(cfg.orgaRoleIds).includes(id)) return "the role is an orga role";
    if (normalizeRolePermissions(cfg.rolePermissions || {})[id]) return "the role has rights under Einstellungen -> Berechtigungen";
    if (values(cfg.botCommandAccess).some((rule) => rule && ids(rule.roleIds).includes(id))) return "the role may run bot commands (botCommandAccess)";
    if (values(cfg.categoryRoles).some((list) => ids(list).includes(id))) return "the role is a raider role of a category";
    if ((Array.isArray(cfg.roleSync) ? cfg.roleSync : []).some((s) => s && (str(s.talkRoleId) === id || str(s.eventRoleId) === id))) {
        return "the role is part of the role sync between the servers";
    }
    let rosters;
    try {
        rosters = rosterStore.listRosters();
    } catch {
        rosters = [];
    }
    for (const r of rosters) {
        const managers = r.managers && Array.isArray(r.managers.roleIds) ? r.managers.roleIds : [];
        if ([...ids(r.roleIds), str(r.trialRoleId), ...ids(managers)].includes(id)) return `the role belongs to the roster ${r.name || r.id}`;
    }
    return "";
}

const bitsOf = (perms) => {
    const b = perms ? perms.bitfield : undefined;
    return b === undefined || b === null ? null : BigInt(b);
};

/** Why the Discord role grants something, "" when it does not: permissions beyond @everyone, a channel overwrite. */
function discordReason(id, role, guild) {
    const g = guild || (role && role.guild) || null;
    const bits = role ? bitsOf(role.permissions) : null;
    if (bits !== null) {
        const everyone = g && g.roles && g.roles.everyone ? bitsOf(g.roles.everyone.permissions) : null;
        if ((bits & ~(everyone === null ? 0n : everyone)) !== 0n) return "the role carries Discord permissions beyond @everyone";
    }
    const channels = g && g.channels && g.channels.cache;
    if (channels && typeof channels.values === "function") {
        for (const channel of channels.values()) {
            const overwrites = channel && channel.permissionOverwrites && channel.permissionOverwrites.cache;
            const own = overwrites && typeof overwrites.get === "function" ? overwrites.get(id) : null;
            const allow = own ? bitsOf(own.allow) : null;
            if (allow !== null && allow !== 0n) return `the role unlocks the channel #${channel.name || channel.id}`;
        }
    }
    return "";
}

/**
 * Why the role must not be self-service ("" when it may): its bot rights from the
 * config and the rosters, then (when the Discord role or its server is at hand) what
 * it grants in Discord.
 * @param {object} config the bot config (configStore.getConfig())
 * @param {string} roleId
 * @param {object|null} [role] the Discord role, when resolvable
 * @param {object|null} [guild] its server (defaults to role.guild)
 * @returns {string}
 */
function privilegedReason(config, roleId, role = null, guild = null) {
    const id = str(roleId);
    if (!id) return "";
    return configReason(config || {}, id) || discordReason(id, role, guild);
}

module.exports = { privilegedReason };
