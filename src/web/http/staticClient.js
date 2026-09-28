// Serves the built React client (src/web-client/, built to dist/) from the site
// root in production. In dev the client runs on its own Vite dev server (see
// src/web-client/vite.config.ts) and never hits this module.
//
// Root, not a prefix: the menu is where members look up loot, and a link that
// reads /admin/history said "you are somewhere you should not be". Everything
// with a path of its own — /api, /auth, /health, the public /r/ report pages —
// is matched *before* this in server.js, which is what leaves the root free.
//
// Files vs. pages (#530): only a path WITHOUT a file extension is a page and
// falls back to index.html. A missing file — a chunk of the previous build that
// an open tab still asks for after a deploy — is a plain 404. Answering it with
// index.html made the browser refuse the "text/html" module script and left the
// page blank; on the 404 the client reloads itself once instead
// (src/web-client/src/lib/chunkReload.ts).
const fs = require("fs/promises");
const path = require("path");

const DIST_DIR = path.join(__dirname, "..", "..", "web-client", "dist");

const CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
};

// index.html names the chunks of the current build, so the browser must ask
// again on every load; the files under assets/ carry their content hash in the
// name and never change, so a browser may keep them for good.
const NO_CACHE = "no-cache";
const IMMUTABLE = "public, max-age=31536000, immutable";

async function readFromDist(relPath) {
    const filePath = path.join(DIST_DIR, relPath);
    // path traversal guard: only what lies below DIST_DIR (not a sibling like dist-old/)
    if (!filePath.startsWith(DIST_DIR + path.sep)) return null;
    try {
        return await fs.readFile(filePath);
    } catch {
        return null;
    }
}

/** True for a path that names a file (it has an extension), false for a page path. */
function isFilePath(rel) {
    return path.posix.extname(rel) !== "";
}

/** Hashed build output under assets/ is immutable; everything else is revalidated. */
function cacheControlFor(rel) {
    return rel.startsWith("assets/") ? IMMUTABLE : NO_CACHE;
}

function reply(req, res, status, headers, body) {
    res.writeHead(status, headers);
    res.end(req.method === "HEAD" ? undefined : body);
}

/**
 * Serves a request from the built SPA: a real file out of dist/ when the path
 * names one, index.html for a page path (no extension) so react-router can
 * route it (including "/"), a 404 for a file that is not there. HEAD gets the
 * same headers without a body. Returns false for any other method and when
 * dist/ isn't built.
 */
async function serve(req, res, pathname) {
    if (req.method !== "GET" && req.method !== "HEAD") return false;

    const rel = pathname.replace(/^\/+/, "");
    if (rel && rel !== "index.html") {
        const data = await readFromDist(rel);
        if (data) {
            const contentType = CONTENT_TYPES[path.extname(rel).toLowerCase()] || "application/octet-stream";
            reply(req, res, 200, { "Content-Type": contentType, "Cache-Control": cacheControlFor(rel) }, data);
            return true;
        }
        if (isFilePath(rel)) {
            // Not cached either: the file may exist after the next deploy.
            reply(req, res, 404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": NO_CACHE }, "Not found");
            return true;
        }
    }

    // SPA fallback: a page path (a react-router route, or "/" itself) ->
    // index.html. A path the router doesn't know lands on the client's own
    // "not found" page (App.tsx), which is why a page path never 404s here.
    const index = await readFromDist("index.html");
    if (!index) return false; // dist/ not built yet
    reply(req, res, 200, { "Content-Type": CONTENT_TYPES[".html"], "Cache-Control": NO_CACHE }, index);
    return true;
}

module.exports = { serve, isFilePath, cacheControlFor };
