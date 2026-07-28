// JSON API for the CLA / Logcheck admin page: report evaluations (build a
// report from a Warcraft-Logs link) and the log channel watcher (detected
// logs, their event assignment, auto-match). Faithful JSON port of the SSR
// routes in server.js (see the "CLA / logcheck" block there) — same guards,
// same German strings, same data shapes, minus the HTML rendering.
const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const { listReports } = require("../reportStore");
const { prepareReportList, prepareLogList, annotateLogCategories } = require("../reportList");
const {
    listLogs, getLog, deleteLog, evaluatedSections,
    linkEvent: linkLogEvent, unlinkEvent: unlinkLogEvent,
} = require("../logStore");
const { annotateMatches, autoMatches } = require("../logEventMatch");
const { evaluateLog, scanLogChannels, backfillLogTitles } = require("../logChannel");
const { getConfig } = require("../settingsStore");
const { buildReport, ReportError } = require("../../utils/logcheck/report");
const { loadMatchableEvents, eventLinkFields } = require("../matchableEvents");
const { linkLogByUrl } = require("../manualLog");
const discord = require("../discord");

/** GET /api/cla?view=reports|logs&sort=&dir=&page= */
async function getClaData(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    const logs = guildId ? listLogs().filter((l) => !l.guildId || l.guildId === guildId) : listLogs();
    const reports = listReports();
    const view = url.searchParams.get("view") === "logs" ? "logs" : "reports";
    const sortQuery = {
        sort: url.searchParams.get("sort"),
        dir: url.searchParams.get("dir"),
        page: url.searchParams.get("page"),
    };
    // Only the active view is paginated; the other tab is just a link/count.
    const reportPage = view === "reports" ? prepareReportList(reports, sortQuery) : null;
    const logPage = view === "logs" ? prepareLogList(logs, sortQuery) : null;

    let matchEvents = { events: [], error: null };
    if (logPage) {
        await backfillLogTitles(logPage.items);
        annotateLogCategories(logPage.items, discord.getChannelCategoryMap(guildId));
        matchEvents = await loadMatchableEvents(guildId);
        annotateMatches(logPage.items, matchEvents.events);
        // which analyses already ran, normalised for legacy entries
        for (const l of logPage.items) l.sections = evaluatedSections(l);
    }

    ok(res, {
        view,
        reportPage,
        logPage,
        matchEventsError: matchEvents.error,
        unlinkedCount: logs.filter((l) => !l.eventId).length,
        counts: { reports: reports.length, logs: logs.length },
        logChannelsConfigured: (getConfig().logChannelIds || []).length > 0,
        activeGuildId: guildId,
    });
}

/** POST /api/cla — body: { link }. Builds a report from a WCL link/id. */
async function createReport(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    try {
        const result = await buildReport(body.link || "");
        ok(res, { id: result.id, url: result.url }, 201);
    } catch (e) {
        if (e instanceof ReportError) return error(res, 400, "build_failed", e.message);
        console.error("CLA web build failed:", e);
        error(res, 500, "build_failed", "Unerwarteter Fehler beim Erstellen der Auswertung.");
    }
}

/**
 * POST /api/cla/eval — body: { logId, section }. Evaluates one half of a tracked
 * log ("cla" or "rpb", default "cla"); each half runs at most once and both merge
 * into the same report page.
 */
async function evalLog(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const section = String(body.section || "cla").trim() === "rpb" ? "rpb" : "cla";
    const result = await evaluateLog(String(body.logId || "").trim(), section);
    if (result.ok) return ok(res, { id: result.id, url: result.url, section: result.section });
    if (result.already) return ok(res, { alreadyEvaluated: true, url: result.url, section });
    error(res, 400, "eval_failed", result.error || "Auswertung fehlgeschlagen.");
}

/** POST /api/cla/scan — scans the configured log channels for new logs. */
async function scanLogs(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    try {
        const found = await scanLogChannels(activeGuildFor(req));
        ok(res, { found, message: `${found} neue(r) Log(s) gefunden.` });
    } catch (e) {
        console.error("log scan failed:", e.message);
        error(res, 500, "scan_failed", e.message || "Scan fehlgeschlagen.");
    }
}

/** POST /api/cla/log-delete — body: { logId }. Removes a tracked log from the list. */
async function deleteLogHandler(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const logId = String(body.logId || "").trim();
    deleteLog(logId);
    ok(res, { logId });
}

/** POST /api/cla/log-link — body: { logId, eventId }. Assigns a log to its event. */
async function linkLog(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const logId = String(body.logId || "").trim();
    const eventId = String(body.eventId || "").trim();
    if (!getLog(logId)) return error(res, 400, "not_found", "Log nicht gefunden.");
    if (!eventId) return error(res, 400, "no_event", "Kein Event gewählt.");
    // Re-resolve the event server-side; never trust the label posted by the client.
    const { events, error: loadError } = await loadMatchableEvents(activeGuildFor(req));
    if (loadError) return error(res, 400, "events_unavailable", loadError);
    const event = events.find((e) => e.id === eventId);
    if (!event) return error(res, 400, "event_not_found", "Event nicht gefunden.");
    linkLogEvent(logId, eventLinkFields(event, "manual"));
    ok(res, {
        logId,
        eventId,
        eventLabel: event.title || event.id,
        message: `Log „${event.title || event.id}" zugeordnet.`,
    });
}

/**
 * POST /api/cla/log-link-url — body: { link, eventId }. Registers a pasted
 * Warcraft-Logs URL (if not already tracked) and assigns it to the event in one
 * step — for logs that were never posted in a tracked log channel.
 */
async function linkLogUrl(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const eventId = String(body.eventId || "").trim();
    if (!eventId) return error(res, 400, "no_event", "Kein Event gewählt.");
    // Re-resolve the event server-side, same as linkLog above.
    const { events, error: loadError } = await loadMatchableEvents(activeGuildFor(req));
    if (loadError) return error(res, 400, "events_unavailable", loadError);
    const event = events.find((e) => e.id === eventId);
    if (!event) return error(res, 400, "event_not_found", "Event nicht gefunden.");
    const result = linkLogByUrl(String(body.link || ""), event, activeGuildFor(req));
    if (result.error) return error(res, 400, "invalid_link", result.error);
    await backfillLogTitles([result.log]); // best-effort report name for the row
    ok(res, {
        logId: result.log.id,
        eventId,
        eventLabel: event.title || event.id,
        message: `WCL-Link „${event.title || event.id}" zugeordnet.`,
    });
}

/** POST /api/cla/log-unlink — body: { logId }. Removes a log's event assignment. */
async function unlinkLog(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const logId = String(body.logId || "").trim();
    const removed = unlinkLogEvent(logId);
    if (!removed) return error(res, 400, "not_linked", "Keine Zuordnung vorhanden.");
    ok(res, { logId, message: "Zuordnung entfernt." });
}

/** POST /api/cla/log-automatch — assigns every still-unassigned log with an unambiguous event match. */
async function autoMatchLogs(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const guildId = activeGuildFor(req);
    const { events, error: loadError } = await loadMatchableEvents(guildId);
    if (loadError) return error(res, 400, "events_unavailable", loadError);
    const logs = (guildId ? listLogs().filter((l) => !l.guildId || l.guildId === guildId) : listLogs())
        .filter((l) => !l.eventId);
    const matches = autoMatches(logs, events);
    for (const m of matches) linkLogEvent(m.log.id, eventLinkFields(m.event, "auto"));
    const rest = logs.length - matches.length;
    const message = `${matches.length} Log(s) automatisch zugeordnet${rest ? `, ${rest} ohne eindeutiges Event` : ""}.`;
    ok(res, { matched: matches.length, remaining: rest, message });
}

module.exports = {
    getClaData, createReport, evalLog, scanLogs, deleteLogHandler, linkLog, linkLogUrl, unlinkLog, autoMatchLogs,
};
