// "Mein Profil › Meine Infos › Sync-App" (#1000, epic #999): a person's own keys for the sync app.
//
// A personal key belongs to its owner (the Discord id) and counts for every server the owner is
// orga of right now (services/discord/ingestServers.js). Only the orga mints keys: a raider without
// an orga role, a managed category or full admin rights gets `allowed: false` (403 `orga_only`).
// One's own keys always show and can be revoked, also once the person is orga nowhere any more (they
// then count for no server). Revoking: one's own keys, or any personal key as a full admin. The
// plaintext comes back once, at creation, and is never stored (stores/ingestTokenStore.js).
// The servers come from the rights the session already holds (auth.sessionGuildAccess), never from
// a fresh member lookup per page view (docs/known-issues.md: member lookups without a time limit).
// The old server keys stay in Einstellungen › Verbindungen and never show here.
const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { sessionGuildAccess } = require("../http/auth");
const tokens = require("../../stores/ingestTokenStore");
const { orgaServersOf, describeServers } = require("../../services/discord/ingestServers");
const { userIsOrga } = require("../../config/permissions");

// One key per device: a handful is plenty, and a cap keeps a stuck client from filling the store.
const MAX_KEYS = 10;
const NAME_MAX = 60;
const ORGA_ONLY = "Nur wer auf einem Server Orga ist, kann Schlüssel für die Sync-App anlegen.";

/**
 * The servers the caller is orga of, from the session's rights. In "Ansicht als Raider" (viewAs)
 * the viewed role counts, not the person: a view without orga sees no section, like the raider it shows.
 */
async function serversFor(user, req) {
    if (user.viewAs && !userIsOrga(user)) return [];
    return orgaServersOf(user.id, { guildAccess: sessionGuildAccess(req) || { isAdmin: !!user.isAdmin, guilds: {} } });
}

const keyView = (t) => ({
    id: t.id, name: t.name, hint: t.hint, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, uses: t.uses,
});

/**
 * `allowed`: may mint keys (orga somewhere); `keys`: one's own, always - a view as a role without
 * orga shows none, like the raider it shows.
 */
async function payload(user, req) {
    const servers = await serversFor(user, req);
    const viewOnly = user.viewAs && !servers.length;
    return {
        allowed: servers.length > 0,
        servers: describeServers(servers).map(({ guildId, name, label, role }) => ({ guildId, name, label, role })),
        keys: viewOnly ? [] : tokens.listTokensOfOwner(user.id).map(keyView),
        max: MAX_KEYS,
    };
}

/** GET /api/profile/sync-keys — the caller's own keys (never their secrets) and the servers they count for. */
const getSyncKeys = withUser({}, async ({ user, req, res }) => {
    ok(res, await payload(user, req));
});

/** POST /api/profile/sync-keys — body: { name } (the device). The plaintext comes back once, in `token`. */
const createSyncKey = withUser({ csrf: true, body: true }, async ({ user, body, req, res }) => {
    const servers = await serversFor(user, req);
    if (!servers.length) return apiError(res, 403, "orga_only", ORGA_ONLY);
    const name = String(body.name || "").trim().slice(0, NAME_MAX);
    if (!name) return apiError(res, 400, "invalid", "Gib dem Gerät einen Namen.");
    if (tokens.listTokensOfOwner(user.id).length >= MAX_KEYS) {
        return apiError(res, 400, "too_many", `Höchstens ${MAX_KEYS} Schlüssel - widerrufe zuerst einen alten.`);
    }
    const { token, record } = tokens.createPersonToken(name, user.id, user.name || user.id);
    ok(res, { token, record: keyView(record), ...(await payload(user, req)) }, 201);
});

/**
 * POST /api/profile/sync-keys/delete — body: { id }. One's own personal key, or any personal key as
 * a full admin; a foreign or unknown id answers 404 alike, so ids cannot be probed. A server key is
 * no business of this route (Einstellungen).
 */
const deleteSyncKey = withUser({ csrf: true, body: true }, async ({ user, body, req, res }) => {
    const id = String(body.id || "").trim();
    const record = id ? tokens.getToken(id) : null;
    const mayRevoke = record && record.ownerId && (record.ownerId === String(user.id) || user.isAdmin === true);
    if (!mayRevoke || !tokens.revokeToken(id)) return apiError(res, 404, "not_found", "Schlüssel nicht gefunden.");
    ok(res, { id, ...(await payload(user, req)) });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/profile/sync-keys", handler: getSyncKeys, area: "signup", scope: "all" },
    { method: "POST", path: "/api/profile/sync-keys", handler: createSyncKey, area: "signup", scope: "all" },
    { method: "POST", path: "/api/profile/sync-keys/delete", handler: deleteSyncKey, area: "signup", scope: "all" },
];

module.exports = { getSyncKeys, createSyncKey, deleteSyncKey, MAX_KEYS, routes };
