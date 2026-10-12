// Einstellungen → Kategorien → Details → „Setup & Planung“: the Orga-Zentrale
// of a raid category (services/events/orgaHub.js) — one Discord message per
// category in a channel only the orga sees. Gated like the raider's Raid-Zentrale
// (apiRoutes/availability.js panels): area `settings`.
//
// GET    /api/orga-hubs   area settings — the posted hubs
// POST   /api/orga-hub    area settings — post (or move) a category's hub; body { categoryId, channelId }
// DELETE /api/orga-hub    area settings — take it down; body { categoryId }
const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const orgaHubStore = require("../../stores/orgaHubStore");
const orgaHub = require("../../services/events/orgaHub");
const linkCheck = require("../../services/discord/linkCheck");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

function hubView(hub) {
    return {
        categoryId: hub.categoryId,
        channelId: hub.channelId,
        postedAt: hub.postedAt,
        url: linkCheck.messageLink(hub.guildId, hub.channelId, hub.messageId) || "",
    };
}

/** GET /api/orga-hubs — the posted hubs. */
const getHubs = withUser({}, async ({ res }) => {
    ok(res, { hubs: orgaHubStore.listHubs().map(hubView) });
});

/** POST /api/orga-hub — post (or move) a category's hub. */
const postHub = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    const result = await orgaHub.postHub({ categoryId: body.categoryId, channelId: body.channelId, by: user.id });
    if (result.error) return apiError(res, 400, "bad_request", result.error);
    const view = hubView(result.hub);
    ok(res, { hub: { ...view, url: result.url || view.url } });
});

/** DELETE /api/orga-hub — take a category's hub down. */
const deleteHub = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const removed = await orgaHub.removeHub(str(body.categoryId));
    if (!removed) return apiError(res, 404, "not_found", "Für diese Kategorie ist keine Orga-Zentrale gepostet.");
    ok(res, { categoryId: removed.categoryId });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/orga-hubs", handler: getHubs, area: "settings" },
    { method: "POST", path: "/api/orga-hub", handler: postHub, area: "settings" },
    { method: "DELETE", path: "/api/orga-hub", handler: deleteHub, area: "settings" },
];

module.exports = { routes };
