// Einstellungen → Kategorien → Details → „Setup & Planung“: the Orga-Zentrale
// of a raid category (services/events/orgaHub.js) — one Discord message per
// category in a channel only the orga sees. Gated like the raider's Raid-Zentrale
// (apiRoutes/availability.js panels): area `settings`.
//
// GET    /api/orga-hubs   area settings — the posted hubs, every category's orga links ({ [categoryId]: [{ label, url }] }) and maxLinks
// POST   /api/orga-hub    area settings — post (or move) a category's hub; body { categoryId, channelId }
// DELETE /api/orga-hub    area settings — take it down; body { categoryId }
// PUT    /api/orga-hub/links  area settings — replace them and redraw the hub; body { categoryId, links }
const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const orgaHubStore = require("../../stores/orgaHubStore");
const orgaHub = require("../../services/events/orgaHub");
const linkCheck = require("../../services/discord/linkCheck");
const { mayUseServer, mayUseChannel, OTHER_SERVER } = require("../http/serverQuery");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

function hubView(hub) {
    return {
        categoryId: hub.categoryId,
        channelId: hub.channelId,
        postedAt: hub.postedAt,
        url: linkCheck.messageLink(hub.guildId, hub.channelId, hub.messageId) || "",
    };
}

// Rights per server (#925, docs/permissions.md): a category is a Discord channel, so the bot's
// channel cache names its server. Everybody but a full admin sees and changes the hubs and links
// of the active server only; an unknown category (bot offline) counts as another server.
const onActiveServer = (user, req, categoryId) => mayUseChannel(user, req, str(categoryId));
const otherServer = (res) => apiError(res, 403, "other_server", OTHER_SERVER);

/** GET /api/orga-hubs — the posted hubs. */
const getHubs = withUser({}, async ({ user, req, res }) => {
    const hubs = orgaHubStore.listHubs().filter((h) => mayUseServer(user, req, h.guildId));
    const links = Object.fromEntries(Object.entries(orgaHubStore.listLinks()).filter(([categoryId]) => onActiveServer(user, req, categoryId)));
    ok(res, { hubs: hubs.map(hubView), links, maxLinks: orgaHubStore.MAX_LINKS });
});

/** POST /api/orga-hub — post (or move) a category's hub. */
const postHub = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    if (!onActiveServer(user, req, body.categoryId)) return otherServer(res);
    if (str(body.channelId) && !mayUseChannel(user, req, str(body.channelId))) return otherServer(res);
    const result = await orgaHub.postHub({ categoryId: body.categoryId, channelId: body.channelId, by: user.id });
    if (result.error) return apiError(res, 400, "bad_request", result.error);
    const view = hubView(result.hub);
    ok(res, { hub: { ...view, url: result.url || view.url } });
});

/** DELETE /api/orga-hub — take a category's hub down. */
const deleteHub = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const hub = orgaHubStore.listHubs().find((h) => h.categoryId === str(body.categoryId));
    if (hub && !mayUseServer(user, req, hub.guildId)) return apiError(res, 404, "not_found", "Für diese Kategorie ist keine Orga-Zentrale gepostet.");
    const removed = await orgaHub.removeHub(str(body.categoryId));
    if (!removed) return apiError(res, 404, "not_found", "Für diese Kategorie ist keine Orga-Zentrale gepostet.");
    ok(res, { categoryId: removed.categoryId });
});

/** PUT /api/orga-hub/links — replace the category's orga links and redraw its hub; body { categoryId, links }. */
const putLinks = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    if (!onActiveServer(user, req, body.categoryId)) return otherServer(res);
    const result = await orgaHub.saveLinks(str(body.categoryId), body.links);
    if (result.error) return apiError(res, 400, "bad_request", result.error);
    ok(res, { categoryId: str(body.categoryId), links: result.links });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/orga-hubs", handler: getHubs, area: "settings" },
    { method: "POST", path: "/api/orga-hub", handler: postHub, area: "settings" },
    { method: "DELETE", path: "/api/orga-hub", handler: deleteHub, area: "settings" },
    { method: "PUT", path: "/api/orga-hub/links", handler: putLinks, area: "settings" },
];

module.exports = { routes };
