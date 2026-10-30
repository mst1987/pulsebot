// The rights of roles and accounts per Discord server (#925, epic #926).
//
// Who may do what in the EventHelper is decided per server: the role grants,
// the base access, the grants for single accounts, the orga roles and the bot
// command rules live in config.serverSettings[guildId]. Only the full-admin
// roles (config.adminRoleIds, ADMIN_ROLE_IDS) and the full-admin accounts of
// .env (ADMIN_USER_ID, LOGCHECK_ADMIN_IDS) count on every server.
//
//   accessSettings(guildId, config)   the five settings of one server, normalised
//   configForGuild(config, guildId)   the config with them over its top level, for
//                                     helpers written against config.rolePermissions …
//   allServersAccess(config)          the union over every server (which roles are
//                                     in use anywhere; never a right of its own)
//   fullAdminRoleIds(config)          the global full-admin roles, settings + .env
//   accessGuildIds(config)            the servers that may hold such settings
//   interactionGuildId(interaction, { recordGuildId })   the server whose rights a bot
//                                     interaction is judged by: where it happened, a DM the
//                                     server of the record it is about, else none (fail closed)
//
// A server without settings grants nothing: there is no global fallback, so a
// right given on one server never opens anything on another.
const { adminRoleIds: envAdminRoleIds } = require("../../../config/variables");
const { normalizeRolePermissions, normalizeUserPermissions, normalizeAreaAccess, mergeAccess } = require("../../../config/permissions");
const { normalizeBotCommandAccess } = require("../../../config/botCommands");
const { serverSettingGuildIds } = require("../../../stores/configSchema");
const { serverSetting } = require("./serverSettings");

/** The settings keys that are kept per server (#925). */
const ACCESS_KEYS = Object.freeze(["rolePermissions", "baseAccess", "userPermissions", "orgaRoleIds", "botCommandAccess"]);

/** A clean, deduplicated list of role ids. */
function normalizeRoleIdList(raw) {
    return Array.isArray(raw) ? [...new Set(raw.map((id) => String(id).trim()).filter(Boolean))] : [];
}

const cfgOf = (config) => config || require("../../../stores/settingsStore").getConfig();

/**
 * The rights settings of one server, normalised. An empty or unknown guild id
 * gets nothing (fail closed).
 * @returns {{ rolePermissions, baseAccess, userPermissions, orgaRoleIds: string[], botCommandAccess }}
 */
function accessSettings(guildId, config) {
    const cfg = cfgOf(config);
    const gid = String(guildId || "").trim();
    const read = (key) => (gid ? serverSetting(gid, key, { config: cfg }) : undefined);
    return {
        rolePermissions: normalizeRolePermissions(read("rolePermissions")),
        baseAccess: normalizeAreaAccess(read("baseAccess")),
        userPermissions: normalizeUserPermissions(read("userPermissions")),
        orgaRoleIds: normalizeRoleIdList(read("orgaRoleIds")),
        botCommandAccess: normalizeBotCommandAccess(read("botCommandAccess")),
    };
}

/** `config` with the rights of `guildId` over its top-level fields (a copy). */
function configForGuild(config, guildId) {
    const cfg = cfgOf(config);
    return { ...cfg, ...accessSettings(guildId, cfg) };
}

/** The servers that may hold rights settings: every server, link target and the home guild. */
function accessGuildIds(config) {
    const cfg = cfgOf(config);
    return [...serverSettingGuildIds(cfg.discordServers, cfg.guildId)];
}

/**
 * The union over every server, for questions like "is this role used for
 * rights anywhere" (selfRole.roleUses). Never use it to grant a right: the
 * bot command rules are merged to their role lists only.
 */
function allServersAccess(config) {
    const cfg = cfgOf(config);
    const out = { rolePermissions: {}, baseAccess: {}, userPermissions: {}, orgaRoleIds: [], botCommandAccess: {} };
    // every server of the list plus every stored entry: a server dropped from the list
    // may still hold settings, and for "is this role used anywhere" more is the safe side
    const stored = cfg.serverSettings && typeof cfg.serverSettings === "object" ? Object.keys(cfg.serverSettings) : [];
    for (const gid of new Set([...accessGuildIds(cfg), ...stored])) {
        const one = accessSettings(gid, cfg);
        for (const [roleId, grants] of Object.entries(one.rolePermissions)) {
            out.rolePermissions[roleId] = normalizeAreaAccess(mergeAccess(out.rolePermissions[roleId] || {}, grants));
        }
        for (const [userId, grants] of Object.entries(one.userPermissions)) {
            out.userPermissions[userId] = normalizeAreaAccess(mergeAccess(out.userPermissions[userId] || {}, grants));
        }
        out.baseAccess = normalizeAreaAccess(mergeAccess(out.baseAccess, one.baseAccess));
        out.orgaRoleIds = [...new Set([...out.orgaRoleIds, ...one.orgaRoleIds])];
        for (const [name, rule] of Object.entries(one.botCommandAccess)) {
            const prev = out.botCommandAccess[name];
            const roleIds = [...new Set([...((prev && prev.roleIds) || []), ...((rule && rule.roleIds) || [])])];
            out.botCommandAccess[name] = { ...(prev || rule), roleIds };
        }
    }
    return out;
}

/** The full-admin roles, valid on every server: the settings' list plus ADMIN_ROLE_IDS of .env. */
function fullAdminRoleIds(config) {
    const cfg = cfgOf(config);
    return normalizeRoleIdList([...(cfg.adminRoleIds || []), ...(envAdminRoleIds || [])]);
}

/**
 * The server whose rights a bot interaction is judged by: the server it happened
 * on; a DM (no server) the home server, the first of the list - as before #925.
 */
function interactionGuildId(interaction, { recordGuildId = "" } = {}) {
    const clicked = interaction && (interaction.guildId || (interaction.guild && interaction.guild.id));
    if (clicked) return String(clicked).trim();
    // a DM (#925): the rights of the record's server - without one, no server at all, so only a
    // full admin passes an orga rule (never the first server of the list as before)
    return String(recordGuildId || "").trim();
}

module.exports = {
    ACCESS_KEYS, accessSettings, configForGuild, accessGuildIds, allServersAccess, fullAdminRoleIds, normalizeRoleIdList,
    interactionGuildId,
};
