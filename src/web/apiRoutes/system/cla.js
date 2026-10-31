// JSON API for the CLA / Logcheck admin page: report evaluations (build a
// report from a Warcraft-Logs link) and the log channel watcher (detected
// logs, their event assignment, auto-match). Faithful JSON port of the SSR
// routes in server.js (see the "CLA / logcheck" block there) — same guards,
// same German strings, same data shapes, minus the HTML rendering.
const crypto = require("crypto");
const { ok, error } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const { AppError } = require("../../http/apiResult");
const { q } = require("../../http/apiParams");
const { activeGuildFor } = require("../../http/activeGuild");
const { mayUseServer } = require("../../http/serverQuery");
const { listReports, deleteReport, getReport, saveReport } = require("../../../stores/loot/reportStore");
const { prepareClaList, claRowFromLog, annotateLogCategories } = require("../../../services/logcheck/reportList");
const { deleteLogKeepingReportGuild, reportGuild } = require("../../../services/logcheck/reportGuild");
const { contentsForText } = require("../../../config/data/tbcContent");
const {
    listLogs, getLog, getByReportRefId, clearEvaluation, clearSection, evaluatedSections,
    linkEvent: linkLogEvent, unlinkEvent: unlinkLogEvent,
} = require("../../../stores/loot/logStore");
const { annotateMatches, autoMatches } = require("../../../services/logcheck/logEventMatch");
const { mineFilter } = require("../../../services/logcheck/myLogs");
const { evaluateLog, scanLogChannels, backfillLogTitles, refreshLogButton } = require("../../../services/logcheck/logChannel");
const { startJob, getJob } = require("../../logcheck/evalJobs");
const { getConfig } = require("../../../stores/settings/settingsStore");
const { buildReport, stripSection, ReportError } = require("../../../utils/logcheck/report");
const { applyReview } = require("../../../utils/logcheck/recommendations/recommendations");
const { sendApproved, sendStatus } = require("../../logcheck/recommendationSend");
const { phraseReport } = require("../../../utils/logcheck/recommendations/recommendationText");
const { listAllAssignments } = require("../../../stores/roster/raiderCharactersStore");
const { loadMatchableEvents, eventLinkFields } = require("../../../services/logcheck/matchableEvents");
const { linkLogByUrl } = require("../../logcheck/manualLog");
const { linkConflict, inVersionList } = require("../../../services/logcheck/logVersion");
const { logChannelsOf } = require("../../../services/logcheck/logChannelSettings");
const { resolveVersionQuery } = require("../../../services/versions/mainVersion");
const discord = require("../../../services/discord/discord");

/**
 * Whether a log or an evaluation may be read or changed from the page (#925):
 * only on the server it belongs to - the rights of an orga hold on their own
 * server, never on another. A full admin may act on every server.
 * @param {object} user the session user (withUser)
 * @param {object} req the request (its active server)
 * @param {string} recordGuildId the server of the log / report
 */
function onActiveServer(user, req, recordGuildId) {
    return mayUseServer(user, req, recordGuildId);
}

/** The server a report belongs to (the log it came from decides, reportGuild.js). */
function guildOfReport(reportId, report) {
    return reportGuild(report || getReport(reportId) || { id: reportId }, listLogs());
}

/** A log of another server answers like an unknown one - it does not exist here. */
function logNotHere(res) {
    return error(res, 404, "not_found", "Log nicht gefunden.");
}

/** An evaluation of another server answers like an unknown one. */
function reportNotHere(res) {
    return error(res, 404, "not_found", "Auswertung nicht gefunden.");
}

/**
 * The game version a request of this page is about (#741): `?version=`, else
 * the main version. A raid of another version is no candidate, and a linked
 * log of another version is not in the list (logVersion.inVersionList).
 */
function shownVersion(query) {
    return resolveVersionQuery(query && query.get("version"), { config: getConfig() }).versionId;
}

/** The raids a log may be linked to in the version shown — the candidates and "Automatisch zuordnen". */
function eventsOfVersion(events, versionId) {
    return (events || []).filter((e) => !versionId || e.versionId === versionId);
}

/**
 * GET /api/cla?filter=all|open|unlinked|done&sort=&dir=&page=&version=&mine=1 — the
 * page's one list: the logs of the active guild plus the reports built from a
 * pasted link (reportList.prepareClaList), of one game version (#741: a log
 * without a raid in every version as "nicht zugeordnet", a linked one only in
 * its raid's), with a count per filter and how many open logs "Automatisch
 * zuordnen" would assign to a raid of that version.
 */
const getClaData = withUser({}, async ({ req, res, query, user }) => {
    const guildId = activeGuildFor(req);
    const versionId = shownVersion(query);
    const config = getConfig();
    const inVersion = (record) => inVersionList(record, versionId, { config });
    const allLogs = listLogs();
    // Only the active server's logs (#920); without one, none.
    const logs = allLogs.filter((l) => !!guildId && l.guildId === guildId);
    // which analyses already ran, normalised for legacy entries
    for (const l of logs) l.sections = evaluatedSections(l);
    annotateLogCategories(logs, discord.getChannelCategoryMap(guildId));
    const listQuery = {
        filter: query.get("filter"),
        sort: query.get("sort"),
        dir: query.get("dir"),
        page: query.get("page"),
    };
    const reports = listReports();
    // "Nur meine Raids": only the rows whose evaluation lists one of the account's characters or whose raid event the account was part of
    const mine = query.get("mine") === "1";
    const { page, filter, counts } = prepareClaList(logs, reports, listQuery, {
        allLogs, inVersion, guildId, keep: mine ? mineFilter(user.id) : undefined,
    });

    // Title and boss count of the logs on this page, read from WCL once, then
    // the rows rebuilt from the filled logs.
    const logById = new Map(logs.map((l) => [l.id, l]));
    const reportById = new Map(reports.map((r) => [r.id, r]));
    const pageLogs = page.items.filter((row) => row.kind === "log").map((row) => logById.get(row.logId)).filter(Boolean);
    await backfillLogTitles(pageLogs);
    page.items = page.items.map((row) => (row.kind === "log" && logById.has(row.logId)
        ? claRowFromLog(logById.get(row.logId), reportById.get(logById.get(row.logId).reportRefId))
        : row));

    const loaded = await loadMatchableEvents(guildId);
    const matchEvents = { ...loaded, events: eventsOfVersion(loaded.events, versionId) };
    // Candidates for every log on the page, the assigned ones included —
    // "Zuordnung ändern" offers the same choice. annotateMatches skips linked
    // logs, so it gets them without their assignment.
    const logRows = page.items.filter((row) => row.kind === "log");
    const probes = logRows.map((row) => ({ ...row, eventId: "" }));
    annotateMatches(probes, matchEvents.events);
    logRows.forEach((row, i) => {
        row.candidates = probes[i].candidates || [];
        row.matchAmbiguous = !!probes[i].matchAmbiguous;
    });
    // The event's raid, for the boss icon in the assignment dialog.
    for (const row of page.items) {
        for (const c of row.candidates || []) c.contentId = contentsForText(c.title)[0] || "";
    }

    ok(res, {
        filter,
        mine,
        page,
        counts,
        autoMatchCount: matchEvents.error ? 0 : autoMatches(logs.filter((l) => !l.eventId && inVersion(l)), matchEvents.events).length,
        matchEventsError: matchEvents.error,
        // #921: the old global list still counts until the bot has moved it to the servers (like isLogChannel)
        logChannelsConfigured: logChannelsOf(guildId, { config }).length > 0
            || (Array.isArray(config.logChannelIds) && config.logChannelIds.length > 0),
        activeGuildId: guildId,
        version: versionId,
    });
});

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
const createReport = withUser({ csrf: true, body: true }, async ({ req, body, res }) => {
    const link = q.str(body, "link");
    if (!link) return error(res, 400, "build_failed", "Kein Report-Link angegeben.");
    // Sent once the client has asked whether a raid that is still running should
    // be evaluated regardless (see utils/logcheck/raid/raidProgress.js).
    const force = !!body.force;
    // Which halves to build: both by default, or the one the form picked.
    const sections = Array.isArray(body.sections) ? body.sections.filter((s) => s === "cla" || s === "rpb") : undefined;

    // A link evaluated here belongs to the server the page is on (#920).
    const guildId = activeGuildFor(req);
    const jobId = crypto.randomBytes(8).toString("hex");
    startJob(jobId, REPORT_SECTION, async () => {
        try {
            const result = await buildReport(link, sections && sections.length ? { force, sections, guildId } : { force, guildId });
            return { ok: true, id: result.id, url: result.url };
        } catch (e) {
            if (e && e.incomplete) return { ok: false, incomplete: true, progress: e.progress, error: e.message };
            if (e instanceof ReportError) return { ok: false, error: e.message };
            console.error("CLA web build failed:", e);
            return { ok: false, error: "Unerwarteter Fehler beim Erstellen der Auswertung." };
        }
    });
    ok(res, { jobId, status: "running" }, 202);
});

/**
 * GET /api/cla/report-status?jobId= — outcome of a started report build.
 * "unknown" means the job is gone (server restart, or collected long ago); the
 * report itself, if it was written, shows up in the regular list either way.
 */
const reportStatus = withUser({}, async ({ res, query }) => {
    const jobId = q.str(query, "jobId");
    const job = getJob(jobId, REPORT_SECTION);
    if (!job) return ok(res, { status: "unknown" });
    ok(res, {
        status: job.status, url: job.url, id: job.id, error: job.error,
        incomplete: job.incomplete, raids: job.raids, runningMs: job.runningMs,
    });
});

/**
 * POST /api/cla/report-delete — body: { reportId }. Deletes a generated report.
 * The log it came from is kept but falls back to "offen", so the same log can be
 * evaluated again; its raid assignment is untouched.
 */
const deleteReportHandler = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const reportId = q.str(body, "reportId");
    const log = getByReportRefId(reportId);
    if (!onActiveServer(user, req, log ? log.guildId : guildOfReport(reportId))) return reportNotHere(res);
    const removed = deleteReport(reportId);
    if (!removed && !log) return error(res, 400, "not_found", "Auswertung nicht gefunden.");
    if (log) {
        clearEvaluation(log.id);
        // the message under the log offers its buttons again (best-effort, not awaited)
        void refreshLogButton(log.id);
    }
    ok(res, {
        reportId,
        logId: log ? log.id : "",
        message: log
            ? "Auswertung gelöscht — das Log steht wieder auf „offen“."
            : "Auswertung gelöscht.",
    });
});

/**
 * POST /api/cla/report-unlink — body: { reportId }. Removes the raid assignment
 * of the log this report was generated from. The report itself stays.
 */
const unlinkReport = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const reportId = q.str(body, "reportId");
    const log = getByReportRefId(reportId);
    if (!log) return error(res, 400, "not_found", "Zu dieser Auswertung gibt es kein Log.");
    if (!onActiveServer(user, req, log.guildId)) return reportNotHere(res);
    if (!unlinkLogEvent(log.id)) return error(res, 400, "not_linked", "Keine Zuordnung vorhanden.");
    ok(res, { reportId, logId: log.id, message: "Zuordnung entfernt." });
});

/**
 * POST /api/cla/eval — body: { logId, section }. Starts one half of a tracked
 * log's analysis ("cla" or "rpb", default "cla") and answers immediately.
 *
 * The work runs in the background (see evalJobs.js) because an RPB evaluation
 * takes ~50s — long enough for a reverse proxy to cut the connection at its 60s
 * timeout, which reached the client as a gateway error instead of a result. The
 * caller polls GET /api/cla/eval-status for the outcome.
 */
const evalLog = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const section = (q.str(body, "section") || "cla") === "rpb" ? "rpb" : "cla";
    const logId = q.str(body, "logId");
    if (!logId) return error(res, 400, "eval_failed", "Kein Log angegeben.");

    // Reject the obvious cases up front so the client gets a straight answer
    // instead of having to poll for a failure that is already known.
    const log = getLog(logId);
    if (!log) return error(res, 400, "eval_failed", "Log nicht gefunden.");
    if (!onActiveServer(user, req, log.guildId)) return logNotHere(res);
    if (evaluatedSections(log).includes(section)) {
        return ok(res, {
            alreadyEvaluated: true, url: log.reportUrl, section, status: "done",
        });
    }

    // Set once the client has asked whether a raid that is still running should
    // be evaluated regardless (see utils/logcheck/raid/raidProgress.js).
    const force = !!body.force;
    const { alreadyRunning } = startJob(logId, section, () => evaluateLog(logId, section, { force }));
    ok(res, { status: "running", section, logId, alreadyRunning }, 202);
});

/**
 * POST /api/cla/eval-reset — body: { logId, section }. Discards one half of a
 * log's evaluation so it can be run again, keeping the other half.
 *
 * The typical case is an RPB run that was cut short and left partial numbers on
 * the page: dropping just that half re-arms its button without touching the CLA
 * result next to it. Was it the last half, the report page goes away entirely
 * and the log falls back to "offen".
 */
const resetEval = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const section = q.str(body, "section") === "rpb" ? "rpb" : "cla";
    const logId = q.str(body, "logId");

    const log = getLog(logId);
    if (!log) return error(res, 400, "not_found", "Log nicht gefunden.");
    if (!onActiveServer(user, req, log.guildId)) return logNotHere(res);
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
    // the discarded half gets its button back in Discord (best-effort, not awaited)
    void refreshLogButton(logId);

    ok(res, {
        logId,
        section,
        remaining: cleared.remaining,
        message: cleared.wasLast
            ? `${section.toUpperCase()}-Auswertung verworfen — das Log steht wieder auf „offen“.`
            : `${section.toUpperCase()}-Auswertung verworfen und kann neu gestartet werden.`,
    });
});

/**
 * GET /api/cla/eval-status?logId=&section= — outcome of a started evaluation.
 *
 * A job that is gone (server restarted, or it finished long ago) is answered from
 * the persisted state instead, so the UI still resolves to the right result.
 */
const evalStatus = withUser({}, async ({ user, req, res, query }) => {
    const logId = q.str(query, "logId");
    const section = (q.str(query, "section") || "cla") === "rpb" ? "rpb" : "cla";
    // a log of another server: not even whether it is being evaluated (#925)
    const tracked = getLog(logId);
    if (tracked && !onActiveServer(user, req, tracked.guildId)) return logNotHere(res);

    const job = getJob(logId, section);
    if (job) {
        return ok(res, {
            status: job.status, url: job.url, id: job.id,
            error: job.error, incomplete: job.incomplete, raids: job.raids, section, runningMs: job.runningMs,
        });
    }

    // no live job — fall back to what was persisted
    if (tracked && evaluatedSections(tracked).includes(section)) {
        return ok(res, { status: "done", url: tracked.reportUrl, id: tracked.reportRefId, section });
    }
    ok(res, { status: "unknown", section });
});

/** POST /api/cla/scan — scans the configured log channels for new logs. */
const scanLogs = withUser({ csrf: true }, async ({ req, res }) => {
    try {
        const found = await scanLogChannels(activeGuildFor(req));
        ok(res, { found, message: `${found} neue(r) Log(s) gefunden.` });
    } catch (e) {
        throw new AppError("scan_failed", 500, e.message || "Scan fehlgeschlagen.");
    }
});

/** POST /api/cla/log-delete — body: { logId }. Removes a tracked log from the list. */
const deleteLogHandler = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const logId = q.str(body, "logId");
    const log = getLog(logId);
    if (log && !onActiveServer(user, req, log.guildId)) return logNotHere(res);
    deleteLogKeepingReportGuild(logId);
    ok(res, { logId });
});

/** POST /api/cla/log-link — body: { logId, eventId }. Assigns a log to its event. */
const linkLog = withUser({ csrf: true, body: true }, async ({ user, body, req, res }) => {
    const logId = q.str(body, "logId");
    const eventId = q.str(body, "eventId");
    const log = getLog(logId);
    if (!log) return error(res, 400, "not_found", "Log nicht gefunden.");
    if (!onActiveServer(user, req, log.guildId)) return logNotHere(res);
    if (!eventId) return error(res, 400, "no_event", "Kein Event gewählt.");
    // Re-resolve the event on the server; never trust the label posted by the client.
    const { events, error: loadError } = await loadMatchableEvents(activeGuildFor(req));
    if (loadError) return error(res, 400, "events_unavailable", loadError);
    const event = events.find((e) => e.id === eventId);
    if (!event) return error(res, 400, "event_not_found", "Event nicht gefunden.");
    // a log belongs only to a raid of its own game version (#746)
    const conflict = linkConflict(log, event);
    if (conflict) return error(res, 400, "version_mismatch", conflict);
    linkLogEvent(logId, eventLinkFields(event, "manual"));
    ok(res, {
        logId,
        eventId,
        eventLabel: event.title || event.id,
        message: `Log „${event.title || event.id}" zugeordnet.`,
    });
});

/**
 * POST /api/cla/log-link-url — body: { link, eventId }. Registers a pasted
 * Warcraft-Logs URL (if not already tracked) and assigns it to the event in one
 * step — for logs that were never posted in a tracked log channel.
 */
const linkLogUrl = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const eventId = q.str(body, "eventId");
    if (!eventId) return error(res, 400, "no_event", "Kein Event gewählt.");
    // Re-resolve the event on the server, same as linkLog above.
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
});

/** POST /api/cla/log-unlink — body: { logId }. Removes a log's event assignment. */
const unlinkLog = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const logId = q.str(body, "logId");
    const log = getLog(logId);
    if (log && !onActiveServer(user, req, log.guildId)) return logNotHere(res);
    const removed = unlinkLogEvent(logId);
    if (!removed) return error(res, 400, "not_linked", "Keine Zuordnung vorhanden.");
    ok(res, { logId, message: "Zuordnung entfernt." });
});

/**
 * POST /api/cla/log-automatch[?version=<id>] — assigns every still-unassigned
 * log with an unambiguous match among the raids of the version shown (#741).
 */
const autoMatchLogs = withUser({ csrf: true }, async ({ req, res, query }) => {
    const guildId = activeGuildFor(req);
    const { events: all, error: loadError } = await loadMatchableEvents(guildId);
    if (loadError) return error(res, 400, "events_unavailable", loadError);
    const versionId = shownVersion(query);
    const events = eventsOfVersion(all, versionId);
    // copies with their channel's category: it ranks the candidates and its
    // version breaks a tie for a log of unknown version (#746). Only the logs
    // this version's list shows — an SSC log is never matched to a Forever raid.
    const config = getConfig();
    const logs = annotateLogCategories(listLogs().filter((l) => !!guildId && l.guildId === guildId)
        .filter((l) => !l.eventId).map((l) => ({ ...l })), discord.getChannelCategoryMap(guildId))
        .filter((l) => inVersionList(l, versionId, { config }));
    const matches = autoMatches(logs, events);
    for (const m of matches) linkLogEvent(m.log.id, eventLinkFields(m.event, "auto"));
    const rest = logs.length - matches.length;
    const message = `${matches.length} Log(s) automatisch zugeordnet${rest ? `, ${rest} ohne eindeutiges Event` : ""}.`;
    ok(res, { matched: matches.length, remaining: rest, message });
});

/**
 * GET /api/cla/recommendations?id=<reportId> — the report's recommendations with
 * the raid lead's review laid over them (approved / rejected / undecided, own text).
 */
const getRecommendations = withUser({}, async ({ user, req, res, query }) => {
    const reportId = q.str(query, "id");
    const report = reportId ? getReport(reportId) : null;
    if (!report || !onActiveServer(user, req, guildOfReport(reportId, report))) return reportNotHere(res);
    ok(res, {
        reportId,
        title: report.title || "",
        recommendations: applyReview(report.recommendations, report.recommendationReview),
    });
});

/**
 * POST /api/cla/recommendations — body: { reportId, scope: "raid"|"player",
 * player?, key, approved?: true|false|null, text?: string }. Records the raid
 * lead's verdict on one finding. Nothing is sent to anyone from here; approval
 * is what the later send step reads.
 */
const reviewRecommendation = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const reportId = q.str(body, "reportId");
    const report = reportId ? getReport(reportId) : null;
    if (!report || !onActiveServer(user, req, guildOfReport(reportId, report))) return reportNotHere(res);
    const scope = body.scope === "raid" ? "raid" : "player";
    const key = q.str(body, "key");
    const player = q.str(body, "player");
    if (!key || (scope === "player" && !player)) return error(res, 400, "bad_request", "Empfehlung nicht angegeben.");
    const rec = report.recommendations || { raid: [], players: [] };
    const known = scope === "raid"
        ? (rec.raid || []).some((i) => i.key === key)
        : (((rec.players || []).find((p) => p.name === player) || { items: [] }).items || []).some((i) => i.key === key);
    if (!known) return error(res, 404, "not_found", "Diese Empfehlung gibt es in der Auswertung nicht.");

    const review = report.recommendationReview || { raid: {}, players: {} };
    review.raid = review.raid || {};
    review.players = review.players || {};
    const bucket = scope === "raid" ? review.raid : (review.players[player] = review.players[player] || {});
    const entry = { ...(bucket[key] || {}) };
    if (body.approved === true || body.approved === false) entry.approved = body.approved;
    else if (body.approved === null) delete entry.approved;
    if (typeof body.text === "string") entry.text = body.text.trim().slice(0, 1000);
    entry.by = user.name || user.id || "";
    entry.at = Date.now();
    bucket[key] = entry;
    report.recommendationReview = review;
    saveReport(report, reportId);
    ok(res, { reportId, scope, player, key, review: entry });
});

/**
 * GET /api/cla/recommendations/send?id=<reportId> — per raider: approved
 * points, whether a Discord account is assigned, when they were last sent.
 */
const recommendationSendStatus = withUser({}, async ({ user, req, res, query }) => {
    const reportId = q.str(query, "id");
    const report = reportId ? getReport(reportId) : null;
    if (!report || !onActiveServer(user, req, guildOfReport(reportId, report))) return reportNotHere(res);
    ok(res, { reportId, players: sendStatus(report, listAllAssignments()) });
});

/**
 * POST /api/cla/recommendations/send — body: { reportId, players?: string[], force?: boolean }.
 * Sends every raider (or the named ones) their approved points as a Discord DM.
 * Already-sent, unchanged sets are skipped unless `force`; raiders without an
 * assigned account are listed, never guessed.
 */
const sendRecommendations = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const reportId = q.str(body, "reportId");
    const report = reportId ? getReport(reportId) : null;
    if (!report || !onActiveServer(user, req, guildOfReport(reportId, report))) return reportNotHere(res);
    if (!discord.getClient()) return error(res, 503, "bot_offline", "Bot nicht verbunden – DMs können gerade nicht gesendet werden.");
    const only = Array.isArray(body.players) ? body.players.map((n) => String(n || "").trim()).filter(Boolean) : null;
    const result = await sendApproved(report, {
        discord, assignments: listAllAssignments(), by: user.name || user.id || "", force: body.force === true, only: only && only.length ? only : null,
    });
    saveReport(result.report, reportId);
    const message = result.sent.length
        ? `${result.sent.length} Raider angeschrieben${result.skipped.length ? `, ${result.skipped.length} übersprungen` : ""}.`
        : (result.skipped.length ? "Nichts gesendet – siehe Gründe." : "Nichts freigegeben.");
    ok(res, { reportId, sent: result.sent, skipped: result.skipped, message });
});

const PHRASE_SECTION = "phrase";

/**
 * POST /api/cla/recommendations/phrase — body: { reportId, players?: string[] }.
 * Has Claude phrase the findings (all raiders, or the named ones) in the
 * background; the client polls the status. Needs the Anthropic key from
 * Einstellungen → Verbindungen → KI-Formulierung.
 */
const phraseRecommendations = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const reportId = q.str(body, "reportId");
    const report = reportId ? getReport(reportId) : null;
    if (!report || !onActiveServer(user, req, guildOfReport(reportId, report))) return reportNotHere(res);
    const settings = (getConfig().anthropic) || {};
    if (!settings.apiKey) return error(res, 400, "no_api_key", "Kein Anthropic-API-Key hinterlegt (Einstellungen → Verbindungen → KI-Formulierung).");
    const only = Array.isArray(body.players) ? body.players.map((n) => String(n || "").trim()).filter(Boolean) : null;
    const started = startJob(reportId, PHRASE_SECTION, async () => {
        const fresh = getReport(reportId);
        if (!fresh) return { ok: false, error: "Auswertung nicht gefunden." };
        const result = await phraseReport(fresh, { apiKey: settings.apiKey, model: settings.model || undefined, only: only && only.length ? only : null });
        saveReport(fresh, reportId);
        return { ok: true, id: reportId, url: `${result.phrased}` };
    });
    ok(res, { reportId, status: started.status, alreadyRunning: started.alreadyRunning }, started.alreadyRunning ? 200 : 202);
});

/** GET /api/cla/recommendations/phrase?id=<reportId> — the job state plus the report's last phrasing record. */
const phraseStatus = withUser({}, async ({ user, req, res, query }) => {
    const reportId = q.str(query, "id");
    const report = reportId ? getReport(reportId) : null;
    if (!report || !onActiveServer(user, req, guildOfReport(reportId, report))) return reportNotHere(res);
    const job = getJob(reportId, PHRASE_SECTION);
    ok(res, { reportId, job, last: report.recommendationPhrase || null, hasApiKey: !!((getConfig().anthropic || {}).apiKey) });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/cla", handler: getClaData, area: "cla" },
    { method: "POST", path: "/api/cla", handler: createReport, area: "cla" },
    { method: "GET", path: "/api/cla/report-status", handler: reportStatus, area: "cla" },
    { method: "POST", path: "/api/cla/report-delete", handler: deleteReportHandler, area: "cla" },
    { method: "POST", path: "/api/cla/report-unlink", handler: unlinkReport, area: "cla" },
    { method: "POST", path: "/api/cla/eval", handler: evalLog, area: "cla" },
    { method: "GET", path: "/api/cla/eval-status", handler: evalStatus, area: "cla" },
    { method: "POST", path: "/api/cla/eval-reset", handler: resetEval, area: "cla" },
    { method: "POST", path: "/api/cla/scan", handler: scanLogs, area: "cla" },
    { method: "POST", path: "/api/cla/log-delete", handler: deleteLogHandler, area: "cla" },
    { method: "POST", path: "/api/cla/log-link", handler: linkLog, area: "cla" },
    { method: "POST", path: "/api/cla/log-link-url", handler: linkLogUrl, area: "cla" },
    { method: "POST", path: "/api/cla/log-unlink", handler: unlinkLog, area: "cla" },
    { method: "POST", path: "/api/cla/log-automatch", handler: autoMatchLogs, area: "cla" },
    { method: "GET", path: "/api/cla/recommendations", handler: getRecommendations, area: "cla" },
    { method: "POST", path: "/api/cla/recommendations", handler: reviewRecommendation, area: "cla" },
    { method: "GET", path: "/api/cla/recommendations/send", handler: recommendationSendStatus, area: "cla" },
    { method: "POST", path: "/api/cla/recommendations/send", handler: sendRecommendations, area: "cla" },
    { method: "GET", path: "/api/cla/recommendations/phrase", handler: phraseStatus, area: "cla" },
    { method: "POST", path: "/api/cla/recommendations/phrase", handler: phraseRecommendations, area: "cla" },
];

module.exports = {
    recommendationSendStatus, sendRecommendations, phraseRecommendations, phraseStatus,
    getClaData, createReport, reportStatus, evalLog, evalStatus, resetEval, scanLogs, deleteLogHandler,
    linkLog, linkLogUrl, unlinkLog, autoMatchLogs,
    deleteReportHandler, unlinkReport,
    getRecommendations, reviewRecommendation,
    routes,
};
