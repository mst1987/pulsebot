// The raid rosters (#654, docs/roster-profile.md "Roster-Seiten"): the overview's
// cards, one roster with its members, and a roster's history (#655). Area
// `roster` (read); the views are built by web/roster/rosterView.js and
// web/roster/rosterHistoryView.js. The writes are rosterMembers.js,
// rosterRoles.js and rosterAdmin.js.
const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const { q } = require("../http/apiParams");
const { getConfig } = require("../../stores/settingsStore");
const { buildRosterOverview, buildRosterDetail } = require("../roster/rosterView");
const { buildRosterHistory } = require("../roster/rosterHistoryView");
const { activeRoster } = require("../roster/activeRoster");

/** GET /api/rosters — one card per roster of the active server, the categories without one, `canCreate`. */
const getRosters = withUser({}, async ({ req, res, user }) => {
    ok(res, await buildRosterOverview({ guildId: activeGuildFor(req), user, config: getConfig() }));
});

/** GET /api/rosters/roster?id=<rosterId> — one roster's head and members, `canManage`. */
const getRosterDetail = withUser({}, async ({ req, res, user, query }) => {
    const id = q.str(query, "id", { max: 64 });
    if (!id) return apiError(res, 400, "bad_request", "Kein Roster angegeben.");
    const view = await buildRosterDetail({ guildId: activeGuildFor(req), id, user, config: getConfig() });
    if (!view) return apiError(res, 404, "not_found", "Roster nicht gefunden.");
    return ok(res, view);
});

/**
 * GET /api/rosters/history?id=<rosterId>[&userId=<id>][&offset=<n>][&limit=<n>] - the
 * roster's history newest first, a page at a time (default 50, at most 200),
 * only the lines about `userId` when given: { entries, total, offset, limit }.
 * 404 for an unknown roster or one of another server.
 */
const getRosterHistory = withUser({}, async ({ req, res, query }) => {
    const id = q.str(query, "id", { max: 64 });
    if (!id) return apiError(res, 400, "bad_request", "Kein Roster angegeben.");
    const roster = activeRoster(req, id);
    if (!roster) return apiError(res, 404, "not_found", "Roster nicht gefunden.");
    return ok(res, await buildRosterHistory(roster, {
        userId: q.str(query, "userId", { max: 32 }),
        offset: query.get("offset"),
        limit: query.get("limit"),
    }));
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/rosters", handler: getRosters, area: "roster" },
    { method: "GET", path: "/api/rosters/roster", handler: getRosterDetail, area: "roster" },
    { method: "GET", path: "/api/rosters/history", handler: getRosterHistory, area: "roster" },
];

module.exports = { getRosters, getRosterDetail, getRosterHistory, routes };
