// JSON API layer for the React admin client (src/web-client/), built up alongside
// the existing SSR routes in server.js — see CLAUDE.md / the migration plan for
// context. Mounted under /api/* by server.js's handle().
const auth = require("./auth");
const { ok, error } = require("./apiResponse");

/** GET /api/session — who the caller is (if anyone), plus their CSRF token. */
function getSession(req, res) {
    const user = auth.getUser(req);
    ok(res, {
        user: user ? { id: user.id, name: user.name, isAdmin: !!user.isAdmin } : null,
        csrfToken: user ? auth.csrfToken(req) : null,
    });
}

/** Dispatches an /api/* request. Returns true if handled, false to fall through. */
async function handle(pathname, req, res) {
    if (pathname === "/api/session" && req.method === "GET") {
        getSession(req, res);
        return true;
    }
    error(res, 404, "not_found", "Unbekannter API-Endpunkt.");
    return true;
}

module.exports = { handle };
