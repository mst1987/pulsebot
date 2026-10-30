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
const { getConfig } = require("../../stores/settingsStore");
const { eventGuildIds, serverLabel } = require("./guildRoles");
const { resolveGuildAccess, accessForGuild } = require("./userAccess");
const categoryOrga = require("../roster/categoryOrga");
const discord = require("./discord");
const { listKnownCategories } = require("./categoryNames");
const { mainVersionFor } = require("../events/mainVersion");
const { settingsForVersion } = require("../events/versionSettings");
const { rulesFor } = require("../../config/gameVersions");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/**
 * The servers `userId` is orga of: `[{ guildId, role }]` in the order of the configured servers,
 * `role` "admin" | "orga" | "category".
 * @param {string} userId
 * @param {{ config?: object, guildAccess?: object, cache?: object, memberRoleIds?: Function }} [opts]
 *   `guildAccess`: a computeGuildAccess() result to reuse instead of asking Discord. The profile
 *   route (web/apiRoutes/syncKeys.js) passes the session's (auth.sessionGuildAccess), so a page view
 *   never waits on a member lookup; the /api/ingest/* routes leave it out and ask anew.
 */
async function orgaServersOf(userId, { config, guildAccess, cache, memberRoleIds } = {}) {
    const uid = str(userId);
    if (!uid) return [];
    const cfg = config || getConfig();
    const access = guildAccess || await resolveGuildAccess(uid);
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

/** The versions a server plays (`[{ id, short, realm }]`): those of its categories, else the main version. */
function versionsOfServer(guildId, config) {
    const cfg = config || getConfig();
    const ids = new Set();
    for (const cat of listKnownCategories(guildId)) ids.add(mainVersionFor({ categoryId: cat.id, config: cfg }));
    if (!ids.size) ids.add(mainVersionFor({ config: cfg }));
    return [...ids].map((id) => {
        const rules = rulesFor(id) || {};
        const realm = str(settingsForVersion(id, { config: cfg, guildId }).blizzardRealmSlug);
        return { id, short: str(rules.short) || str(rules.label) || id, realm };
    });
}

/**
 * What the sync app shows after connecting (`GET /api/ingest/me`): each server with its Discord
 * name, the label of the settings, the owner's role there and its versions.
 * @param {{ guildId: string, role?: string }[]} servers
 */
function describeServers(servers, { config } = {}) {
    const cfg = config || getConfig();
    const names = new Map((discord.listGuilds() || []).map((g) => [str(g.id), str(g.name)]));
    return (servers || []).map(({ guildId, role }) => ({
        guildId,
        name: names.get(guildId) || "",
        label: serverLabel(guildId, cfg),
        role: role || "",
        versions: versionsOfServer(guildId, cfg),
    }));
}

module.exports = { orgaServersOf, isPersonToken, serversOfToken, versionsOfServer, describeServers };
