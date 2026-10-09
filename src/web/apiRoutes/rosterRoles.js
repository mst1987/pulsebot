// The Discord roles of a roster (#656, docs/roster-profile.md "Roster und
// Discord-Rollen"): give or take one roster role, and the "Abgleich" tab's lists.
//
// Area `roster` (write for the POST, read for the GET) is the gate; on top a
// role change needs the right to manage that one roster - a full admin or one
// of its managers (rosterAccess.canManageRosterLive), else 403 "not_manager".
// Errors answer with a code the client translates (DE/EN).
const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const rosterStore = require("../../stores/rosterStore");
const { getConfig } = require("../../stores/settingsStore");
const { canManageRosterLive } = require("../../services/roster/rosterAccess");
const { applyRoleChange } = require("../../services/roster/rosterRoleSync");
const { rosterSyncView } = require("../../services/roster/rosterSyncView");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const validUserId = (v) => /^\d{5,25}$/.test(str(v));

// A refused role write and its HTTP status: the bot's state is a conflict, not the caller's fault.
const STATUS_OF_CODE = { bad_request: 400, not_roster_role: 400, offline: 503, unknown_role: 404, not_member: 404 };

/**
 * POST /api/rosters/roles — give or take one role of a roster.
 * Body: { rosterId, userId, give: boolean, roleId? } (roleId: one of the roster's
 * roleIds or its trialRoleId; default the main role roleIds[0]).
 * Membership follows from Discord: taking someone's last roster role drops
 * them from the roster, giving it to a non-member takes them in (rosterRoleSync).
 */
const postRosterRole = withUser({ write: "roster", csrf: true, body: true }, async ({ user, body, res }) => {
    const roster = rosterStore.getRoster(str(body.rosterId));
    if (!roster) return apiError(res, 404, "not_found", "Roster nicht gefunden.");
    if (!(await canManageRosterLive(user, roster))) return apiError(res, 403, "not_manager", "Nur Admins und die Manager dieses Rosters ändern Rollen.");
    if (!validUserId(body.userId)) return apiError(res, 400, "bad_request", "Kein gültiges Discord-Konto angegeben.");
    if (typeof body.give !== "boolean") return apiError(res, 400, "bad_request", "give fehlt (true/false).");
    const roleId = str(body.roleId) || roster.roleIds[0] || "";
    if (!roleId) return apiError(res, 400, "no_role", "Das Roster hat keine Discord-Rolle.");
    if (!roster.roleIds.includes(roleId) && roleId !== roster.trialRoleId) {
        return apiError(res, 400, "not_roster_role", "Diese Rolle gehört nicht zu diesem Roster.");
    }
    if (!roster.guildId) return apiError(res, 409, "no_guild", "Das Roster hat keinen Discord-Server.");
    const result = await applyRoleChange(roster, str(body.userId), roleId, body.give, { actor: str(user.id) });
    if (!result.ok) return apiError(res, STATUS_OF_CODE[result.code] || 409, result.code, "Die Rolle konnte nicht geändert werden.");
    return ok(res, { result });
});

/**
 * GET /api/rosters/sync?id=<rosterId> — the four lists of the Abgleich tab
 * (services/roster/rosterSyncView.js), the roster's roles, whether the bot may
 * manage roles there, the role-sync mirrors, and whether the caller may act.
 */
const getRosterSync = withUser({}, async ({ user, query, res }) => {
    const roster = rosterStore.getRoster(str(query.get("id")));
    if (!roster) return apiError(res, 404, "not_found", "Roster nicht gefunden.");
    const [view, canManage] = await Promise.all([
        rosterSyncView(roster, { config: getConfig() }),
        canManageRosterLive(user, roster),
    ]);
    return ok(res, { ...view, canManage });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "POST", path: "/api/rosters/roles", handler: postRosterRole, area: "roster" },
    { method: "GET", path: "/api/rosters/sync", handler: getRosterSync, area: "roster" },
];

module.exports = { postRosterRole, getRosterSync, routes, STATUS_OF_CODE };
