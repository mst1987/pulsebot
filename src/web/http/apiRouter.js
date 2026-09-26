// JSON API layer for the React admin client (src/web-client/), the sole admin
// UI (see docs/web-admin.md). Mounted under /api/* by server.js's handle().
//
// The routes themselves live with their handlers: every apiRoutes/*.js exports
// a `routes` table, routeTable.js collects them, and this module only looks a
// request up in that table and calls the handler. The same table tells
// apiAccess.js which area gates the path, so there is one list, not two.
const { error } = require("./apiResponse");
const { AppError } = require("./apiResult");
const auth = require("./auth");
const { checkAccess } = require("./apiAccess");
const { find, methodsFor } = require("./routeTable");

/**
 * Dispatches an /api/* request, turning any escaping exception into a JSON error.
 *
 * Without this the failure bubbles up to server.js's catch-all, which answers
 * with the plain-text body "error" — the client then chokes on `res.json()` with
 * a bare "Unexpected token" and the real cause stays invisible. The long-running
 * routes (CLA/RPB evaluation) are the likeliest source of such errors, so they
 * are exactly the ones that need a readable message. An AppError (apiResult.js)
 * is a handler's own answer, sent with its status and code.
 *
 * Every request first passes the area gate (apiAccess.js), so a handler never
 * has to know which permission its endpoint needs. A known path called with a
 * method it has no handler for answers 405 (with the methods it does have), an
 * unknown path 404.
 */
async function handle(pathname, req, res, url) {
    try {
        const denied = checkAccess(pathname, req.method, auth.getUser(req));
        if (denied) {
            error(res, denied.status, denied.code, denied.message);
            return true;
        }
        const route = find(req.method, pathname);
        if (!route) {
            const allowed = methodsFor(pathname);
            if (allowed.length) {
                error(res, 405, "method_not_allowed", `Methode ${req.method} ist hier nicht erlaubt (${allowed.join(", ")}).`, { Allow: allowed.join(", ") });
            } else {
                error(res, 404, "not_found", "Unbekannter API-Endpunkt.");
            }
            return true;
        }
        await route.handler(req, res, url);
        return true;
    } catch (e) {
        if (e instanceof AppError) {
            if (!res.headersSent) error(res, e.status, e.code, e.message);
            return true;
        }
        console.error(`API ${req.method} ${pathname} failed:`, (e && e.stack) || e);
        if (!res.headersSent) {
            error(res, 500, "internal_error", (e && e.message) || "Unerwarteter Serverfehler.");
        }
        return true;
    }
}

module.exports = { handle };
