// JSON-response counterpart to server.js's requireAdmin() (which sends the HTML
// "denied" page) — for /api/* routes.
const auth = require("./auth");
const { error } = require("./apiResponse");
const { userHasMenuAccess } = require("../config/permissions");

/**
 * Resolves the menu user for an /api/* request, or sends a JSON 401/403 and
 * returns null. "Menu user" = a full admin, or someone whose Discord roles grant
 * at least one area (see config/permissions.js). *Which* area an endpoint needs
 * is checked centrally before the handler runs (apiAccess.js), so a handler only
 * has to ask for a user here.
 */
function requireAdmin(req, res) {
    const user = auth.getUser(req);
    if (!user || !userHasMenuAccess(user)) {
        error(res, user ? 403 : 401, user ? "forbidden" : "unauthorized",
            user ? "Kein Admin-Zugang." : "Nicht angemeldet.");
        return null;
    }
    return user;
}

/**
 * Like requireAdmin(), but for actions reserved to *full* admins — currently the
 * access settings themselves (admin roles + role permissions), so a role with
 * write access to "Einstellungen" cannot escalate its own rights.
 */
function requireFullAdmin(req, res) {
    const user = auth.getUser(req);
    if (!user || !user.isAdmin) {
        error(res, user ? 403 : 401, user ? "forbidden" : "unauthorized",
            user ? "Nur Voll-Admins dürfen Zugang und Berechtigungen ändern." : "Nicht angemeldet.");
        return null;
    }
    return user;
}

/**
 * CSRF check for mutating /api/* requests: the SPA sends the token from
 * GET /api/session as an X-CSRF-Token header (the SSR forms use a hidden
 * `_csrf` field instead — see auth.checkCsrf()). Sends a JSON 403 and returns
 * false when missing/invalid.
 */
function requireCsrf(req, res) {
    if (!auth.checkCsrf(req, req.headers["x-csrf-token"])) {
        error(res, 403, "csrf", "Sicherheits-Token ungültig oder abgelaufen. Bitte Seite neu laden.");
        return false;
    }
    return true;
}

module.exports = { requireAdmin, requireFullAdmin, requireCsrf };
