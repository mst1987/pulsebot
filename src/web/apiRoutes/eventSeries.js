// JSON API of the recurring events (#289), page Raid-Events › Serien. Every path
// is area `raids` (apiAccess.js, level by method):
//
//   GET    /api/raids/series            one row per event category: series, summary, next dates
//   GET    /api/raids/series/preview    ?category=&weekdays=3,6&time=&daysBefore=&template=&skip=&enabled=&title=
//                                       the modal's live preview of an unsaved series (nothing is stored)
//   PUT    /api/raids/series            { categoryId, enabled, weekdays, time, raidTemplateId, daysBefore, title, skipDates }
//   DELETE /api/raids/series            { categoryId }
//   POST   /api/raids/series/run        { categoryId?, retryDate? } — sweep now; retryDate clears a failed date first
const { ok, error } = require("../apiResponse");
const { withUser } = require("../apiHandler");
const { sendResult } = require("../apiResult");
const { activeGuildFor } = require("../activeGuild");
const { userCan } = require("../../config/permissions");
const { listRaidTemplates } = require("../settingsStore");
const store = require("../eventSeriesStore");
const series = require("../eventSeries");

const q = (url, key) => String((url && url.searchParams && url.searchParams.get(key)) || "").trim();
const list = (value) => value.split(",").map((s) => s.trim()).filter(Boolean);

const getSeries = withUser({}, async ({ user, req, res }) => {
    const overview = await series.seriesOverview({ guildId: activeGuildFor(req) });
    ok(res, {
        ...overview,
        templates: listRaidTemplates().map((t) => ({ id: t.id, name: t.name || "", instanceIds: t.instanceIds || [], size: t.size || null })),
        canWrite: userCan(user, "raids", "write"),
        limits: { minDaysBefore: series.MIN_DAYS_BEFORE, maxDaysBefore: series.MAX_DAYS_BEFORE },
    });
});

const getPreview = withUser({}, async ({ req, res, url }) => {
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

const putSeries = withUser({ csrf: true, body: true }, async ({ user, body, req, res }) => {
    const result = series.saveSeriesFor({ guildId: activeGuildFor(req), input: body, user });
    if (result.error) return sendResult(res, result);
    ok(res, { series: result.series, message: result.series.enabled ? "Serie gespeichert." : "Serie gespeichert (ausgeschaltet)." });
});

const deleteSeries = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const categoryId = String(body.categoryId || "").trim();
    if (!store.deleteSeries(categoryId)) return error(res, 404, "not_found", "Serie nicht gefunden.");
    ok(res, { categoryId, message: "Serie gelöscht. Bereits angelegte Events bleiben." });
});

const postRun = withUser({ csrf: true, body: true }, async ({ body, res }) => {
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
