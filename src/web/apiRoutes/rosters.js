// The raid rosters (#654, docs/roster-profile.md "Roster-Seiten"): the overview's
// cards and one roster with its members, read only. Area `roster` (read); the
// views are built by web/roster/rosterView.js. Editing members, roles and
// settings comes with #655-#657.
const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const { q } = require("../http/apiParams");
const { getConfig } = require("../../stores/settingsStore");
const { buildRosterOverview, buildRosterDetail } = require("../roster/rosterView");

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

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/rosters", handler: getRosters, area: "roster" },
    { method: "GET", path: "/api/rosters/roster", handler: getRosterDetail, area: "roster" },
];

module.exports = { getRosters, getRosterDetail, routes };
