// Which Discord server an evaluation belongs to (#920).
//
// A report built from a tracked log belongs to that log's server: the log is the
// record the orga moves between servers, so the log decides, not a copy on the
// report. A report without a log (a link evaluated by hand) carries the server it
// was made on itself (`guildId`, written when it is saved; reports from before
// were stamped once at start-up, settingsMigration.js). A log that is deleted
// writes its server onto the report first (deleteLogKeepingReportGuild).
//
// Works on the light metadata of reportStore.listReports() as well as on a full
// report - only `id` and `guildId` are read, so filtering never opens a report file.

const logStore = require("../../stores/logStore");
const reportStore = require("../../stores/reportStore");

/**
 * A function report -> server id, built once for a list of logs.
 * @param {object[]} logs every tracked log (logStore.listLogs())
 */
function reportGuildResolver(logs) {
    const byRef = new Map();
    for (const log of logs || []) {
        // a log without a server of its own (should not happen after #917) leaves the report's own in force
        if (log && log.reportRefId && log.guildId) byRef.set(String(log.reportRefId), String(log.guildId));
    }
    return (report) => {
        if (!report) return "";
        const id = String(report.id || "");
        if (byRef.has(id)) return byRef.get(id);
        return String(report.guildId || "");
    };
}

/** The server one report belongs to; "" when nobody knows. */
function reportGuild(report, logs) {
    return reportGuildResolver(logs)(report);
}

/**
 * Only the reports of one server. Without a server: none - a list never falls
 * back to every server's evaluations.
 */
function reportsOfGuild(reports, guildId, logs) {
    if (!guildId) return [];
    const of = reportGuildResolver(logs);
    return (reports || []).filter((r) => of(r) === String(guildId));
}

/**
 * Delete a tracked log without moving its report to another server. The log
 * decides while it exists; once it is gone the report's own `guildId` does, so
 * that is set to the log's server first (an old report without one, or one whose
 * log moved to another server). Everyone who deletes a log goes through here.
 * @returns {boolean} whether a log was removed
 */
function deleteLogKeepingReportGuild(logId) {
    const id = String(logId || "").trim();
    const log = logStore.getLog(id);
    if (log && log.reportRefId && log.guildId) reportStore.setReportGuild(log.reportRefId, log.guildId);
    return logStore.deleteLog(id);
}

module.exports = { reportGuild, reportGuildResolver, reportsOfGuild, deleteLogKeepingReportGuild };
