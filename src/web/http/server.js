// The web server: plain HTTP, nothing else (#424). Which path answers what is
// the business of pageRoutes.js (the pages the server owns) and routeTable.js
// (/api/*); the background jobs start in jobs.js.
const http = require("http");
const { webPort } = require("../../config/variables");
const { renderNotFound } = require("../report/render");
const discord = require("../discord");
const staticClient = require("./staticClient");
const { findPageRoute, send } = require("./pageRoutes");

/**
 * One request: the first entry of pageRoutes.js that fits method and path
 * answers. Nothing fits: any method but GET is a 405; a GET is the client —
 * "/" and every page path below it. Who may see what is decided in the client
 * and, for real, by /api/* (apiAccess.js); an unknown path lands on the
 * client's own "not found" page.
 */
async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    let pathname = "/";
    try { pathname = decodeURIComponent(url.pathname); } catch { pathname = "/"; }

    const hit = findPageRoute(req.method, pathname);
    if (hit) return hit.route.handler({ req, res, url, pathname, params: hit.params, rest: hit.rest });
    if (req.method !== "GET") return send(res, 405, renderNotFound());
    if (await staticClient.serve(req, res, pathname)) return undefined;
    // Only reached when dist/ was never built — see docs/web-admin.md.
    return send(res, 404, renderNotFound());
}

let server = null;

/**
 * Start the web server (idempotent). Pass the bot client for role lookups.
 * Only HTTP: the background jobs start in jobs.js (#424).
 */
function startWebServer(client) {
    if (client) discord.setClient(client);
    if (server) return server;
    server = http.createServer((req, res) => {
        Promise.resolve(handle(req, res)).catch((err) => {
            console.error("Logcheck web server handler error:", (err && err.stack) || err);
            try {
                if (res.headersSent) return;
                // /api/* callers parse the body as JSON — answering with plain text
                // here would surface as a bare "Unexpected token" in the admin UI
                // instead of the actual failure.
                if ((req.url || "").startsWith("/api/")) {
                    const message = (err && err.message) || "Unerwarteter Serverfehler.";
                    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ error: { code: "internal_error", message } }));
                } else {
                    res.writeHead(500);
                    res.end("error");
                }
            } catch { /* already sent */ }
        });
    });
    server.on("error", (err) => {
        console.error("Logcheck web server error:", err.message);
    });
    server.listen(webPort, () => {
        console.log(`Logcheck web server listening on port ${webPort}`);
    });
    return server;
}

module.exports = { startWebServer };
