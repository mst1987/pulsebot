// Serves the built React admin client (src/web-client/, built to dist/) under
// /admin2/* in production. In dev the client runs on its own Vite dev server
// (see src/web-client/vite.config.ts) and never hits this module.
const fs = require("fs/promises");
const path = require("path");

const PREFIX = "/admin2";
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

/** Serves a request under /admin2/* from the built SPA. Returns true if handled. */
async function serve(req, res, pathname) {
    if (req.method !== "GET" || (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`))) return false;

    const rel = pathname.slice(PREFIX.length).replace(/^\/+/, "");
    const ext = path.extname(rel);
    let data = rel ? await readFromDist(rel) : null;
    let contentType = CONTENT_TYPES[ext];

    // SPA fallback: no file for this path (a react-router route, or "/admin2" itself) -> index.html.
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
