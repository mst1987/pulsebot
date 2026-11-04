// Which Discord servers a sync key may work on (#1000, epic #999).
//
//   - a personal key (`ownerId`): every configured server its owner is orga of
//     right now - a full admin, an orga role of that server, or the manager of
//     a category roster of that server (the same rule as the web's `orgaScoped`
//     gate, services/roster/categoryOrga.js). Asked anew on every request: a
//     role taken away removes the server at once. A lookup that fails counts
//     only what needs no Discord (the .env admins, managers by account).
//   - a server key (`guildId`, #994): that one server.
//   - an old key (neither): null - the /api/ingest/* routes keep their rules
//     from before #994 (first server / every server).
//
// It lives in services/ and not in web/ so the guild bank (services/guildbank)
// can ask it as well (test/docs/layering.test.js).
const { getConfig } = require("../../../stores/settings/settingsStore");
const { eventGuildIds, serverLabel } = require("../roles/guildRoles");
const { resolveGuildAccess, accessForGuild, withoutServerAdminRank } = require("../members/userAccess");
const { userCan } = require("../../../config/permissions");
const categoryOrga = require("../../roster/categoryOrga");
const discord = require("../discord");
const { listKnownCategories } = require("../../categories/categoryNames");
const { mainVersionFor } = require("../../versions/mainVersion");
const { settingsForVersion } = require("../../versions/versionSettings");
const { rulesFor } = require("../../../config/gameVersions");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/**
 * The servers `userId` is orga of: `[{ guildId, role }]` in the order of the configured servers,
 * `role` "admin" | "orga" | "category".
 * @param {string} userId
 * @param {{ config?: object, guildAccess?: object, cache?: object, memberRoleIds?: Function }} [opts]
 *   `guildAccess`: a computeGuildAccess() result to reuse instead of asking Discord. The profile
 *   route (web/apiRoutes/loot/syncKeys.js) passes the session's (auth.sessionGuildAccess), so a page view
 *   never waits on a member lookup; the /api/ingest/* routes leave it out and ask anew.
 *   `rolesOnly`: leave the server-admin rank out (#1072). For an upload that is tied to no server:
 *   the rank is a right on one server's own data and says nothing about what every server shares.
 */
async function orgaServersOf(userId, { config, guildAccess, cache, memberRoleIds, rolesOnly = false } = {}) {
    const uid = str(userId);
    if (!uid) return [];
    const cfg = config || getConfig();
    const known = guildAccess || await resolveGuildAccess(uid);
    const access = rolesOnly ? withoutServerAdminRank(known, uid) : known;
    const shared = cache || categoryOrga.createCache();
    const out = [];
    for (const gid of eventGuildIds(cfg)) {
        if (access && access.isAdmin) {
            out.push({ guildId: gid, role: "admin" });
            continue;
        }
        const rights = accessForGuild(access, uid, gid);
        if (rights.isOrga) {
            out.push({ guildId: gid, role: "orga" });
            continue;
        }
        const user = { id: uid, ...rights };
        if (await categoryOrga.isAnyCategoryManager(user, { config: cfg, guildId: gid, cache: shared, memberRoleIds })) {
            out.push({ guildId: gid, role: "category" });
        }
    }
    return out;
}

/** Whether a token record is a personal key. */
function isPersonToken(token) {
    return !!(token && str(token.ownerId));
}

/**
 * The servers a sync key may work on: the owner's orga servers (personal key), `[guildId]` (server
 * key), or null (old key: the routes' rules from before #994).
 * @returns {Promise<string[]|null>}
 */
async function serversOfToken(token, opts = {}) {
    if (!token) return [];
    if (isPersonToken(token)) return (await orgaServersOf(token.ownerId, opts)).map((s) => s.guildId);
    const own = str(token.guildId);
    return own ? [own] : null;
}

/**
 * Whether what a sync key uploads for `guildId` may teach the shared character store (the classes
 * of services/characters/characterInfo.js, which every server reads). Only the owner of a personal
 * key who holds nothing but the server-admin rank there may not (#1072): the rule of
 * `mayLearnClasses` in web/apiRoutes/loot/history.js, for a key instead of a session. A server key,
 * an old key, a role holder and a full admin go on as before. A raid without a known server asks
 * every server the owner holds the rank on (fail closed).
 * @returns {Promise<boolean>}
 */
async function tokenMayLearnClasses(token, guildId) {
    if (!isPersonToken(token)) return true;
    const uid = str(token.ownerId);
    const known = await resolveGuildAccess(uid);
    if (known && known.isAdmin) return true;
    const gid = str(guildId);
    const ranked = (gid ? [gid] : Object.keys((known && known.guilds) || {})).filter((g) => accessForGuild(known, uid, g).isServerAdmin);
    if (!ranked.length) return true;
    const byRoles = withoutServerAdminRank(known, uid);
    return ranked.every((g) => userCan(accessForGuild(byRoles, uid, g), "history", "write"));
}

/**
 * A game version as the sync app names it on a server (`{ id, short, realm }`): the short name of
 * its rule set and the Blizzard realm slug of that server's version settings. Shared by
 * `GET /api/ingest/me` and the council data v4 (#1001), so both name a version the same way.
 */
function versionHead(id, guildId, config) {
    const cfg = config || getConfig();
    const rules = rulesFor(id) || {};
    const realm = str(settingsForVersion(id, { config: cfg, guildId }).blizzardRealmSlug);
    return { id, short: str(rules.short) || str(rules.label) || id, realm };
}

/** The versions a server plays (`[{ id, short, realm }]`): those of its categories, else the main version. */
function versionsOfServer(guildId, config) {
    const cfg = config || getConfig();
    const ids = new Set();
    for (const cat of listKnownCategories(guildId)) ids.add(mainVersionFor({ categoryId: cat.id, config: cfg }));
    if (!ids.size) ids.add(mainVersionFor({ config: cfg }));
    return [...ids].map((id) => versionHead(id, guildId, cfg));
}

/**
 * What the sync app shows after connecting (`GET /api/ingest/me`): each server with its Discord
 * name and icon, the label of the settings, the owner's role there and its versions.
 * @param {{ guildId: string, role?: string }[]} servers
 */
function describeServers(servers, { config } = {}) {
    const cfg = config || getConfig();
    const names = new Map((discord.listGuilds() || []).map((g) => [str(g.id), str(g.name)]));
    return (servers || []).map(({ guildId, role }) => ({
        guildId,
        name: names.get(guildId) || "",
        label: serverLabel(guildId, cfg),
        iconUrl: discord.guildIconUrl(guildId),
        role: role || "",
        versions: versionsOfServer(guildId, cfg),
    }));
}

module.exports = { orgaServersOf, isPersonToken, serversOfToken, tokenMayLearnClasses, versionHead, versionsOfServer, describeServers };
