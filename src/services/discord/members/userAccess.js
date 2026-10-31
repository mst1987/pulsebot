// What a Discord account may do in the EventHelper: `{ isAdmin, access }`, the
// per-area read/write map of config/permissions.js. The web login (web/http/
// auth.js) stores it in the session; the bot asks the same for an orga button
// (commands/signup/guildBank.js: "Erledigt" needs write access to `raids`), so
// a member has the same rights in Discord as in the menu. It lives here and not
// in web/ because commands/ and utils/ never require from web/
// (test/docs/layering.test.js).
//
// Since #925 rights are per Discord server: the roles a member holds on server B
// open nothing on server A. Only the full admins (.env ADMIN_USER_ID /
// LOGCHECK_ADMIN_IDS, the admin roles of config.adminRoleIds + ADMIN_ROLE_IDS)
// count on every server.
//
//   computeGuildAccess(userId)   `{ isAdmin, guilds: { [guildId]: { access, isOrga? } } }`
//                                for every server; throws when not one could be reached
//   resolveGuildAccess(userId)   the same, the base access of each server when it fails
//   computeAccess(userId, { guildId })   the rights on that one server (fail closed
//                                without a guild id: only a full admin gets anything)
//   resolveAccess(userId, { guildId })   the same, the base access when the lookup fails
//   userMayAny(userId, areas, level, { guildId })   resolveAccess + permissions.userCanAny
const { logcheckAdminIds } = require("../../../config/variables");
const { getConfig } = require("../../../stores/settings/settingsStore");
const guildRoles = require("../roles/guildRoles");
const discord = require("../discord");
const { accessSettings, accessGuildIds, fullAdminRoleIds } = require("../servers/serverAccess");
const {
    fullAccess, emptyAccess, accessForRoles, accessForUser, baseAccessMap, mergeAccess, userCanAny,
} = require("../../../config/permissions");
const logger = require("../../../logger");

// Discord API error codes that mean "this user is definitively not a guild
// member" (as opposed to a transient lookup failure).
const UNKNOWN_MEMBER = 10007;
const UNKNOWN_USER = 10013;

const NO_ACCESS = () => ({ isAdmin: false, access: emptyAccess() });
const ALL_ACCESS = () => ({ isAdmin: true, access: fullAccess() });

const gidOf = (guildId) => String(guildId || "").trim();

/**
 * What a logged-in account gets on one server without any role: that server's
 * base access plus the grants configured there for this account itself, both
 * edited in Einstellungen → Berechtigungen of that server. No server, nothing.
 *
 * Deliberately independent of Discord — it is the fallback when the role lookup
 * says "not a member" or fails outright, so a guest can still open the loot
 * views the guild decided to share, and the one person the loot council was
 * handed to does not lose it because the bot is offline.
 */
function BASE_ACCESS(userId, guildId) {
    const gid = gidOf(guildId);
    if (!gid) return NO_ACCESS();
    try {
        const settings = accessSettings(gid, getConfig());
        return {
            isAdmin: false,
            access: mergeAccess(baseAccessMap(settings.baseAccess), accessForUser(settings.userPermissions, userId)),
        };
    } catch {
        return NO_ACCESS();
    }
}

/** The role ids of a guild member, tolerating an unexpected member shape. */
function memberRoleIds(member) {
    const cache = member && member.roles && member.roles.cache;
    if (!cache || typeof cache.keys !== "function") return [];
    return [...cache.keys()];
}

/** Every server rights may be asked for: the configured servers plus every server holding settings. */
function knownGuildIds(config) {
    return [...new Set([...guildRoles.eventGuildIds(config), ...accessGuildIds(config)].map(gidOf).filter(Boolean))];
}

/** The base access of every known server, the starting point and the fallback. */
function baseGuilds(userId, config) {
    const guilds = {};
    for (const gid of knownGuildIds(config)) guilds[gid] = { access: BASE_ACCESS(userId, gid).access };
    return guilds;
}

/**
 * What the given Discord user id may do on each server:
 * `{ isAdmin, guilds: { [guildId]: { access, isOrga? } } }`.
 *
 * Full admin (on every server) if the id is a .env admin, or a member of ANY
 * known server holding one of the full-admin roles. Otherwise, per server, that
 * server's base access merged with the role grants of the roles held on that
 * server; `isOrga` when one of that server's orga roles is held there. Not being
 * a member of a server is not fatal — it keeps its base access. Throws only when
 * not a single server could be reached (bot not logged in, Discord unreachable),
 * so callers can tell "no access" from "unknown".
 */
async function computeGuildAccess(userId) {
    // ADMIN_USER_ID (+ optional LOGCHECK_ADMIN_IDS) is the bootstrap admin from .env.
    if (logcheckAdminIds.includes(String(userId))) return { isAdmin: true, guilds: {} };
    const config = getConfig();
    const adminRoleIds = fullAdminRoleIds(config);
    const guildIds = knownGuildIds(config);
    const guilds = baseGuilds(userId, config);
    const settingsOf = Object.fromEntries(guildIds.map((gid) => [gid, accessSettings(gid, config)]));
    const roleBased = guildIds.some((gid) => Object.keys(settingsOf[gid].rolePermissions).length || settingsOf[gid].orgaRoleIds.length);
    // Nothing role-based is configured at all — no need to hit Discord.
    if (!adminRoleIds.length && !roleBased) return { isAdmin: false, guilds };
    const botClient = discord.getClient();
    if (!botClient || !guildIds.length) throw new Error("bot client or guild id not available");
    let reachedAnyGuild = false;
    let lastGuildError = null;
    for (const guildId of guildIds) {
        let guild;
        try {
            guild = botClient.guilds.cache.get(guildId) || await botClient.guilds.fetch(guildId);
        } catch (e) {
            lastGuildError = e; // bot not on this server — it keeps its base access
            continue;
        }
        reachedAnyGuild = true;
        let member;
        try {
            member = await guild.members.fetch(userId);
        } catch (e) {
            // Not a member of this server — it keeps its base access; try the next.
            if (e && (e.code === UNKNOWN_MEMBER || e.code === UNKNOWN_USER)) continue;
            throw e;
        }
        const roleIds = memberRoleIds(member).map(String);
        if (adminRoleIds.some((rid) => roleIds.includes(rid))) return { isAdmin: true, guilds: {} };
        const settings = settingsOf[guildId];
        const access = mergeAccess(guilds[guildId].access, accessForRoles(settings.rolePermissions, roleIds));
        const isOrga = roleIds.some((rid) => settings.orgaRoleIds.includes(rid));
        guilds[guildId] = { access, ...(isOrga ? { isOrga: true } : {}) };
    }
    if (!reachedAnyGuild) throw lastGuildError || new Error("no configured server reachable");
    return { isAdmin: false, guilds };
}

/** computeGuildAccess(), falling back to the base access of every server when the lookup fails. */
async function resolveGuildAccess(userId) {
    try {
        return await computeGuildAccess(userId);
    } catch (e) {
        logger.warn(`Role lookup failed for ${userId}: ${e && e.message}`);
        try {
            return { isAdmin: false, guilds: baseGuilds(userId, getConfig()) };
        } catch {
            return { isAdmin: false, guilds: {} };
        }
    }
}

/**
 * The rights of one server out of a computeGuildAccess() result:
 * `{ isAdmin, access, isOrga? }`. A full admin gets everything; a server without
 * an entry gets its base access; no guild id gets nothing (fail closed).
 */
function accessForGuild(guildAccess, userId, guildId) {
    if (guildAccess && guildAccess.isAdmin) return ALL_ACCESS();
    const gid = gidOf(guildId);
    if (!gid) return NO_ACCESS();
    const entry = guildAccess && guildAccess.guilds && guildAccess.guilds[gid];
    if (!entry) return BASE_ACCESS(userId, gid);
    return { isAdmin: false, access: entry.access, ...(entry.isOrga ? { isOrga: true } : {}) };
}

/** What the user may do on `guildId`; throws when no server could be reached (see computeGuildAccess). */
async function computeAccess(userId, { guildId } = {}) {
    return accessForGuild(await computeGuildAccess(userId), userId, guildId);
}

/** computeAccess(), falling back to the base access of the server when the lookup fails. */
async function resolveAccess(userId, { guildId } = {}) {
    return accessForGuild(await resolveGuildAccess(userId), userId, guildId);
}

/** Whether the account may `level` ("read" | "write") at least one of `areas` on `guildId` — full admins always may. */
async function userMayAny(userId, areas, level = "read", { guildId } = {}) {
    return userCanAny(await resolveAccess(userId, { guildId }), areas, level);
}

module.exports = {
    BASE_ACCESS, NO_ACCESS, ALL_ACCESS, UNKNOWN_MEMBER, UNKNOWN_USER,
    computeGuildAccess, resolveGuildAccess, accessForGuild,
    computeAccess, resolveAccess, memberRoleIds, userMayAny,
};
