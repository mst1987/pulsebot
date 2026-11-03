// The raid templates of a server (#1076, docs/raid-templates.md "Je Server"): a read and a write mean one server
// (http/libraryServer.js, as the raid plan library), a template of another server is unknown (404).
const { ok, error } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const {
    listRaidTemplates, getRaidTemplate, saveRaidTemplate, saveRaidTemplates, deleteRaidTemplate, getConfig,
} = require("../../../stores/settings/settingsStore");
const { decorateTemplate } = require("../../../services/events/raidTemplates");
const { guildOfCategory } = require("../../../services/events/eventServer");
const { visibleRows, resolveVersionQuery } = require("../../../services/versions/mainVersion");
const discord = require("../../../services/discord/discord");
const { libraryReadServer, libraryWriteServer } = require("../../http/libraryServer");
const { createRaidhelperClient } = require("../../../utils/raidhelper/client");

/**
 * Every template of `server` as the list shows it, with its badges and the categories using it as default.
 * `versionQuery` (the page's `?version=`, #741): only the templates of that game version; null = of every shown one.
 */
function decoratedTemplates(server, versionQuery = null) {
    const config = getConfig();
    const defaults = config.categoryRaidTemplate || {};
    // Other versions hidden (#563): their templates stay out of the list.
    const shown = visibleRows(listRaidTemplates(server), (t) => t.versionId, config);
    const { versionId } = resolveVersionQuery(versionQuery, { config });
    const rows = versionQuery === null ? shown : shown.filter((t) => (t.versionId || "tbc") === versionId);
    return rows.map((t) => decorateTemplate(t, defaults));
}

/** The Discord category names of `server`, so "Standard für …" reads as names. Best-effort: offline = {}. */
function categoryNames(server) {
    try {
        const list = discord.listCategories(server) || [];
        return Object.fromEntries(list.map((c) => [c.id, c.name]));
    } catch {
        return {};
    }
}

/**
 * The categories using `template` of `server` as their default. A reference the migration could not place still
 * names the id the copy came from, and a category of unknown server may be this one's: both count, so a delete
 * never takes a category's default away (the refusal names an id the orga may not know, a lost default is worse).
 */
function categoriesUsing(template, server) {
    const ids = new Set([template.id, template.originId].filter(Boolean));
    return Object.entries(getConfig().categoryRaidTemplate || {})
        .filter(([categoryId, templateId]) => {
            if (!ids.has(templateId)) return false;
            const owner = guildOfCategory(categoryId);
            return !owner || owner === server;
        })
        .map(([categoryId]) => categoryId);
}

/** GET /api/raid-templates[?version=<id>][&guildId=<server>] — a server's raid templates (#266, #1076) with their badges (of one game version with `version`, #741). */
const getRaidTemplates = withUser({}, async ({ user, req, res, url }) => {
    const server = libraryReadServer(res, user, req, url ? url.searchParams.get("guildId") : "");
    if (server === null) return;
    ok(res, {
        guildId: server,
        templates: decoratedTemplates(server, url ? url.searchParams.get("version") : null),
        categoryNames: categoryNames(server),
    });
});

/** POST /api/raid-templates — create a template on the tab's server. Body: the template without id, `libraryGuildId`. */
const createRaidTemplate = withUser({ csrf: true, body: true }, async ({ user, body, req, res }) => {
    const server = libraryWriteServer(res, user, req, body.libraryGuildId);
    if (server === null) return;
    const result = saveRaidTemplate(server, { ...body, id: "" });
    if (result.error) return error(res, 400, "invalid", result.error);
    ok(res, decorateTemplate(result.template, getConfig().categoryRaidTemplate), 201);
});

/** PATCH /api/raid-templates — update a template of the tab's server. Body: the template with its id, `libraryGuildId`. */
const updateRaidTemplate = withUser({ csrf: true, body: true }, async ({ user, body, req, res }) => {
    const server = libraryWriteServer(res, user, req, body.libraryGuildId);
    if (server === null) return;
    if (!String(body.id || "").trim()) return error(res, 400, "invalid", "Vorlagen-ID fehlt.");
    const result = saveRaidTemplate(server, body);
    if (result.notFound) return error(res, 404, "not_found", result.error);
    if (result.error) return error(res, 400, "invalid", result.error);
    ok(res, decorateTemplate(result.template, getConfig().categoryRaidTemplate));
});

/**
 * DELETE /api/raid-templates — body: { id, libraryGuildId }. A template some category uses as
 * its default is refused with 409: the category would silently lose it.
 */
const deleteRaidTemplateHandler = withUser({ csrf: true, body: true }, async ({ user, body, req, res }) => {
    const server = libraryWriteServer(res, user, req, body.libraryGuildId);
    if (server === null) return;
    const id = String(body.id || "").trim();
    const template = id ? getRaidTemplate(server, id) : null;
    // the exact id only: an old id finds this server's copy for a reader, it does not name what to delete
    if (!template || template.id !== id) return error(res, 404, "not_found", "Vorlage nicht gefunden.");
    const usedBy = categoriesUsing(template, server);
    if (usedBy.length) {
        const names = categoryNames(server);
        const list = usedBy.map((catId) => names[catId] || catId).join(", ");
        return error(res, 409, "template_in_use", `„${template.name}“ ist Standard für ${list}. Erst unter Einstellungen → Kategorien eine andere Vorlage wählen.`);
    }
    deleteRaidTemplate(server, id);
    ok(res, { id });
});

/** POST /api/raid-templates/import — take over the Raid-Helper templates the tab's server's current events use. */
const importRaidTemplates = withUser({ csrf: true, body: true }, async ({ user, body, req, res }) => {
    const server = libraryWriteServer(res, user, req, body.libraryGuildId);
    if (server === null) return;
    try {
        const rh = createRaidhelperClient({ guildId: server });
        const templates = await rh.getTemplates();
        if (!templates.length) return error(res, 400, "empty", "Keine Templates in den aktuellen Events gefunden.");
        const { added, updated } = saveRaidTemplates(server, templates);
        ok(res, { guildId: server, added, updated, templates: decoratedTemplates(server) });
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
