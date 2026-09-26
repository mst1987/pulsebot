// Central access gate for /api/* — which admin-menu area each endpoint belongs
// to, checked before the route handler runs (see apiRouter.js's handle()).
//
// The areas come from the route table itself (routeTable.js, fed by the
// `routes` export of every apiRoutes/*.js): the path that is dispatched and
// the area that opens it are one entry, so neither can be forgotten alone.
//
// The required level follows the HTTP method: GET reads, everything else writes
// (an entry may pin `level: "write"` for a GET that only prepares an action).
// Full admins pass everything; other users need the area granted to one of
// their Discord roles (see config/permissions.js and the "Berechtigungen"
// settings tab).
//
// Fail-closed by design: a route without an area — one that is not registered
// at all, or one registered without `area`/`auth` — is admin-only, so adding a
// route can never leak it to a limited role. `test/web/http/apiAccess.test.js`
// insists that such an entry says `adminOnly: true` out loud.
//
// A route may name *several* areas — then any one of them at the required level
// lets the call through. That is how the loot views ("loot") share endpoints
// with the full history ("history") without handing out the rest of that tab;
// the handlers of the shared endpoints trim their payload accordingly.
const { AREAS, userCanAny, userHasMenuAccess } = require("../../config/permissions");
const { ROUTES, find, areasOf } = require("./routeTable");

/** `{ [path]: area | [areas] }` — every gated path with its area(s), the shape the tests and the docs know. */
const AREA_BY_PATH = {};
for (const r of ROUTES) {
    if (!r.area) continue;
    const areas = areasOf(r);
    const known = AREA_BY_PATH[r.path];
    const same = known && JSON.stringify(Array.isArray(known) ? known : [known]) === JSON.stringify(areas);
    if (known && !same) throw new Error(`${r.path} is registered with different areas per method`);
    if (!known) AREA_BY_PATH[r.path] = r.area;
}

const pathsWith = (auth) => new Set(ROUTES.filter((r) => r.auth === auth).map((r) => r.path));

// Answers for anyone, logged in or not — the client bootstraps from it.
// "/api/session/view-as" checks the caller's *own* rights in its handler
// (auth.getRealUser): while an admin looks at the menu as a role, this gate only
// sees the role's rights — and the way back out must never be refused by them.
// "/api/raidplan/public" is the token-guarded read view of a published raid plan
// (/p/<token>): no session needed, and its handler answers only for the token of
// a published plan.
const UNGATED = pathsWith("none");
// Needs a menu user, but belongs to no single area (the guild switcher, the
// account's own menu language).
const ANY_AREA = pathsWith("menu");
// Authenticated by an API token instead of a Discord session (the loot-sync
// uploader — see apiRoutes/ingest.js). These bypass *this* gate because there is
// no session user to check, never the auth itself: the handler rejects anything
// without a valid bearer token before it does any work. Deliberately a tiny,
// explicit set — an endpoint listed here is reachable by whoever holds a token.
const TOKEN_AUTH = pathsWith("token");

const LABELS = Object.fromEntries(AREAS.map((a) => [a.id, a.label]));

/** The areas listed for a path, always as an array (empty = not listed). */
function areasFor(pathname) {
    const entry = AREA_BY_PATH[pathname];
    if (!entry) return [];
    return Array.isArray(entry) ? entry : [entry];
}

/** The level a call needs: the entry's own `level`, else read for GET and write for the rest. */
function levelFor(method, route) {
    if (route && (route.level === "read" || route.level === "write")) return route.level;
    return method === "GET" ? "read" : "write";
}

/**
 * Check a request against the caller's permissions.
 * Returns null when it may proceed, else `{ status, code, message }` to send.
 */
function checkAccess(pathname, method, user) {
    if (UNGATED.has(pathname)) return null;
    if (TOKEN_AUTH.has(pathname)) return null;
    if (!user) return { status: 401, code: "unauthorized", message: "Nicht angemeldet." };
    if (!userHasMenuAccess(user)) {
        return { status: 403, code: "forbidden", message: "Kein Zugang zum Admin-Menü." };
    }
    if (ANY_AREA.has(pathname)) return null;
    const route = find(method, pathname);
    // The path's areas, so a wrong method on a known path is refused for the
    // same reason as the right one and answered 405 only to those who may.
    const areas = route ? areasOf(route) : areasFor(pathname);
    // Unknown endpoint (or one nobody listed): admins only.
    if (!areas.length) {
        return user.isAdmin ? null : { status: 403, code: "forbidden", message: "Kein Zugang zu diesem Bereich." };
    }
    const level = levelFor(method, route);
    if (userCanAny(user, areas, level)) return null;
    // The first area is the endpoint's home; the others only widen access, so it
    // is the one to name in the refusal.
    const label = LABELS[areas[0]] || areas[0];
    return {
        status: 403,
        code: "forbidden",
        message: level === "write"
            ? `Keine Schreibrechte für „${label}".`
            : `Kein Zugriff auf „${label}".`,
    };
}

module.exports = { checkAccess, areasFor, levelFor, AREA_BY_PATH, UNGATED, ANY_AREA, TOKEN_AUTH };
