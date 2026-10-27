// Which Discord server an evaluation belongs to (#920).
//
// A report built from a tracked log belongs to that log's server: the log is the
// record the orga moves between servers, so the log decides, not a copy on the
// report. A report without a log (a link evaluated by hand) carries the server it
// was made on itself (`guildId`, written when it is saved; reports from before
// were given the first server once at start-up, settingsMigration.js).
//
// Works on the light metadata of reportStore.listReports() as well as on a full
// report - only `id` and `guildId` are read, so filtering never opens a report file.

/**
 * A function report -> server id, built once for a list of logs.
 * @param {object[]} logs every tracked log (logStore.listLogs())
 */
function reportGuildResolver(logs) {
    const byRef = new Map();
    for (const log of logs || []) {
        if (log && log.reportRefId) byRef.set(String(log.reportRefId), String(log.guildId || ""));
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

module.exports = { reportGuild, reportGuildResolver, reportsOfGuild };
