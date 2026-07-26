// JSON response helpers for the /api/* layer (see apiRouter.js), analogous to the
// send()/redirect() helpers server.js uses for the classic SSR routes.

function sendJson(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(JSON.stringify(body));
}

function ok(res, data, status = 200) {
    sendJson(res, status, { data });
}

function apiError(res, status, code, message) {
    sendJson(res, status, { error: { code, message } });
}

module.exports = { sendJson, ok, error: apiError };
