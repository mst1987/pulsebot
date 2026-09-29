// JSON response helpers for the /api/* layer (see apiRouter.js), analogous to the
// send()/redirect() helpers server.js uses for the classic SSR routes.
const crypto = require("crypto");

function sendJson(res, status, body, headers) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache", ...(headers || {}) });
    res.end(JSON.stringify(body));
}

function ok(res, data, status = 200) {
    sendJson(res, status, { data });
}

/** `{ error: { code, message } }` — the one error shape the client parses (web-client/src/api.ts). `headers` adds to the response (a 405's Allow). */
function apiError(res, status, code, message, headers) {
    sendJson(res, status, { error: { code, message } }, headers);
}

/** The entity tag of a JSON text: a short hash of exactly what would be sent (strong, quoted). */
function etagOf(text) {
    return `"${crypto.createHash("sha1").update(text).digest("base64url").slice(0, 27)}"`;
}

/** Whether an If-None-Match header names `tag` (a list, "*", and a proxy's weak "W/" form all count). */
function matchesEtag(header, tag) {
    const sent = String(header || "").trim();
    if (!sent) return false;
    if (sent === "*") return true;
    return sent.split(",").some((s) => s.trim().replace(/^W\//, "") === tag);
}

/**
 * `ok()` with an ETag for a payload a page polls (the raid plan's read view, #555): the answer carries a hash of its
 * body, and a request whose If-None-Match names that hash gets a bare 304 - the payload is still built, but nothing
 * is sent and the page has nothing to parse or redraw.
 */
function okWithEtag(req, res, data) {
    const text = JSON.stringify({ data });
    const tag = etagOf(text);
    if (matchesEtag(req && req.headers ? req.headers["if-none-match"] : "", tag)) {
        res.writeHead(304, { "Cache-Control": "no-cache", ETag: tag });
        res.end();
        return;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache", ETag: tag });
    res.end(text);
}

module.exports = { sendJson, ok, okWithEtag, etagOf, matchesEtag, error: apiError };
