// JSON-response counterpart to server.js's requireAdmin() (which sends the HTML
// "denied" page) — for /api/* routes.
const auth = require("./auth");
const { error } = require("./apiResponse");

/** Resolves the admin user for an /api/* request, or sends a JSON 401/403 and returns null. */
function requireAdmin(req, res) {
    const user = auth.getUser(req);
    if (!user || !user.isAdmin) {
        error(res, user ? 403 : 401, user ? "forbidden" : "unauthorized",
            user ? "Kein Admin-Zugang." : "Nicht angemeldet.");
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

module.exports = { requireAdmin, requireCsrf };
