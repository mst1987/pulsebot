// Serves the built React client (src/web-client/, built to dist/) from the site
// root in production. In dev the client runs on its own Vite dev server (see
// src/web-client/vite.config.ts) and never hits this module.
//
// Root, not a prefix: the menu is where members look up loot, and a link that
// reads /admin/history said "you are somewhere you should not be". Everything
// with a path of its own — /api, /auth, /health, the public /r/ report pages —
// is matched *before* this in server.js, which is what leaves the root free.
const fs = require("fs/promises");
const path = require("path");

const DIST_DIR = path.join(__dirname, "..", "web-client", "dist");

const CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".ico": "image/x-icon",
    ".png": "image/png",
};

async function readFromDist(relPath) {
    const filePath = path.join(DIST_DIR, relPath);
    if (!filePath.startsWith(DIST_DIR)) return null; // path traversal guard
    try {
        return await fs.readFile(filePath);
    } catch {
        return null;
    }
}

/**
 * Serves a request from the built SPA: a real file out of dist/ when the path
 * names one, else index.html so react-router can route it (including "/" and
 * every page path). Returns false for a non-GET and when dist/ isn't built.
 */
async function serve(req, res, pathname) {
    if (req.method !== "GET") return false;

    const rel = pathname.replace(/^\/+/, "");
    const ext = path.extname(rel);
    let data = rel ? await readFromDist(rel) : null;
    let contentType = CONTENT_TYPES[ext];

    // SPA fallback: no file for this path (a react-router route, or "/" itself)
    // -> index.html. A path the router doesn't know lands on the client's own
    // "not found" page (App.tsx), which is why this never 404s on a GET.
    if (!data) {
        data = await readFromDist("index.html");
        contentType = CONTENT_TYPES[".html"];
    }
    if (!data) return false; // dist/ not built yet

    res.writeHead(200, { "Content-Type": contentType || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
    return true;
}

module.exports = { serve };
