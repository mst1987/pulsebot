// JSON API for the standalone "Anmelde-Aufruf" Notify-Templates page: create,
// edit and delete the message templates used by POST /api/raids/notify (see
// apiRoutes/raidDetail.js). Faithful JSON port of the SSR
// GET/POST /admin/raids/templates(/delete) routes in server.js.
const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { listNotify, saveNotify, deleteNotify } = require("../settingsStore");

/** GET /api/notify-templates — all Anmelde-Aufruf templates. */
function getNotifyTemplates(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    ok(res, { templates: listNotify() });
}

/** POST /api/notify-templates — create/update a template. Body: { id?, name, title, body }. */
async function saveNotifyTemplate(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    ok(res, { template: saveNotify(body) }, 201);
}

/** POST /api/notify-templates/delete — body: { id }. */
async function deleteNotifyTemplate(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const id = String(body.id || "").trim();
    if (!id || !deleteNotify(id)) return error(res, 404, "not_found", "Vorlage nicht gefunden.");
    ok(res, { id });
}

module.exports = { getNotifyTemplates, saveNotifyTemplate, deleteNotifyTemplate };
