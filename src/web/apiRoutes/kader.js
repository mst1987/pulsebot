// The Kaderbau export (docs/kaderbau.md): a read-only snapshot for the local
// roster-builder app a raid lead runs on their PC, plus the settings routes that
// mint and revoke the app's API tokens.
//
// GET /api/kader/export has no Discord session behind it: the app calls it
// server-to-server with `Authorization: Bearer ehk_…` (kaderTokenStore.js).
// apiAccess.js exempts it from the session gate (`auth: "token"`) and this
// handler does the whole auth itself, before any work. A loot-sync token
// (`ehl_`) is unknown to the Kaderbau store and is refused like any other.
const { ok, error } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const kaderTokens = require("../../stores/kaderTokenStore");
const { buildKaderExport, exportVersion } = require("../kader/kaderExport");

/** The token behind the request, or null after sending the 401. */
function requireKaderToken(req, res) {
    const raw = kaderTokens.bearerFrom(req);
    if (!raw) {
        error(res, 401, "no_token", "Kein API-Token übermittelt (Authorization: Bearer …).");
        return null;
    }
    const token = kaderTokens.verifyToken(raw);
    if (!token) {
        error(res, 401, "bad_token", "API-Token unbekannt oder zurückgezogen.");
        return null;
    }
    return token;
}

/** GET /api/kader/export?version=<id> — the snapshot; see docs/kaderbau.md for its shape. */
async function getKaderExport(req, res, url) {
    const token = requireKaderToken(req, res);
    if (!token) return;
    const query = url && url.searchParams ? url.searchParams : new URLSearchParams();
    const versionId = exportVersion(query.get("version"));
    if (!versionId) return error(res, 400, "unknown_version", "Unbekannte Spielversion.");
    touchKaderToken(token.id);
    ok(res, await buildKaderExport({ versionId }));
}

function touchKaderToken(id) {
    try {
        kaderTokens.touchToken(id);
    } catch (e) {
        // "zuletzt benutzt" is a convenience; the export must not fail over it.
        console.error("kader: token touch failed:", (e && e.message) || e);
    }
}

// ---- Kaderbau API tokens (Einstellungen → Verbindungen) ----
// Full-admin only, like the loot-sync tokens: a credential that bypasses the
// Discord login must not be mintable with mere write access to "Einstellungen".

/** GET /api/kader/tokens — the tokens, never their secrets. */
const getKaderTokens = withUser({ full: true }, async ({ res }) => {
    ok(res, { tokens: kaderTokens.listTokens() });
});

/** POST /api/kader/tokens — body: { name }. Returns the plaintext **once**. */
const createKaderTokenHandler = withUser({ full: true, csrf: true, body: true }, async ({ user, body, res }) => {
    const { token, record } = kaderTokens.createToken(body.name, user.name || user.id || "");
    ok(res, { token, record }, 201);
});

/** POST /api/kader/tokens/delete — body: { id }. Revokes immediately. */
const deleteKaderTokenHandler = withUser({ full: true, csrf: true, body: true }, async ({ body, res }) => {
    const id = String(body.id || "").trim();
    if (!id || !kaderTokens.revokeToken(id)) return error(res, 404, "not_found", "Token nicht gefunden.");
    ok(res, { id });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/kader/export", handler: getKaderExport, auth: "token" },
    { method: "GET", path: "/api/kader/tokens", handler: getKaderTokens, area: "settings" },
    { method: "POST", path: "/api/kader/tokens", handler: createKaderTokenHandler, area: "settings" },
    { method: "POST", path: "/api/kader/tokens/delete", handler: deleteKaderTokenHandler, area: "settings" },
];

module.exports = { getKaderExport, getKaderTokens, createKaderTokenHandler, deleteKaderTokenHandler, routes };
