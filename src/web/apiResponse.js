// JSON response helpers for the /api/* layer (see apiRouter.js), analogous to the
// send()/redirect() helpers server.js uses for the classic SSR routes.

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

module.exports = { sendJson, ok, error: apiError };
