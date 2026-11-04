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
// The server admin (#1072) holds Discord's "Administrator" right or owns one of
// the servers in `discordServers.servers`: every area and the orga rank on exactly
// that server, nothing on any other, and never `isAdmin`. Anyone can create a
// Discord server, so this rank is not trusted the way a full admin is. A rank entry
// keeps what the roles alone give (`roleAccess`, `roleIsOrga`): that is what counts
// where the rank does not (a route on data of every server, an unanswered re-check).
//
//   computeGuildAccess(userId)   `{ isAdmin, guilds: { [guildId]: { access, isOrga?, isMember?, membershipUnknown?, isServerAdmin?, roleAccess?, roleIsOrga? } } }`
//                                for every server; throws when a configured role
//                                lookup could not reach a single server
//   resolveGuildAccess(userId)   the same, the base access of each server when it fails
//                                (`membershipUnknown`: Discord gave no answer about it)
//   computeAccess(userId, { guildId })   the rights on that one server (fail closed
//                                without a guild id: only a full admin gets anything)
//   resolveAccess(userId, { guildId })   the same, the base access when the lookup fails
//   userMayAny(userId, areas, level, { guildId })   resolveAccess + permissions.userCanAny
const { PermissionFlagsBits } = require("discord.js");
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

/**
 * Whether a guild member holds Discord's "Administrator" right; has() answers
 * true for the server's owner as well. Any other member shape: no.
 */
function memberIsDiscordAdmin(member) {
    try {
        return member.permissions.has(PermissionFlagsBits.Administrator) === true;
    } catch {
        return false;
    }
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

/** The same servers, marked: Discord was not asked, so nothing is known about the membership there. */
function withUnknownMembership(guilds) {
    return Object.fromEntries(Object.entries(guilds).map(([gid, entry]) => [gid, { ...entry, membershipUnknown: true }]));
}

/**
 * What the given Discord user id may do on each server:
 * `{ isAdmin, guilds: { [guildId]: { access, isOrga?, isMember?, membershipUnknown?, isServerAdmin?, roleAccess?, roleIsOrga? } } }`.
 *
 * Full admin (on every server) if the id is a .env admin, or a member of ANY
 * known server holding one of the full-admin roles. Otherwise, per server, that
 * server's base access merged with the role grants of the roles held on that
 * server; `isOrga` when one of that server's orga roles is held there. `isMember`
 * when Discord answered with a member; `membershipUnknown` when it gave no answer
 * about the member, so that "not a member" is not read into it (#1074).
 * `isServerAdmin` (every area, `isOrga`) for
 * a Discord administrator or the owner of a server of `discordServers.servers`;
 * a pure overview target or the home guild outside that list never gives it. Such
 * an entry also carries what the roles alone give: `roleAccess`, `roleIsOrga`.
 * Not being a member of a server is not fatal — it keeps its base access.
 *
 * Throws only when something configured depends on the answer and not a single
 * server could be reached (bot not logged in, Discord unreachable), so callers
 * can tell "no access" from "unknown". With nothing role-based configured the
 * rank is all Discord is asked for: no answer then means the base access, as it
 * did before the rank existed, and never a rank.
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
    const answerRequired = adminRoleIds.length > 0 || roleBased;
    const rankGuildIds = new Set(guildRoles.listedServerIds(config).map(gidOf));
    const botClient = discord.getClient();
    if (!botClient || !guildIds.length) {
        if (answerRequired) throw new Error("bot client or guild id not available");
        return { isAdmin: false, guilds: withUnknownMembership(guilds) };
    }
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
            if (!answerRequired) { // only a rank was at stake — no answer, no rank
                guilds[guildId] = { ...guilds[guildId], membershipUnknown: true };
                continue;
            }
            throw e;
        }
        const roleIds = memberRoleIds(member).map(String);
        if (adminRoleIds.some((rid) => roleIds.includes(rid))) return { isAdmin: true, guilds: {} };
        const settings = settingsOf[guildId];
        const access = mergeAccess(guilds[guildId].access, accessForRoles(settings.rolePermissions, roleIds));
        const isOrga = roleIds.some((rid) => settings.orgaRoleIds.includes(rid));
        guilds[guildId] = rankGuildIds.has(guildId) && memberIsDiscordAdmin(member)
            ? { access: fullAccess(), isOrga: true, isMember: true, isServerAdmin: true, roleAccess: access, ...(isOrga ? { roleIsOrga: true } : {}) }
            : { access, ...(isOrga ? { isOrga: true } : {}), isMember: true };
    }
    if (answerRequired && !reachedAnyGuild) throw lastGuildError || new Error("no configured server reachable");
    return { isAdmin: false, guilds };
}

/**
 * A stored computeGuildAccess() result without its server-admin ranks: such a server
 * falls back to what the roles alone gave there (the base access for an entry without
 * them), every other server stays as is. `keep(guildId)` spares a server's rank. Without
 * a rank to take the result is returned as is.
 */
function withoutServerAdminRank(guildAccess, userId, { keep = () => false } = {}) {
    const entries = Object.entries((guildAccess && guildAccess.guilds) || {});
    if (!entries.some(([gid, entry]) => entry.isServerAdmin && !keep(gid))) return guildAccess;
    const guilds = {};
    for (const [gid, entry] of entries) {
        guilds[gid] = entry.isServerAdmin && !keep(gid)
            ? {
                access: entry.roleAccess || BASE_ACCESS(userId, gid).access,
                ...(entry.roleIsOrga ? { isOrga: true } : {}),
                ...(entry.isMember ? { isMember: true } : {}),
            }
            : entry;
    }
    return { ...guildAccess, guilds };
}

/** withoutServerAdminRank() for the servers no longer in `discordServers.servers`: a stored rank ends with the entry. */
function withoutDelistedRank(guildAccess, userId, config = getConfig()) {
    const entries = Object.values((guildAccess && guildAccess.guilds) || {});
    if (!entries.some((entry) => entry.isServerAdmin)) return guildAccess;
    const listed = new Set(guildRoles.listedServerIds(config).map(gidOf));
    return withoutServerAdminRank(guildAccess, userId, { keep: (gid) => listed.has(gid) });
}

/** computeGuildAccess(), falling back to the base access of every server when the lookup fails. */
async function resolveGuildAccess(userId) {
    try {
        return await computeGuildAccess(userId);
    } catch (e) {
        logger.warn(`Role lookup failed for ${userId}: ${e && e.message}`);
        try {
            return { isAdmin: false, guilds: withUnknownMembership(baseGuilds(userId, getConfig())) };
        } catch {
            return { isAdmin: false, guilds: {} };
        }
    }
}

/**
 * The rights of one server out of a computeGuildAccess() result:
 * `{ isAdmin, access, isOrga?, isServerAdmin? }`. A full admin gets everything; a
 * server without an entry gets its base access; no guild id gets nothing (fail closed).
 */
function accessForGuild(guildAccess, userId, guildId) {
    if (guildAccess && guildAccess.isAdmin) return ALL_ACCESS();
    const gid = gidOf(guildId);
    if (!gid) return NO_ACCESS();
    const entry = guildAccess && guildAccess.guilds && guildAccess.guilds[gid];
    if (!entry) return BASE_ACCESS(userId, gid);
    return {
        isAdmin: false,
        access: entry.access,
        ...(entry.isOrga ? { isOrga: true } : {}),
        ...(entry.isServerAdmin ? { isServerAdmin: true } : {}),
    };
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
    computeGuildAccess, resolveGuildAccess, accessForGuild, withoutServerAdminRank, withoutDelistedRank,
    computeAccess, resolveAccess, memberRoleIds, userMayAny,
};
