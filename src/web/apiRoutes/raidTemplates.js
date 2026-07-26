const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const {
    listRaidTemplates, saveRaidTemplate, saveRaidTemplates, deleteRaidTemplate,
} = require("../settingsStore");
const Raidhelper = require("../../classes/raidhelper");

/** GET /api/raid-templates — the manually curated Raid-Helper template list (feeds the create form). */
function getRaidTemplates(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    ok(res, { templates: listRaidTemplates() });
}

/** POST /api/raid-templates — add/update one by hand. Body: { id, name }. */
async function createRaidTemplate(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const saved = saveRaidTemplate({ id: body.id, name: body.name });
    if (!saved) return error(res, 400, "invalid", "Template-ID fehlt.");
    ok(res, saved, 201);
}

/** POST /api/raid-templates/delete — body: { id }. */
async function deleteRaidTemplateHandler(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const id = String(body.id || "").trim();
    if (!id || !deleteRaidTemplate(id)) return error(res, 404, "not_found", "Template nicht gefunden.");
    ok(res, { id });
}

/** POST /api/raid-templates/import — pull the distinct templates used by the server's current events. */
async function importRaidTemplates(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    try {
        const rh = new Raidhelper();
        const templates = await rh.getTemplates();
        if (!templates.length) return error(res, 400, "empty", "Keine Templates in den aktuellen Events gefunden.");
        const { added, updated } = saveRaidTemplates(templates);
        ok(res, { added, updated, templates: listRaidTemplates() });
    } catch (e) {
        error(res, 400, "import_failed", e.message || "Laden fehlgeschlagen.");
    }
}

module.exports = { getRaidTemplates, createRaidTemplate, deleteRaidTemplateHandler, importRaidTemplates };
