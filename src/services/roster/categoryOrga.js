// Who is the orga of a raid category (epic #723, #724) - the one rule the web
// (the `orgaScoped` gate, web/http/apiHandler.js + apiAccess.js), the
// Orga-Zentrale in Discord (services/events/orgaHubBot.js, orgaHubLinks.js) and
// the attendance overrides (services/characters/attendanceAccess.js) share:
//
//   - the global orga (permissions.userIsOrga: a full admin or an orga role) is
//     the orga of every category,
//   - a manager of a category's roster (rosterAccess: by account or by a role on
//     the roster's server) is the orga of that category - of the roster of the
//     version that is meant (#739): for a raid the roster of the raid's version
//     (categoryRoster.rosterOfEvent), without a raid the one the category plays
//     now (currentRoster).
//
// The manager roles are Discord roles: one lookup per server and user, shared by
// every question of one request (`cache`, see requestCache) and limited in time
// (ROLE_FETCH_MS) - an unknown member or a slow Discord counts as no role.
const discord = require("../discord/discord");
const { resolveAccess } = require("../discord/userAccess");
const { userIsOrga } = require("../../config/permissions");
const { canManageRosterLive } = require("./rosterAccess");
const categoryRoster = require("./categoryRoster");
const rosterStore = require("../../stores/rosterStore");
const { getEvent, isOwnEventId } = require("../../stores/eventStore");
const { getRaidEvent } = require("../../stores/raidEventStore");

/** How long one Discord role lookup may take on a page request (docs/known-issues.md: member lookups need a limit). */
const ROLE_FETCH_MS = 3000;

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** A fresh cache for one request (or one interaction): the Discord roles per server and user. */
function createCache() {
    return { roles: new Map() };
}

const byRequest = new WeakMap();

/** The cache of one HTTP request - the gate and the handler share it, so the roles are read once. */
function requestCache(req) {
    if (!req || typeof req !== "object") return createCache();
    let cache = byRequest.get(req);
    if (!cache) {
        cache = createCache();
        byRequest.set(req, cache);
    }
    return cache;
}

/**
 * `memberRoleIds(guildId, userId)` through the cache, at most ROLE_FETCH_MS long; a failure or a
 * timeout is null (= no roles known).
 */
function cachedRoleLookup(cache, lookup = discord.memberRoleIds, waitMs = ROLE_FETCH_MS) {
    const store = (cache && cache.roles) || new Map();
    return (guildId, userId) => {
        const key = `${str(guildId)}:${str(userId)}`;
        if (!store.has(key)) {
            let timer = null;
            const timeout = new Promise((resolve) => {
                timer = setTimeout(() => resolve(null), waitMs);
                if (timer && typeof timer.unref === "function") timer.unref();
            });
            const fetched = Promise.resolve()
                .then(() => lookup(guildId, userId))
                .catch(() => null);
            store.set(key, Promise.race([fetched, timeout]).finally(() => clearTimeout(timer)));
        }
        return store.get(key);
    };
}

/**
 * Whether `user` manages `roster` (admin, account list or a manager role) - without the global orga.
 * @param {object|null} user  the session user (`{ id, isAdmin, access, isOrga }`)
 * @param {object|null} roster
 * @param {{ cache?: object, memberRoleIds?: Function }} [opts]  `memberRoleIds`: the raw lookup (tests)
 * @returns {Promise<boolean>}
 */
async function managesRoster(user, roster, { cache, memberRoleIds } = {}) {
    if (!user) return false;
    if (!roster) return user.isAdmin === true;
    // a closed roster (#739, its category plays another version now) is read only - it makes nobody orga
    if (roster.closedAt && user.isAdmin !== true) return false;
    const lookup = cachedRoleLookup(cache || createCache(), memberRoleIds);
    return canManageRosterLive(user, roster, { memberRoleIds: lookup }).catch(() => false);
}

/** Whether `user` is the orga of `roster`: the global orga, or one of its managers. */
async function isOrgaOfRoster(user, roster, opts = {}) {
    if (!user) return false;
    if (userIsOrga(user)) return true;
    return managesRoster(user, roster, opts);
}

/**
 * Whether `user` is the orga of a category: the global orga, or a manager of the roster the category
 * plays now (a category without a roster has only the global orga).
 * @param {object|null} user
 * @param {string} categoryId
 * @param {{ cache?: object, memberRoleIds?: Function, config?: object }} [opts]
 */
async function isCategoryOrga(user, categoryId, { config, ...opts } = {}) {
    if (!user) return false;
    if (userIsOrga(user)) return true;
    const cat = str(categoryId);
    if (!cat) return false;
    return managesRoster(user, categoryRoster.currentRoster(cat, { config }), opts);
}

/**
 * isCategoryOrga for a Discord account known only by its id (a button of the Orga-Zentrale): its
 * rights as the web login computes them (userAccess.resolveAccess), then the same rule.
 */
async function isCategoryOrgaById(userId, categoryId, opts = {}) {
    const uid = str(userId);
    if (!uid) return false;
    return isCategoryOrga({ id: uid, ...(await resolveAccess(uid)) }, categoryId, opts);
}

/**
 * The categories `user` is the orga of through a roster: every category whose current roster they
 * manage - for the global orga every category that has a current roster (the global orga is the orga
 * of a category without a roster as well; who needs that asks userIsOrga first).
 * @returns {Promise<string[]>}  sorted, without duplicates
 */
async function orgaCategoryIds(user, { config, ...opts } = {}) {
    if (!user) return [];
    const global = userIsOrga(user);
    const cats = [...new Set(rosterStore.listRosters().map((r) => str(r.categoryId)).filter(Boolean))].sort();
    const out = [];
    for (const cat of cats) {
        const roster = categoryRoster.currentRoster(cat, { config });
        if (!roster) continue;
        if (global || await managesRoster(user, roster, opts)) out.push(cat);
    }
    return out;
}

/**
 * Whether `user` manages the current roster of at least one category - the global orga does not count
 * here (the `orgaScoped` gate asks it for those who are not). Stops at the first hit.
 */
async function isAnyCategoryManager(user, { config, ...opts } = {}) {
    if (!user) return false;
    const cats = [...new Set(rosterStore.listRosters().map((r) => str(r.categoryId)).filter(Boolean))];
    for (const cat of cats) {
        const roster = categoryRoster.currentRoster(cat, { config });
        if (roster && await managesRoster(user, roster, opts)) return true;
    }
    return false;
}

/**
 * The raid an id or a partial row stands for, as far as the category and version go - always the
 * server's own record, never what a caller's row claims (category and version alike):
 *   - an own event (`eh-` id): the stored event; unknown = null (no falling back on the row),
 *   - a Raid-Helper event: Raid-Helper's snapshot (raidEventStore), else the event groups
 *     (`loadGroups`); unknown = null,
 *   - a row without an id ("a new event in category X", #728): only its `categoryId` - the version
 *     is then the one the category plays now.
 */
async function resolveEvent(eventOrId, { loadGroups } = {}) {
    const given = eventOrId && typeof eventOrId === "object" ? eventOrId : { id: eventOrId };
    const id = str(given.id);
    if (!id) return str(given.categoryId) ? { categoryId: str(given.categoryId) } : null;
    if (isOwnEventId(id)) return getEvent(id) || null;
    const snap = getRaidEvent(id);
    if (snap && str(snap.categoryId)) return { ...snap, id };
    if (typeof loadGroups !== "function") return null;
    try {
        const { groups } = await loadGroups();
        for (const g of groups || []) {
            const ev = (g.events || []).find((e) => str(e.id) === id);
            if (ev) return { ...ev, categoryId: str(ev.categoryId) || str(g.categoryId) };
        }
    } catch {
        // the event list is unreachable: unknown
    }
    return null;
}

/**
 * Whether `user` is the orga of a raid: the global orga, or a manager of the open roster of the raid's
 * category in the raid's version (categoryRoster.rosterOfEvent; a closed roster gives no right). A raid
 * whose category cannot be told has only the global orga. `managerOnly`: the global orga does not
 * count - only the roster (the `orgaScoped` path of a global orga that lacks the route's right).
 * @param {object|null} user
 * @param {string|{ id?: string, categoryId?: string, versionId?: string }} event  an id or a row
 * @param {{ cache?: object, memberRoleIds?: Function, config?: object, loadGroups?: Function, managerOnly?: boolean }} [opts]
 *   `loadGroups`: the event groups (raidEventGroups.loadEventGroups) for a Raid-Helper event without snapshot
 * @returns {Promise<boolean>}
 */
async function canOrgaEvent(user, event, { config, loadGroups, managerOnly = false, ...opts } = {}) {
    if (!user) return false;
    if (!managerOnly && userIsOrga(user)) return true;
    const resolved = await resolveEvent(event, { loadGroups });
    if (!resolved || !str(resolved.categoryId)) return false;
    return managesRoster(user, categoryRoster.rosterOfEvent(resolved, { config }), opts);
}

module.exports = {
    ROLE_FETCH_MS,
    createCache, requestCache, cachedRoleLookup,
    managesRoster, isOrgaOfRoster, isCategoryOrga, isCategoryOrgaById, orgaCategoryIds, isAnyCategoryManager,
    resolveEvent, canOrgaEvent,
};
