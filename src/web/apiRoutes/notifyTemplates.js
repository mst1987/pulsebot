// JSON API for the standalone "Anmelde-Aufruf" Notify-Templates page: create,
// edit and delete the message templates used by POST /api/raids/notify (see
// apiRoutes/raidDetail.js). Faithful JSON port of the SSR
// GET/POST /admin/raids/templates(/delete) routes in server.js.
const { ok, error } = require("../apiResponse");
const { withUser } = require("../apiHandler");
const { listNotify, saveNotify, deleteNotify } = require("../settingsStore");

/** GET /api/notify-templates — all Anmelde-Aufruf templates. */
const getNotifyTemplates = withUser({}, async ({ res }) => {
    ok(res, { templates: listNotify() });
});

/** POST /api/notify-templates — create/update a template. Body: { id?, name, title, body }. */
const saveNotifyTemplate = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    ok(res, { template: saveNotify(body) }, 201);
});

/** POST /api/notify-templates/delete — body: { id }. */
const deleteNotifyTemplate = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const id = String(body.id || "").trim();
    if (!id || !deleteNotify(id)) return error(res, 404, "not_found", "Vorlage nicht gefunden.");
    ok(res, { id });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/notify-templates", handler: getNotifyTemplates, area: "raids" },
    { method: "POST", path: "/api/notify-templates", handler: saveNotifyTemplate, area: "raids" },
    { method: "POST", path: "/api/notify-templates/delete", handler: deleteNotifyTemplate, area: "raids" },
];

module.exports = { getNotifyTemplates, saveNotifyTemplate, deleteNotifyTemplate, routes };
