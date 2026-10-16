// The preamble every session-authenticated /api/* handler used to spell out by
// hand — "who is calling, may they write, is the CSRF token there, what is in
// the body" — as one wrapper, so a handler starts with its own work.
//
//   const putThing = withUser({ write: "raids", csrf: true, body: true }, async ({ user, body, res }) => { … });
//
// The wrapped function keeps the router's `(req, res, url)` signature, so the
// route table and direct calls in tests see no difference. The checks run in
// the order the handlers always ran them: menu user (or full admin), orga, write
// right on an area, CSRF, then the JSON body. Each refusal is sent by the
// middleware it always came from (apiMiddleware.js), the answer formats are
// unchanged. The area gate itself (apiAccess.js) still runs before any of this
// in apiRouter.handle(); `write` only guards a handler that is called directly
// or a GET that prepares an action.
//
// The orga (#723, docs/permissions.md "Kategorie-Orga") comes in two widths:
//   orga: true            the global orga only (permissions.userIsOrga)
//   orgaScoped: (body, query) => eventId(s)
//                         the global orga with the route's rights as with
//                         `orga: true`, and besides them the orga of the raid's
//                         category (a manager of its open roster,
//                         services/roster/categoryOrga.js). For such a category
//                         orga the event's category is their right: `write` is
//                         not asked, the area gate lets them in as well
//                         (apiAccess.gate), and after the body is read every
//                         event the function names must be one of their
//                         categories - else 403 "not_category_orga", before
//                         the archive check. Naming no event, or an empty entry
//                         in a list, refuses them too (fail-closed). A global
//                         orga lacking the route's `write` or area takes the
//                         same category path - never less than a manager.
//   globalByWrite: true   (with `orgaScoped` and `write`) the global path is the
//                         route's `write` right alone, no orga rank: an area
//                         handed to people outside the orga (the raid plan,
//                         docs/permissions.md "raidplan", #726). Everybody else
//                         takes the category path as above.
// The two are exclusive; the wrapper carries `orgaScoped = true` so the route
// table and the area gate see the mark (routeTable.isOrgaScoped).
const { requireAdmin, requireFullAdmin, requireCsrf } = require("./apiMiddleware");
const { readJsonBody } = require("./apiBody");
const { error } = require("./apiResponse");
const { activeGuildFor } = require("./activeGuild");
const { AREAS, userCan, userIsOrga } = require("../../config/permissions");
const { archivedRefusal } = require("../../services/events/eventArchive");
const categoryOrga = require("../../services/roster/categoryOrga");
const { loadEventGroups, eventLookbackSince } = require("../../services/events/raidEventGroups");

const ORGA_ONLY = "Das darf nur die Orga.";
const NOT_CATEGORY_ORGA = "Das darf nur die Orga dieser Kategorie.";

/** The event groups of the caller's server, for a Raid-Helper event without snapshot (loaded on demand). */
const groupsLoaderFor = (req) => () => loadEventGroups(activeGuildFor(req), { sinceSeconds: eventLookbackSince() });

/** An entry of what `orgaScoped` names: an id or a row (`{ id }`, or `{ categoryId }` for a new event). */
const namesEvent = (v) => (v && typeof v === "object" ? !!(String(v.id || "").trim() || String(v.categoryId || "").trim()) : !!String(v === null || v === undefined ? "" : v).trim());

/**
 * Whether the caller manages the roster of every event `ids` names (the category path - the global
 * orga does not count here). Nothing named, or one empty entry in the list, refuses.
 */
async function categoryOrgaOfAll(user, ids, req) {
    const list = Array.isArray(ids) ? ids : [ids];
    if (!list.length || !list.every(namesEvent)) return false;
    const opts = { cache: categoryOrga.requestCache(req), loadGroups: groupsLoaderFor(req), managerOnly: true };
    for (const event of list) {
        if (!(await categoryOrga.canOrgaEvent(user, event, opts))) return false;
    }
    return true;
}

const LABELS = Object.fromEntries(AREAS.map((a) => [a.id, a.label]));

/**
 * @param {object} opts
 * @param {boolean} [opts.full]   only a full admin (requireFullAdmin) — the access settings and the foreign credentials
 * @param {boolean} [opts.orga]   only the orga (permissions.userIsOrga: full admin or an orga role) - an area
 *        right is no orga rank, raider roles hold some; 403 "orga_only" otherwise
 * @param {(body: object, query: URLSearchParams, req: object) => string|object|Array<string|object>} [opts.orgaScoped]
 *        the global orga (as `orga`) or the orga of the category of every event the function names
 *        (an id or a row with `categoryId`; `req` for what only the request knows, e.g. its server -
 *        a new event's category, #728); 403 "orga_only" for whom it is neither, 403
 *        "not_category_orga" for a category orga outside the event's category (see the head comment)
 * @param {boolean} [opts.globalByWrite]  with `orgaScoped` + `write`: that write right alone is the global
 *        path (every raid), whatever the orga rank - an area handed to people outside the orga (#726)
 * @param {string}  [opts.write]  the area the caller needs at write level (403 otherwise)
 * @param {boolean} [opts.csrf]   check the X-CSRF-Token header (every mutating call)
 * @param {boolean} [opts.body]   parse the JSON body (always an object; `{}` when empty or invalid)
 * @param {(body: object, query: URLSearchParams) => string|string[]} [opts.archived]
 *        the event id(s) a write changes: an event of a hidden game version is
 *        read only (#563, eventArchive.js) and the call answers 409 "archived"
 * @param {(ctx: { user, body, query, url, req, res }) => any} fn the handler
 */
function withUser(opts, fn) {
    if (typeof opts === "function") { fn = opts; opts = {}; }
    const { full = false, orga = false, orgaScoped = null, globalByWrite = false, write = "", csrf = false, body = false, archived = null } = opts || {};
    if (orgaScoped !== null && typeof orgaScoped !== "function") throw new Error("withUser: orgaScoped names the event(s) as (body, query) => id(s)");
    if (orgaScoped && orga) throw new Error("withUser: orga and orgaScoped exclude each other");
    if (globalByWrite && (!orgaScoped || !write)) throw new Error("withUser: globalByWrite needs orgaScoped and write");
    async function handler(req, res, url) {
        const user = full ? requireFullAdmin(req, res) : requireAdmin(req, res);
        if (!user) return undefined;
        if (orga && !userIsOrga(user)) {
            error(res, 403, "orga_only", ORGA_ONLY);
            return undefined;
        }
        const writeMissing = !!write && !userCan(user, write, "write");
        // The category path: not the global orga - or a global orga without the route's right (the
        // `write` here, or the area the gate let them past as a manager): never less than a manager.
        const cache = orgaScoped ? categoryOrga.requestCache(req) : null;
        // the global path: the orga with the route's right - or, `globalByWrite`, that right alone
        const global = !writeMissing && (globalByWrite || userIsOrga(user));
        const scoped = !!orgaScoped && (!global || cache.areaViaCategory === true);
        if (scoped && !(await categoryOrga.isAnyCategoryManager(user, { cache }))) {
            if ((globalByWrite || userIsOrga(user)) && writeMissing) error(res, 403, "forbidden", `Keine Schreibrechte für „${LABELS[write] || write}“.`);
            else error(res, 403, "orga_only", ORGA_ONLY);
            return undefined;
        }
        if (writeMissing && !scoped) {
            error(res, 403, "forbidden", `Keine Schreibrechte für „${LABELS[write] || write}“.`);
            return undefined;
        }
        if (csrf && !requireCsrf(req, res)) return undefined;
        const parsed = body ? ((await readJsonBody(req)) || {}) : undefined;
        const query = url && url.searchParams ? url.searchParams : new URLSearchParams();
        // the category first: a raid of another category is "not yours", whatever its archive state
        if (scoped && !(await categoryOrgaOfAll(user, orgaScoped(parsed || {}, query, req), req))) {
            error(res, 403, "not_category_orga", NOT_CATEGORY_ORGA);
            return undefined;
        }
        if (archived) {
            const refused = archivedRefusal(archived(parsed || {}, query));
            if (refused) {
                error(res, refused.status, refused.code, refused.message);
                return undefined;
            }
        }
        return fn({ user, body: parsed, query, url, req, res });
    }
    if (orgaScoped) handler.orgaScoped = true;
    return handler;
}

module.exports = { withUser, ORGA_ONLY, NOT_CATEGORY_ORGA };
