// The log-check pages' stylesheet and client script, served from src/web/static/
// as /r-assets/<file> (#423). They used to be inlined into every page — some
// 70 kB of CSS and JS per request, and JS nobody could lint or test.
//
// Only the files named in FILES are served: the name is looked up, never joined
// onto a path, so "..", an encoded slash or any other file under static/ never
// reaches the disk. The page links each file with ?v=<hash of its content>
// (assetUrl), so a browser may keep that url for a year and still sees every
// change at once — a changed file is a new url. A request with another or no
// version gets the current file with no-cache instead.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STATIC_DIR = path.join(__dirname, "..", "static");
const PREFIX = "/r-assets/";

const FILES = {
    "report.css": "text/css; charset=utf-8",
    "report.js": "text/javascript; charset=utf-8",
};

// name -> { mtimeMs, body, hash }; re-read when the file changed on disk, so a
// running dev instance picks up an edit without a restart
const cache = new Map();

function load(name) {
    const file = path.join(STATIC_DIR, name);
    const { mtimeMs } = fs.statSync(file);
    const hit = cache.get(name);
    if (hit && hit.mtimeMs === mtimeMs) return hit;
    const body = fs.readFileSync(file);
    const entry = { mtimeMs, body, hash: crypto.createHash("sha256").update(body).digest("hex").slice(0, 12) };
    cache.set(name, entry);
    return entry;
}

/** The url a page links an asset under: /r-assets/<name>?v=<content hash>. */
function assetUrl(name) {
    if (!Object.prototype.hasOwnProperty.call(FILES, name)) throw new Error(`unknown report asset: ${name}`);
    return `${PREFIX}${name}?v=${load(name).hash}`;
}

/**
 * Answers GET /r-assets/<name>. Returns false for a name that is not one of
 * FILES (the caller answers 404), true once the file was sent.
 * @param {string} pathname  the decoded path, starting with /r-assets/
 * @param {URL} url          the request url, for the ?v= version
 * @param {object} res       the http response
 */
function serveAsset(pathname, url, res) {
    const name = pathname.slice(PREFIX.length);
    if (!Object.prototype.hasOwnProperty.call(FILES, name)) return false;
    const { body, hash } = load(name);
    const current = url && url.searchParams && url.searchParams.get("v") === hash;
    res.writeHead(200, {
        "Content-Type": FILES[name],
        "Cache-Control": current ? "public, max-age=31536000, immutable" : "no-cache",
        "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
    return true;
}

module.exports = { assetUrl, serveAsset, PREFIX, FILES };
