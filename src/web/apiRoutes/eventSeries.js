// JSON API of the recurring events (#289), page Raid-Events › Serien. Every path
// is area `raids` (apiAccess.js, level by method):
//
//   GET    /api/raids/series            one row per event category: series, summary, next dates
//   GET    /api/raids/series/preview    ?category=&weekdays=3,6&time=&daysBefore=&template=&skip=&enabled=&title=
//                                       the modal's live preview of an unsaved series (nothing is stored)
//   PUT    /api/raids/series            { categoryId, enabled, weekdays, time, raidTemplateId, daysBefore, title, skipDates }
//   DELETE /api/raids/series            { categoryId }
//   POST   /api/raids/series/run        { categoryId?, retryDate? } — sweep now; retryDate clears a failed date first
const { ok, error } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { sendResult } = require("../http/apiResult");
const { activeGuildFor } = require("../http/activeGuild");
const { userCan, userIsOrga } = require("../../config/permissions");
const categoryOrga = require("../../services/roster/categoryOrga");
const { listRaidTemplates, getConfig } = require("../../stores/settingsStore");
const { mainVersionFor, knownVersion, resolveVersionQuery } = require("../../services/events/mainVersion");
const store = require("../../stores/eventSeriesStore");
const series = require("../events/eventSeries");

const q = (url, key) => String((url && url.searchParams && url.searchParams.get(key)) || "").trim();
const list = (value) => value.split(",").map((s) => s.trim()).filter(Boolean);

// A series belongs to its category (one per category): the orga with `raids` write keeps every series,
// the orga of a category (#728, epic #723: a manager of its current roster) sees and changes the series
// of their categories only - `orgaScoped` by the category, as a new event of it ({ categoryId }).
// Everybody else sees none (a series is the orga's planning, docs/permissions.md "Kategorie-Orga").
const BY_CATEGORY = (body) => ({ categoryId: String(body.categoryId || "").trim() });
const BY_QUERY_CATEGORY = (body, query) => ({ categoryId: String(query.get("category") || "").trim() });
const WRITE = { orgaScoped: BY_CATEGORY, write: "raids", csrf: true, body: true };

/**
 * GET /api/raids/series[?version=<id>] — the series of the categories that play
 * the shown game version (#741: a series creates the raids of its category's
 * version), and the raid templates of that version. The global orga with `raids`
 * write sees and writes every category; everyone else - a global orga reading only
 * included, as at the gate (#728 review: no right without its button) - only the
 * categories whose current roster they manage, each one writable; a raider none.
 */
const getSeries = withUser({}, async ({ user, req, res, url }) => {
    const config = getConfig();
    const { versionId } = resolveVersionQuery(url && url.searchParams.get("version"), { config });
    const global = userIsOrga(user) && userCan(user, "raids", "write");
    const own = global ? null : new Set(await categoryOrga.orgaCategoryIds(user, { cache: categoryOrga.requestCache(req), managerOnly: true }));
    const overview = await series.seriesOverview({ guildId: activeGuildFor(req), config });
    ok(res, {
        ...overview,
        categories: overview.categories.filter((c) => mainVersionFor({ categoryId: c.id, config }) === versionId && (!own || own.has(c.id))),
        templates: listRaidTemplates()
            .filter((t) => (knownVersion(t.versionId) || mainVersionFor({ config })) === versionId)
            .map((t) => ({ id: t.id, name: t.name || "", instanceIds: t.instanceIds || [], size: t.size || null })),
        // every row shown is writable: the global orga's all, everyone else's their own categories
        canWrite: global || own.size > 0,
        // "Jetzt prüfen" sweeps every series at once (run without categoryId): the global orga's only
        canRunAll: global,
        limits: { minDaysBefore: series.MIN_DAYS_BEFORE, maxDaysBefore: series.MAX_DAYS_BEFORE },
    });
});

const getPreview = withUser({ orgaScoped: BY_QUERY_CATEGORY }, async ({ req, res, url }) => {
    const input = {
        categoryId: q(url, "category"),
        weekdays: list(q(url, "weekdays")).map(Number),
        time: q(url, "time"),
        daysBefore: q(url, "daysBefore"),
        raidTemplateId: q(url, "template"),
        skipDates: list(q(url, "skip")),
        enabled: q(url, "enabled") !== "0",
        title: q(url, "title"),
    };
    ok(res, await series.previewSeries({ guildId: activeGuildFor(req), input }));
});

const putSeries = withUser(WRITE, async ({ user, body, req, res }) => {
    const result = series.saveSeriesFor({ guildId: activeGuildFor(req), input: body, user });
    if (result.error) return sendResult(res, result);
    ok(res, { series: result.series, message: result.series.enabled ? "Serie gespeichert." : "Serie gespeichert (ausgeschaltet)." });
});

const deleteSeries = withUser(WRITE, async ({ body, res }) => {
    const categoryId = String(body.categoryId || "").trim();
    if (!store.deleteSeries(categoryId)) return error(res, 404, "not_found", "Serie nicht gefunden.");
    ok(res, { categoryId, message: "Serie gelöscht. Bereits angelegte Events bleiben." });
});

// a category orga names their category; only the global orga sweeps every series at once (no categoryId)
const postRun = withUser(WRITE, async ({ body, res }) => {
    const categoryId = String(body.categoryId || "").trim();
    const retryDate = String(body.retryDate || "").trim();
    if (retryDate) {
        const mark = store.getRuns(categoryId)[retryDate];
        const interrupted = mark && mark.status === "creating" && Date.now() - (Number(mark.at) || 0) > series.STALE_CREATING_MS;
        if (!mark || (mark.status !== "failed" && !interrupted)) {
            return error(res, 409, "not_failed", "Für diesen Termin ist nichts fehlgeschlagen.");
        }
        store.clearRun(categoryId, retryDate);
    }
    const summary = await series.runSeries({ onlyCategoryId: categoryId });
    const parts = [];
    if (summary.created) parts.push(`${summary.created} ${summary.created === 1 ? "Event" : "Events"} angelegt`);
    if (summary.existing) parts.push(`${summary.existing} schon vorhanden`);
    if (summary.failed) parts.push(`${summary.failed} fehlgeschlagen: ${summary.results.filter((r) => r.error).map((r) => r.error)[0]}`);
    const message = summary.error || parts.join(" · ") || "Nichts fällig — kein Termin ist gerade dran.";
    ok(res, { ...summary, message });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/raids/series", handler: getSeries, area: "raids" },
    { method: "PUT", path: "/api/raids/series", handler: putSeries, area: "raids" },
    { method: "DELETE", path: "/api/raids/series", handler: deleteSeries, area: "raids" },
    { method: "GET", path: "/api/raids/series/preview", handler: getPreview, area: "raids" },
    { method: "POST", path: "/api/raids/series/run", handler: postRun, area: "raids" },
];

module.exports = { getSeries, getPreview, putSeries, deleteSeries, postRun, routes };
