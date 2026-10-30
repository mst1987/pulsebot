// Self-service roles: roles every member can take and drop themselves by a click or a
// reaction — the addon centre's update role ("Updates abonnieren",
// services/addons/addonCenterBot.js) and the roles of the role messages
// (services/discord/roleMessages.js). A role that grants anything must never be
// handed out that way (`privilegedReason`):
//   - bot rights: a full-admin role (config.adminRoleIds or ADMIN_ROLE_IDS), an orga role
//     (orgaRoleIds of any server, #925), the officer role pinged on applications (per server since #924,
//     serverSettings[guildId].officerRoleId: whoever takes it reads every new application), a role with
//     area grants (rolePermissions of any server), a role a bot command allows (botCommandAccess[*].roleIds
//     of any server), a raider role of a category
//     (config.categoryRoles), a role of a roster (roleIds, trialRoleId, managers.roleIds),
//     a role of the role sync between the servers (config.roleSync, both sides: the sync
//     hands out the other one or gives this one back after an unsubscribe);
//   - Discord: a permission beyond those of @everyone, or a channel overwrite that allows
//     the role anything (it unlocks a hidden channel).
// The button is hidden for such a role, a click or reaction on an old one is refused in
// both directions, and the web warns (apiRoutes/system/addonCenter.js and roleMessages.js flag
// the role; a role message refuses to save one).
//
// `changeSelfRole` is the one way to give or take such a role: it reads the role and the
// member, refuses a privileged role and what Discord would refuse (`roleProblem`: no
// Manage Roles, an integration's role, a role at or above the bot's highest), then adds
// or removes. It never throws and never logs; the caller logs its `code` and `detail`.
const { PermissionsBitField } = require("discord.js");
const { normalizeRolePermissions } = require("../../config/permissions");
const { allServersAccess, fullAdminRoleIds } = require("./serverAccess");
const rosterStore = require("../../stores/rosterStore");
const { officerRoleIds } = require("./serverDefaults");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const ids = (list) => (Array.isArray(list) ? list.map(str) : []);
const entries = (map) => (map && typeof map === "object" && !Array.isArray(map) ? Object.entries(map) : []);

function rostersOrEmpty() {
    try {
        return rosterStore.listRosters();
    } catch {
        return [];
    }
}

/**
 * The versions whose PuG version role (#906) this role is: such a role unlocks the PuG
 * categories of its version, so handing it out by a role message would bypass the
 * onboarding. Class roles unlock nothing.
 */
function pugVersionIdsOf(c, id) {
    const versionIds = [];
    for (const entry of Object.values(c.pugRoles && typeof c.pugRoles === "object" ? c.pugRoles : {})) {
        const versions = entry && entry.versions && typeof entry.versions === "object" ? entry.versions : {};
        for (const [versionId, roleId] of Object.entries(versions)) if (str(roleId) === id && !versionIds.includes(versionId)) versionIds.push(versionId);
    }
    return versionIds;
}

/**
 * Every bot right the role carries from the config and the rosters, machine-readable and
 * in the order privilegedReason checks them (the first one is its reason):
 *   { code: "admin" } | { code: "orga" } | { code: "officer" }
 *   { code: "rolePermissions", areas: string[], levels: { [area]: "read"|"write" } }  the areas granted to the role
 *   { code: "botCommand", commands: string[] }       the bot commands the role may run
 *   { code: "categoryRaider", categoryIds: string[] } the categories it is a raider role of
 *   { code: "roleSync", guildIds: string[], pairs: { guildId, roleId, direction }[] }  the partner
 *       servers of its role-sync pairs; `pairs` names the other side of each pair
 *   { code: "pugVersion", versionIds: string[] }      the PuG version role of these versions (#906)
 *   { code: "roster", rosterId, name, kinds: ("member"|"trial"|"manager")[] }  one per roster
 * Empty when the role carries none. The roles page (services/discord/serverRoles.js) shows
 * them as "Bedeutung für den Bot".
 * @param {object} cfg the bot config
 * @param {string} roleId
 * @param {{ rosters?: object[] }} [opts] the rosters to read instead of the stored ones
 *   (services/discord/pugRoleGuard.js checks a roster before it is saved)
 * @returns {object[]}
 */
/**
 * The rights settings a role may carry, over every server (#925): a role id is unique across
 * servers, so the union tells whether the role carries a right anywhere. The old top-level
 * fields (before the migration moved them) count as well - refusing one role too many is the
 * safe side here. Never used to GRANT a right.
 * @returns {{ orgaRoleIds: string[], rolePermissions: object, botCommandAccess: [string, object][] }}
 */
function rightsAnywhere(c) {
    const all = allServersAccess(c);
    const legacy = normalizeRolePermissions(c.rolePermissions || {});
    const rolePermissions = { ...legacy };
    for (const [roleId, grants] of Object.entries(normalizeRolePermissions(all.rolePermissions))) {
        rolePermissions[roleId] = { ...(rolePermissions[roleId] || {}), ...grants };
        for (const area of Object.keys(legacy[roleId] || {})) {
            const a = legacy[roleId][area];
            const b = grants[area];
            if (a && b) rolePermissions[roleId][area] = { read: !!(a.read || b.read), write: !!(a.write || b.write) };
        }
    }
    return {
        orgaRoleIds: [...new Set([...ids(all.orgaRoleIds), ...ids(c.orgaRoleIds)])],
        rolePermissions,
        botCommandAccess: [...entries(all.botCommandAccess), ...entries(c.botCommandAccess)],
    };
}

function roleUses(cfg, roleId, { rosters } = {}) {
    const c = cfg || {};
    const id = str(roleId);
    const out = [];
    if (!id) return out;
    const access = rightsAnywhere(c);
    if (fullAdminRoleIds(c).includes(id)) out.push({ code: "admin" });
    if (access.orgaRoleIds.includes(id)) out.push({ code: "orga" });
    if (officerRoleIds({ config: c }).includes(id)) out.push({ code: "officer" });
    const grants = access.rolePermissions[id];
    if (grants) {
        const areas = Object.keys(grants).sort();
        out.push({ code: "rolePermissions", areas, levels: Object.fromEntries(areas.map((a) => [a, grants[a].write ? "write" : "read"])) });
    }
    const commands = access.botCommandAccess.filter(([, rule]) => rule && ids(rule.roleIds).includes(id)).map(([name]) => name).sort();
    if (commands.length) out.push({ code: "botCommand", commands });
    const categoryIds = entries(c.categoryRoles).filter(([, list]) => ids(list).includes(id)).map(([catId]) => catId);
    if (categoryIds.length) out.push({ code: "categoryRaider", categoryIds });
    // A role-sync pair (#896) names two servers: the role is on one side, the
    // server on the other side is what the roles page names (#897).
    const partners = [];
    const pairs = [];
    for (const s of Array.isArray(c.roleSync) ? c.roleSync : []) {
        if (!s) continue;
        const direction = str(s.direction);
        if (str(s.fromRoleId) === id) { partners.push(str(s.toGuildId)); pairs.push({ guildId: str(s.toGuildId), roleId: str(s.toRoleId), direction }); }
        if (str(s.toRoleId) === id) { partners.push(str(s.fromGuildId)); pairs.push({ guildId: str(s.fromGuildId), roleId: str(s.fromRoleId), direction }); }
    }
    if (pairs.length) out.push({ code: "roleSync", guildIds: [...new Set(partners.filter(Boolean))], pairs });
    const versionIds = pugVersionIdsOf(c, id);
    if (versionIds.length) out.push({ code: "pugVersion", versionIds });
    for (const r of Array.isArray(rosters) ? rosters : rostersOrEmpty()) {
        if (!r) continue;
        const managers = r.managers && Array.isArray(r.managers.roleIds) ? r.managers.roleIds : [];
        const kinds = [];
        if (ids(r.roleIds).includes(id)) kinds.push("member");
        if (str(r.trialRoleId) === id) kinds.push("trial");
        if (ids(managers).includes(id)) kinds.push("manager");
        if (kinds.length) out.push({ code: "roster", rosterId: str(r.id), name: str(r.name), kinds });
    }
    return out;
}

// The log/refusal text of the first use (privilegedReason's wording, unchanged).
const USE_TEXT = {
    admin: () => "the role is a full-admin role",
    orga: () => "the role is an orga role",
    officer: () => "the role is pinged on new applications (officer role)",
    rolePermissions: () => "the role has rights under Einstellungen -> Berechtigungen",
    botCommand: () => "the role may run bot commands (botCommandAccess)",
    categoryRaider: () => "the role is a raider role of a category",
    roleSync: () => "the role is part of the role sync between the servers",
    pugVersion: () => "the role is a PuG version role (Rollen & Onboarding)",
    roster: (u) => `the role belongs to the roster ${u.name || u.rosterId}`,
};

/** Why the role carries bot rights of the config or a roster, "" when it carries none. */
function configReason(cfg, id) {
    const first = roleUses(cfg, id)[0];
    return first ? USE_TEXT[first.code](first) : "";
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

module.exports = { privilegedReason, roleUses, roleProblem, botMember, isUnknownRole, changeSelfRole };
