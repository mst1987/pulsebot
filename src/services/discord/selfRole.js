// Self-service roles: roles every member can take and drop themselves by a click or a
// reaction — the addon centre's update role ("Updates abonnieren",
// services/addons/addonCenterBot.js) and the roles of the role messages
// (services/discord/roleMessages.js). A role that grants anything must never be
// handed out that way (`privilegedReason`):
//   - bot rights: a full-admin role (config.adminRoleIds or ADMIN_ROLE_IDS), an orga role
//     (config.orgaRoleIds), a role with area grants (config.rolePermissions), a role a bot
//     command allows (config.botCommandAccess[*].roleIds), a raider role of a category
//     (config.categoryRoles), a role of a roster (roleIds, trialRoleId, managers.roleIds),
//     a role of the role sync between the servers (config.roleSync, both sides: the sync
//     hands out the other one or gives this one back after an unsubscribe);
//   - Discord: a permission beyond those of @everyone, or a channel overwrite that allows
//     the role anything (it unlocks a hidden channel).
// The button is hidden for such a role, a click or reaction on an old one is refused in
// both directions, and the web warns (apiRoutes/addonCenter.js and roleMessages.js flag
// the role; a role message refuses to save one).
//
// `changeSelfRole` is the one way to give or take such a role: it reads the role and the
// member, refuses a privileged role and what Discord would refuse (`roleProblem`: no
// Manage Roles, an integration's role, a role at or above the bot's highest), then adds
// or removes. It never throws and never logs; the caller logs its `code` and `detail`.
const { PermissionsBitField } = require("discord.js");
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

/** Discord's "Unknown Role": the role was deleted. */
const isUnknownRole = (e) => !!(e && (e.code === 10011 || /unknown role/i.test(str(e && e.message))));

const errText = (e) => str(e && e.message) || str(e);

/** The bot as a member of the guild; fetched when it is not cached. */
async function botMember(guild) {
    const members = guild && guild.members;
    if (!members) return null;
    if (members.me) return members.me;
    if (typeof members.fetchMe !== "function") return null;
    try {
        return await members.fetchMe();
    } catch {
        return null;
    }
}

/**
 * Why the role must not be given or taken by a member themselves, "" when it may: a role
 * with rights (`privilegedReason` — refused in both directions), then what Discord's
 * `role.editable` checks, each with its own reason for the log: the bot's Manage Roles,
 * a managed role, the role's place below the bot's highest role.
 */
async function roleProblem(guild, role, config = {}) {
    const privileged = privilegedReason(config, role.id, role, guild);
    if (privileged) return privileged;
    const me = await botMember(guild);
    if (!me || !me.permissions || !me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return "missing Manage Roles";
    if (role.managed) return "the role belongs to an integration";
    const top = me.roles && me.roles.highest ? Number(me.roles.highest.position) : 0;
    const editable = typeof role.editable === "boolean" ? role.editable : Number(role.position) < top;
    if (!editable) return "the role is above the bot's highest role";
    return "";
}

/**
 * Give, take or toggle a self-service role of one member.
 *
 * @param {object} opts
 * @param {object} opts.guild the Discord guild
 * @param {string} opts.roleId
 * @param {object|null} [opts.member] the member when at hand (an interaction's); fetched by `userId` otherwise
 * @param {string} [opts.userId]
 * @param {"toggle"|"add"|"remove"} [opts.mode]
 * @param {object} [opts.config] the bot config, for `privilegedReason`
 * @param {{ add?: string, remove?: string }} [opts.reasons] the audit-log reasons
 * @returns {Promise<{ ok: true, role, on: boolean, changed: boolean }
 *   | { ok: false, code: "role_unreadable"|"role_missing"|"member_missing"|"refused"|"discord_error", detail: string, role?, on? }>}
 *   `on`: whether the member holds the role afterwards (or would have).
 */
async function changeSelfRole({ guild, roleId, member = null, userId = "", mode = "toggle", config = {}, reasons = {} } = {}) {
    const id = str(roleId);
    let role = null;
    try {
        role = (guild.roles.cache && guild.roles.cache.get(id)) || await guild.roles.fetch(id);
    } catch (e) {
        if (!isUnknownRole(e)) return { ok: false, code: "role_unreadable", detail: errText(e) };
    }
    if (!role) return { ok: false, code: "role_missing", detail: "" };
    let who = member && member.roles && member.roles.cache ? member : null;
    if (!who) {
        try {
            who = await guild.members.fetch(str(userId));
        } catch (e) {
            return { ok: false, code: "member_missing", role, detail: errText(e) };
        }
        if (!who || !who.roles || !who.roles.cache) return { ok: false, code: "member_missing", role, detail: "no member" };
    }
    const problem = await roleProblem(guild, role, config);
    if (problem) return { ok: false, code: "refused", role, detail: problem };
    const has = who.roles.cache.has(id);
    const on = mode === "add" || (mode === "toggle" && !has);
    try {
        if (on && !has) await who.roles.add(id, reasons.add);
        else if (!on && has) await who.roles.remove(id, reasons.remove);
    } catch (e) {
        return { ok: false, code: "discord_error", role, on, detail: errText(e) };
    }
    return { ok: true, role, on, changed: on !== has };
}

module.exports = { privilegedReason, roleProblem, botMember, isUnknownRole, changeSelfRole };
