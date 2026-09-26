const { ok, error } = require("../apiResponse");
const { withUser } = require("../apiHandler");
const {
    listRaidTemplates, getRaidTemplate, saveRaidTemplate, saveRaidTemplates, deleteRaidTemplate, getConfig,
} = require("../../stores/settingsStore");
const { decorateTemplate } = require("../raidTemplates");
const discord = require("../discord");
const { activeGuildFor } = require("../activeGuild");
const { createRaidhelperClient } = require("../../utils/raidhelper/client");

/** Every template as the list shows it, with its badges and the categories using it as default. */
function decoratedTemplates() {
    const defaults = getConfig().categoryRaidTemplate || {};
    return listRaidTemplates().map((t) => decorateTemplate(t, defaults));
}

/** The Discord category names, so "Standard für …" reads as names. Best-effort: offline = {}. */
function categoryNames(req) {
    try {
        const list = discord.listCategories(activeGuildFor(req)) || [];
        return Object.fromEntries(list.map((c) => [c.id, c.name]));
    } catch {
        return {};
    }
}

/** GET /api/raid-templates — the raid templates (#266) with their badges. */
const getRaidTemplates = withUser({}, async ({ req, res }) => {
    ok(res, { templates: decoratedTemplates(), categoryNames: categoryNames(req) });
});

/** POST /api/raid-templates — create a template. Body: the template without id. */
const createRaidTemplate = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const result = saveRaidTemplate({ ...body, id: "" });
    if (result.error) return error(res, 400, "invalid", result.error);
    ok(res, decorateTemplate(result.template, getConfig().categoryRaidTemplate), 201);
});

/** PATCH /api/raid-templates — update a template. Body: the template with its id. */
const updateRaidTemplate = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    if (!String(body.id || "").trim()) return error(res, 400, "invalid", "Vorlagen-ID fehlt.");
    const result = saveRaidTemplate(body);
    if (result.notFound) return error(res, 404, "not_found", result.error);
    if (result.error) return error(res, 400, "invalid", result.error);
    ok(res, decorateTemplate(result.template, getConfig().categoryRaidTemplate));
});

/**
 * DELETE /api/raid-templates — body: { id }. A template some category uses as
 * its default is refused with 409: the category would silently lose it.
 */
const deleteRaidTemplateHandler = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const id = String(body.id || "").trim();
    const template = id ? getRaidTemplate(id) : null;
    if (!template) return error(res, 404, "not_found", "Vorlage nicht gefunden.");
    const usedBy = Object.entries(getConfig().categoryRaidTemplate || {}).filter(([, tplId]) => tplId === id).map(([catId]) => catId);
    if (usedBy.length) {
        const names = categoryNames(req);
        const list = usedBy.map((catId) => names[catId] || catId).join(", ");
        return error(res, 409, "template_in_use", `„${template.name}“ ist Standard für ${list}. Erst unter Einstellungen → Kategorien eine andere Vorlage wählen.`);
    }
    deleteRaidTemplate(id);
    ok(res, { id });
});

/** POST /api/raid-templates/import — take over the Raid-Helper templates the server's current events use. */
const importRaidTemplates = withUser({ csrf: true }, async ({ res }) => {
    try {
        const rh = createRaidhelperClient();
        const templates = await rh.getTemplates();
        if (!templates.length) return error(res, 400, "empty", "Keine Templates in den aktuellen Events gefunden.");
        const { added, updated } = saveRaidTemplates(templates);
        ok(res, { added, updated, templates: decoratedTemplates() });
    } catch (e) {
        error(res, 400, "import_failed", e.message || "Laden fehlgeschlagen.");
    }
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/raid-templates", handler: getRaidTemplates, area: "raids" },
    { method: "POST", path: "/api/raid-templates", handler: createRaidTemplate, area: "raids" },
    { method: "PATCH", path: "/api/raid-templates", handler: updateRaidTemplate, area: "raids" },
    { method: "DELETE", path: "/api/raid-templates", handler: deleteRaidTemplateHandler, area: "raids" },
    { method: "POST", path: "/api/raid-templates/import", handler: importRaidTemplates, area: "raids" },
];

module.exports = {
    getRaidTemplates, createRaidTemplate, updateRaidTemplate, deleteRaidTemplateHandler, importRaidTemplates,
    routes,
};
