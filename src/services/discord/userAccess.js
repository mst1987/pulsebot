// What a Discord account may do in the EventHelper: `{ isAdmin, access }`, the
// per-area read/write map of config/permissions.js. The web login (web/http/
// auth.js) stores it in the session; the bot asks the same for an orga button
// (commands/signup/guildBank.js: "Erledigt" needs write access to `raids`), so
// a member has the same rights in Discord as in the menu. It lives here and not
// in web/ because commands/ and utils/ never require from web/
// (test/docs/layering.test.js).
//
//   computeAccess(userId)   the roles on every configured event server; throws
//                           when not one of them could be reached
//   resolveAccess(userId)   the same, the base access when the lookup fails
//   userMayAny(userId, areas, level)   resolveAccess + permissions.userCanAny
const { logcheckAdminIds, adminRoleIds: envAdminRoleIds } = require("../../config/variables");
const { getConfig } = require("../../stores/settingsStore");
const guildRoles = require("./guildRoles");
const discord = require("./discord");
const {
    fullAccess, emptyAccess, accessForRoles, accessForUser, baseAccessMap, mergeAccess, userCanAny,
} = require("../../config/permissions");
const logger = require("../../logger");

// Discord API error codes that mean "this user is definitively not a guild
// member" (as opposed to a transient lookup failure).
const UNKNOWN_MEMBER = 10007;
const UNKNOWN_USER = 10013;

const NO_ACCESS = () => ({ isAdmin: false, access: emptyAccess() });
const ALL_ACCESS = () => ({ isAdmin: true, access: fullAccess() });

/**
 * What a logged-in account gets without any role: config.baseAccess plus the
 * grants configured for this account itself (config.userPermissions), both
 * edited in Einstellungen → Berechtigungen.
 *
 * Deliberately independent of Discord — it is the fallback when the role lookup
 * says "not a member" or fails outright, so a guest can still open the loot
 * views the guild decided to share, and the one person the loot council was
 * handed to does not lose it because the bot is offline.
 */
function BASE_ACCESS(userId) {
    try {
        const config = getConfig();
        return {
            isAdmin: false,
            access: mergeAccess(baseAccessMap(config.baseAccess), accessForUser(config.userPermissions, userId)),
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

/**
 * What the given Discord user id may currently do: `{ isAdmin, access }`.
 * Full admin if the id is in the static admin list, or a member of ANY
 * configured event server (#361 — several can exist now) holding one of the
 * admin roles there — full admins get every area at write level. Otherwise
 * the union of the role permissions of the roles they hold across every
 * configured event server they belong to (see config/permissions.js). Not
 * being a member of a given event server is not fatal — the next one is
 * tried. Throws only when not a single configured event server could be
 * reached at all (bot not logged in, Discord unreachable), so callers can
 * distinguish "no access" from "unknown".
 */
async function computeAccess(userId) {
    // ADMIN_USER_ID (+ optional LOGCHECK_ADMIN_IDS) is the bootstrap admin from .env.
    if (logcheckAdminIds.includes(String(userId))) return ALL_ACCESS();
    const config = getConfig();
    // Role IDs are configured in the admin menu (data/settings/config.json),
    // with any .env ADMIN_ROLE_IDS merged in as an optional fallback.
    const adminRoleIds = [...new Set([...(config.adminRoleIds || []), ...(envAdminRoleIds || [])])];
    const rolePermissions = config.rolePermissions || {};
    // What this account gets before any role is looked at: the guild-wide base
    // access plus its own per-account grants (see BASE_ACCESS).
    const base = BASE_ACCESS(userId).access;
    // Nothing role-based is configured at all — no need to hit Discord.
    if (!adminRoleIds.length && !Object.keys(rolePermissions).length) return { isAdmin: false, access: base };
    // The event servers are admin-editable (data/settings/config.json); an
    // install that never configured one falls back to guildId, .env-only in turn.
    const guildIds = guildRoles.eventGuildIds(config);
    const botClient = discord.getClient();
    if (!botClient || !guildIds.length) throw new Error("bot client or guild id not available");
    let access = base;
    let reachedAnyGuild = false;
    let lastGuildError = null;
    for (const guildId of guildIds) {
        let guild;
        try {
            guild = botClient.guilds.cache.get(guildId) || await botClient.guilds.fetch(guildId);
        } catch (e) {
            lastGuildError = e; // bot not on this event server — try the next one
            continue;
        }
        reachedAnyGuild = true;
        let member;
        try {
            member = await guild.members.fetch(userId);
        } catch (e) {
            // Not a member of this event server — they still keep what they have so far; try the next.
            if (e && (e.code === UNKNOWN_MEMBER || e.code === UNKNOWN_USER)) continue;
            throw e;
        }
        if (adminRoleIds.some((rid) => member.roles.cache.has(rid))) return ALL_ACCESS();
        access = mergeAccess(access, accessForRoles(rolePermissions, memberRoleIds(member)));
    }
    if (!reachedAnyGuild) throw lastGuildError || new Error("no configured event server reachable");
    return { isAdmin: false, access };
}

/** computeAccess(), falling back to the base access when the lookup fails. */
async function resolveAccess(userId) {
    try {
        return await computeAccess(userId);
    } catch (e) {
        logger.warn(`Role lookup failed for ${userId}: ${e && e.message}`);
        return BASE_ACCESS(userId);
    }
}

/** Whether the account may `level` ("read" | "write") at least one of `areas` — full admins always may. */
async function userMayAny(userId, areas, level = "read") {
    return userCanAny(await resolveAccess(userId), areas, level);
}

module.exports = {
    BASE_ACCESS, NO_ACCESS, ALL_ACCESS, UNKNOWN_MEMBER, UNKNOWN_USER,
    computeAccess, resolveAccess, memberRoleIds, userMayAny,
};
