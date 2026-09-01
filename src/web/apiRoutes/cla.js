// JSON API for the CLA / Logcheck admin page: report evaluations (build a
// report from a Warcraft-Logs link) and the log channel watcher (detected
// logs, their event assignment, auto-match). Faithful JSON port of the SSR
// routes in server.js (see the "CLA / logcheck" block there) — same guards,
// same German strings, same data shapes, minus the HTML rendering.
const crypto = require("crypto");
const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const { listReports, deleteReport, getReport, saveReport } = require("../reportStore");
const { prepareReportList, prepareLogList, annotateLogCategories, annotateReportEvents } = require("../reportList");
const {
    listLogs, getLog, getByReportRefId, deleteLog, clearEvaluation, clearSection, evaluatedSections,
    linkEvent: linkLogEvent, unlinkEvent: unlinkLogEvent,
} = require("../logStore");
const { annotateMatches, autoMatches } = require("../logEventMatch");
const { evaluateLog, scanLogChannels, backfillLogTitles } = require("../logChannel");
const { startJob, getJob } = require("../evalJobs");
const { getConfig } = require("../settingsStore");
const { buildReport, stripSection, ReportError } = require("../../utils/logcheck/report");
const { loadMatchableEvents, eventLinkFields } = require("../matchableEvents");
const { linkLogByUrl } = require("../manualLog");
const discord = require("../discord");

/** GET /api/cla?view=reports|logs&sort=&dir=&page= */
async function getClaData(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    const allLogs = listLogs();
    const logs = guildId ? allLogs.filter((l) => !l.guildId || l.guildId === guildId) : allLogs;
    // Reports are not guild-scoped, so annotate them from ALL logs — otherwise a
    // report would look unassigned just because the guild switcher is elsewhere.
    const reports = annotateReportEvents(listReports(), allLogs);
    const view = url.searchParams.get("view") === "logs" ? "logs" : "reports";
    const sortQuery = {
        sort: url.searchParams.get("sort"),
        dir: url.searchParams.get("dir"),
        page: url.searchParams.get("page"),
    };
    // Category and channel name are sortable columns, so they have to sit on
    // every log before the list is sorted and cut — annotating just the page
    // would sort by a field that isn't filled in yet.
    if (view === "logs") annotateLogCategories(logs, discord.getChannelCategoryMap(guildId));
    // Only the active view is paginated; the other tab is just a link/count.
    const reportPage = view === "reports" ? prepareReportList(reports, sortQuery) : null;
    const logPage = view === "logs" ? prepareLogList(logs, sortQuery) : null;

    let matchEvents = { events: [], error: null };
    if (logPage) {
        await backfillLogTitles(logPage.items);
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

// Job "section" under which a report built from a pasted link is tracked. The
// job key is a fresh id rather than a log id, since such a report has no log.
const REPORT_SECTION = "report";

/**
 * POST /api/cla — body: { link }. Builds a report from a WCL link/id.
 *
 * Runs in the background for the same reason the log evaluations do: a build is
 * the full CLA analysis and takes far longer than a reverse proxy keeps a
 * connection open. Answers with a job id; the client polls report-status and
 * can navigate away in the meantime.
 */
async function createReport(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const link = String(body.link || "").trim();
    if (!link) return error(res, 400, "build_failed", "Kein Report-Link angegeben.");
    // Sent once the client has asked whether a raid that is still running should
    // be evaluated regardless (see utils/logcheck/raidProgress.js).
    const force = !!body.force;

    const jobId = crypto.randomBytes(8).toString("hex");
    startJob(jobId, REPORT_SECTION, async () => {
        try {
            const result = await buildReport(link, { force });
            return { ok: true, id: result.id, url: result.url };
        } catch (e) {
            if (e && e.incomplete) return { ok: false, incomplete: true, error: e.message };
            if (e instanceof ReportError) return { ok: false, error: e.message };
            console.error("CLA web build failed:", e);
            return { ok: false, error: "Unerwarteter Fehler beim Erstellen der Auswertung." };
        }
    });
    ok(res, { jobId, status: "running" }, 202);
}

/**
 * GET /api/cla/report-status?jobId= — outcome of a started report build.
 * "unknown" means the job is gone (server restart, or collected long ago); the
 * report itself, if it was written, shows up in the regular list either way.
 */
function reportStatus(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const jobId = String(url.searchParams.get("jobId") || "").trim();
    const job = getJob(jobId, REPORT_SECTION);
    if (!job) return ok(res, { status: "unknown" });
    ok(res, {
        status: job.status, url: job.url, id: job.id, error: job.error,
        incomplete: job.incomplete, runningMs: job.runningMs,
    });
}

/**
 * POST /api/cla/report-delete — body: { reportId }. Deletes a generated report.
 * The log it came from is kept but falls back to "offen", so the same log can be
 * evaluated again; its raid assignment is untouched.
 */
async function deleteReportHandler(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const reportId = String(body.reportId || "").trim();
    const log = getByReportRefId(reportId);
    const removed = deleteReport(reportId);
    if (!removed && !log) return error(res, 400, "not_found", "Auswertung nicht gefunden.");
    if (log) clearEvaluation(log.id);
    ok(res, {
        reportId,
        logId: log ? log.id : "",
        message: log
            ? "Auswertung gelöscht — das Log steht wieder auf „offen“."
            : "Auswertung gelöscht.",
    });
}

/**
 * POST /api/cla/report-unlink — body: { reportId }. Removes the raid assignment
 * of the log this report was generated from. The report itself stays.
 */
async function unlinkReport(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const reportId = String(body.reportId || "").trim();
    const log = getByReportRefId(reportId);
    if (!log) return error(res, 400, "not_found", "Zu dieser Auswertung gibt es kein Log.");
    if (!unlinkLogEvent(log.id)) return error(res, 400, "not_linked", "Keine Zuordnung vorhanden.");
    ok(res, { reportId, logId: log.id, message: "Zuordnung entfernt." });
}

/**
 * POST /api/cla/eval — body: { logId, section }. Starts one half of a tracked
 * log's analysis ("cla" or "rpb", default "cla") and answers immediately.
 *
 * The work runs in the background (see evalJobs.js) because an RPB evaluation
 * takes ~50s — long enough for a reverse proxy to cut the connection at its 60s
 * timeout, which reached the client as a gateway error instead of a result. The
 * caller polls GET /api/cla/eval-status for the outcome.
 */
async function evalLog(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const section = String(body.section || "cla").trim() === "rpb" ? "rpb" : "cla";
    const logId = String(body.logId || "").trim();
    if (!logId) return error(res, 400, "eval_failed", "Kein Log angegeben.");

    // Reject the obvious cases up front so the client gets a straight answer
    // instead of having to poll for a failure that is already known.
    const log = getLog(logId);
    if (!log) return error(res, 400, "eval_failed", "Log nicht gefunden.");
    if (evaluatedSections(log).includes(section)) {
        return ok(res, {
            alreadyEvaluated: true, url: log.reportUrl, section, status: "done",
        });
    }

    // Set once the client has asked whether a raid that is still running should
    // be evaluated regardless (see utils/logcheck/raidProgress.js).
    const force = !!body.force;
    const { alreadyRunning } = startJob(logId, section, () => evaluateLog(logId, section, { force }));
    ok(res, { status: "running", section, logId, alreadyRunning }, 202);
}

/**
 * POST /api/cla/eval-reset — body: { logId, section }. Discards one half of a
 * log's evaluation so it can be run again, keeping the other half.
 *
 * The typical case is an RPB run that was cut short and left partial numbers on
 * the page: dropping just that half re-arms its button without touching the CLA
 * result next to it. Was it the last half, the report page goes away entirely
 * and the log falls back to "offen".
 */
async function resetEval(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const section = String(body.section || "").trim() === "rpb" ? "rpb" : "cla";
    const logId = String(body.logId || "").trim();

    const log = getLog(logId);
    if (!log) return error(res, 400, "not_found", "Log nicht gefunden.");
    if (!evaluatedSections(log).includes(section)) {
        return error(res, 400, "not_evaluated", `Für dieses Log gibt es keine ${section.toUpperCase()}-Auswertung.`);
    }

    const reportRefId = log.reportRefId;
    const cleared = clearSection(logId, section);
    if (!cleared) return error(res, 400, "not_evaluated", "Auswertung nicht gefunden.");

    // Mirror the change on the stored report: drop that half's data, or remove
    // the whole page when nothing is left on it.
    if (reportRefId) {
        if (cleared.wasLast) {
            deleteReport(reportRefId);
        } else {
            const report = getReport(reportRefId);
            if (report) saveReport(stripSection(report, section).report, reportRefId);
        }
    }

    ok(res, {
        logId,
        section,
        remaining: cleared.remaining,
        message: cleared.wasLast
            ? `${section.toUpperCase()}-Auswertung verworfen — das Log steht wieder auf „offen“.`
            : `${section.toUpperCase()}-Auswertung verworfen und kann neu gestartet werden.`,
    });
}

/**
 * GET /api/cla/eval-status?logId=&section= — outcome of a started evaluation.
 *
 * A job that is gone (server restarted, or it finished long ago) is answered from
 * the persisted state instead, so the UI still resolves to the right result.
 */
function evalStatus(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const logId = String(url.searchParams.get("logId") || "").trim();
    const section = String(url.searchParams.get("section") || "cla").trim() === "rpb" ? "rpb" : "cla";

    const job = getJob(logId, section);
    if (job) {
        return ok(res, {
            status: job.status, url: job.url, id: job.id,
            error: job.error, incomplete: job.incomplete, section, runningMs: job.runningMs,
        });
    }

    // no live job — fall back to what was persisted
    const log = getLog(logId);
    if (log && evaluatedSections(log).includes(section)) {
        return ok(res, { status: "done", url: log.reportUrl, id: log.reportRefId, section });
    }
    ok(res, { status: "unknown", section });
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
    getClaData, createReport, reportStatus, evalLog, evalStatus, resetEval, scanLogs, deleteLogHandler,
    linkLog, linkLogUrl, unlinkLog, autoMatchLogs,
    deleteReportHandler, unlinkReport,
};
