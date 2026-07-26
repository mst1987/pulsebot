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

module.exports = { requireAdmin };
