// "Mein Profil › Meine Infos › Sync-App" (#1000, epic #999): a person's own keys for the sync app.
//
// A personal key belongs to its owner (the Discord id) and counts for every server the owner is
// orga of right now (services/discord/ingestServers.js). Only the orga sees the section: a raider
// without an orga role, a managed category or full admin rights gets `allowed: false` and cannot
// mint one (403 `orga_only`). Revoking: one's own keys, or any personal key as a full admin. The
// plaintext comes back once, at creation, and is never stored (stores/ingestTokenStore.js).
// The old server keys stay in Einstellungen › Verbindungen and never show here.
const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const tokens = require("../../stores/ingestTokenStore");
const { orgaServersOf, describeServers } = require("../../services/discord/ingestServers");
const { userIsOrga } = require("../../config/permissions");

// One key per device: a handful is plenty, and a cap keeps a stuck client from filling the store.
const MAX_KEYS = 10;
const NAME_MAX = 60;
const ORGA_ONLY = "Nur wer auf einem Server Orga ist, kann Schlüssel für die Sync-App anlegen.";

/**
 * The servers the caller is orga of. In "Ansicht als Raider" (viewAs) the viewed rights count: a
 * view without orga sees no section, like the raider it shows.
 */
async function serversFor(user) {
    if (user.viewAs && !userIsOrga(user)) return [];
    return orgaServersOf(user.id);
}

const keyView = (t) => ({
    id: t.id, name: t.name, hint: t.hint, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, uses: t.uses,
});

async function payload(user) {
    const servers = await serversFor(user);
    if (!servers.length) return { allowed: false, servers: [], keys: [], max: MAX_KEYS };
    return {
        allowed: true,
        servers: describeServers(servers).map(({ guildId, name, label, role }) => ({ guildId, name, label, role })),
        keys: tokens.listTokensOfOwner(user.id).map(keyView),
        max: MAX_KEYS,
    };
}

/** GET /api/profile/sync-keys — the caller's own keys (never their secrets) and the servers they count for. */
const getSyncKeys = withUser({}, async ({ user, res }) => {
    ok(res, await payload(user));
});

/** POST /api/profile/sync-keys — body: { name } (the device). The plaintext comes back once, in `token`. */
const createSyncKey = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    const servers = await serversFor(user);
    if (!servers.length) return apiError(res, 403, "orga_only", ORGA_ONLY);
    const name = String(body.name || "").trim().slice(0, NAME_MAX);
    if (!name) return apiError(res, 400, "invalid", "Gib dem Gerät einen Namen.");
    if (tokens.listTokensOfOwner(user.id).length >= MAX_KEYS) {
        return apiError(res, 400, "too_many", `Höchstens ${MAX_KEYS} Schlüssel - widerrufe zuerst einen alten.`);
    }
    const { token, record } = tokens.createPersonToken(name, user.id, user.name || user.id);
    ok(res, { token, record: keyView(record), ...(await payload(user)) }, 201);
});

/**
 * POST /api/profile/sync-keys/delete — body: { id }. One's own personal key, or any personal key as
 * a full admin; a foreign or unknown id answers 404 alike, so ids cannot be probed. A server key is
 * no business of this route (Einstellungen).
 */
const deleteSyncKey = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    const id = String(body.id || "").trim();
    const record = id ? tokens.getToken(id) : null;
    const mayRevoke = record && record.ownerId && (record.ownerId === String(user.id) || user.isAdmin === true);
    if (!mayRevoke || !tokens.revokeToken(id)) return apiError(res, 404, "not_found", "Schlüssel nicht gefunden.");
    ok(res, { id, ...(await payload(user)) });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/profile/sync-keys", handler: getSyncKeys, area: "signup", scope: "all" },
    { method: "POST", path: "/api/profile/sync-keys", handler: createSyncKey, area: "signup", scope: "all" },
    { method: "POST", path: "/api/profile/sync-keys/delete", handler: deleteSyncKey, area: "signup", scope: "all" },
];

module.exports = { getSyncKeys, createSyncKey, deleteSyncKey, MAX_KEYS, routes };
