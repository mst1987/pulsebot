// Central access gate for /api/* — which admin-menu area each endpoint belongs
// to, checked before the route handler runs (see apiRouter.js's handle()).
//
// The required level follows the HTTP method: GET reads, everything else writes.
// Full admins pass everything; other users need the area granted to one of their
// Discord roles (see config/permissions.js and the "Berechtigungen" settings tab).
//
// Fail-closed by design: an endpoint missing from this table is admin-only, so
// adding a route without listing it here can never leak it to a limited role.
const { AREAS, userCan, userHasMenuAccess } = require("../config/permissions");

const AREA_BY_PATH = {
    "/api/dashboard": "dashboard",

    "/api/channels": "channels",
    "/api/channels/duplicate": "channels",

    "/api/settings": "settings",
    // Wowhead search behind the top-item picker in the Loot tab.
    "/api/settings/item-search": "settings",
    "/api/settings/raidsheets": "settings",
    "/api/settings/raidsheets/delete": "settings",
    // Loot-sync tokens. Listed here so a settings-reader gets the same 403 as
    // everywhere else, but the handlers additionally demand a *full* admin —
    // these are credentials that skip the Discord login (apiRoutes/settings.js).
    "/api/settings/ingest-tokens": "settings",
    "/api/settings/ingest-tokens/delete": "settings",
    // The raider→character assignment lives in the settings page's own tab.
    "/api/raider-characters": "settings",

    "/api/roster": "roster",

    "/api/raids": "raids",
    "/api/raids/new": "raids",
    "/api/raids/detail": "raids",
    "/api/raids/notify": "raids",
    "/api/raids/ping-missing": "raids",
    "/api/raids/fill": "raids",
    "/api/raids/post-sheet": "raids",
    "/api/raids/post-softres": "raids",
    "/api/raids/softres": "raids",
    "/api/raids/softres/link": "raids",
    "/api/raids/softres/item-search": "raids",
    // Anmelde-Aufruf and Raid-Helper templates are edited from the raid pages.
    "/api/notify-templates": "raids",
    "/api/notify-templates/delete": "raids",
    "/api/raid-templates": "raids",
    "/api/raid-templates/delete": "raids",
    "/api/raid-templates/import": "raids",

    "/api/recruitment": "recruitment",
    "/api/recruitment/delete": "recruitment",
    "/api/recruitment/post": "recruitment",
    "/api/recruitment/post-update": "recruitment",
    "/api/recruitment/post-delete": "recruitment",
    "/api/recruitment/scan": "recruitment",

    "/api/history": "history",
    "/api/history/loot-stats": "history",
    "/api/history/loot-awards": "history",
    "/api/history/log-delete": "history",
    "/api/history/import": "history",
    "/api/history/inbox": "history",
    "/api/history/inbox-accept": "history",
    "/api/history/inbox-dismiss": "history",
    "/api/history/loot-category": "history",
    "/api/history/loot-delete": "history",
    "/api/history/loot-picker": "history",
    "/api/history/loot-add": "history",
    "/api/history/clear": "history",
    "/api/history/event": "history",
    "/api/history/characters-resolve": "history",
    "/api/history/char": "history",

    "/api/cla": "cla",
    "/api/cla/report-status": "cla",
    "/api/cla/report-delete": "cla",
    "/api/cla/report-unlink": "cla",
    "/api/cla/eval": "cla",
    "/api/cla/eval-status": "cla",
    "/api/cla/eval-reset": "cla",
    "/api/cla/scan": "cla",
    "/api/cla/log-delete": "cla",
    "/api/cla/log-link": "cla",
    "/api/cla/log-link-url": "cla",
    "/api/cla/log-unlink": "cla",
    "/api/cla/log-automatch": "cla",
};

// Answers for anyone, logged in or not — the client bootstraps from it.
const UNGATED = new Set(["/api/session"]);
// Needs a menu user, but belongs to no single area (the guild switcher).
const ANY_AREA = new Set(["/api/session/guild"]);
// Authenticated by an API token instead of a Discord session (the loot-sync
// uploader — see apiRoutes/ingest.js). These bypass *this* gate because there is
// no session user to check, never the auth itself: the handler rejects anything
// without a valid bearer token before it does any work. Deliberately a tiny,
// explicit set — an endpoint listed here is reachable by whoever holds a token.
const TOKEN_AUTH = new Set(["/api/ingest/loot"]);

const LABELS = Object.fromEntries(AREAS.map((a) => [a.id, a.label]));

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
    const area = AREA_BY_PATH[pathname];
    // Unknown endpoint (or one nobody listed): admins only.
    if (!area) {
        return user.isAdmin ? null : { status: 403, code: "forbidden", message: "Kein Zugang zu diesem Bereich." };
    }
    const level = method === "GET" ? "read" : "write";
    if (userCan(user, area, level)) return null;
    const label = LABELS[area] || area;
    return {
        status: 403,
        code: "forbidden",
        message: level === "write"
            ? `Keine Schreibrechte für „${label}".`
            : `Kein Zugriff auf „${label}".`,
    };
}

module.exports = { checkAccess, AREA_BY_PATH, UNGATED, ANY_AREA, TOKEN_AUTH };
