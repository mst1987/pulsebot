// The preamble every session-authenticated /api/* handler used to spell out by
// hand — "who is calling, may they write, is the CSRF token there, what is in
// the body" — as one wrapper, so a handler starts with its own work.
//
//   const putThing = withUser({ write: "raids", csrf: true, body: true }, async ({ user, body, res }) => { … });
//
// The wrapped function keeps the router's `(req, res, url)` signature, so the
// route table and direct calls in tests see no difference. The checks run in
// the order the handlers always ran them: menu user (or full admin), write
// right on an area, CSRF, then the JSON body. Each refusal is sent by the
// middleware it always came from (apiMiddleware.js), the answer formats are
// unchanged. The area gate itself (apiAccess.js) still runs before any of this
// in apiRouter.handle(); `write` only guards a handler that is called directly
// or a GET that prepares an action.
const { requireAdmin, requireFullAdmin, requireCsrf } = require("./apiMiddleware");
const { readJsonBody } = require("./apiBody");
const { error } = require("./apiResponse");
const { AREAS, userCan } = require("../../config/permissions");

const LABELS = Object.fromEntries(AREAS.map((a) => [a.id, a.label]));

/**
 * @param {object} opts
 * @param {boolean} [opts.full]   only a full admin (requireFullAdmin) — the access settings and the foreign credentials
 * @param {string}  [opts.write]  the area the caller needs at write level (403 otherwise)
 * @param {boolean} [opts.csrf]   check the X-CSRF-Token header (every mutating call)
 * @param {boolean} [opts.body]   parse the JSON body (always an object; `{}` when empty or invalid)
 * @param {(ctx: { user, body, query, url, req, res }) => any} fn the handler
 */
function withUser(opts, fn) {
    if (typeof opts === "function") { fn = opts; opts = {}; }
    const { full = false, write = "", csrf = false, body = false } = opts || {};
    return async function handler(req, res, url) {
        const user = full ? requireFullAdmin(req, res) : requireAdmin(req, res);
        if (!user) return undefined;
        if (write && !userCan(user, write, "write")) {
            error(res, 403, "forbidden", `Keine Schreibrechte für „${LABELS[write] || write}“.`);
            return undefined;
        }
        if (csrf && !requireCsrf(req, res)) return undefined;
        const parsed = body ? ((await readJsonBody(req)) || {}) : undefined;
        return fn({
            user,
            body: parsed,
            query: url && url.searchParams ? url.searchParams : new URLSearchParams(),
            url,
            req,
            res,
        });
    };
}

module.exports = { withUser };
