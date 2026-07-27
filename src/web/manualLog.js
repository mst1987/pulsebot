// Manually attaching a Warcraft-Logs report to a raid by pasting its URL on the
// raid detail page — for logs that were never posted in a tracked log channel.
// Shared by server.js's SSR route and apiRoutes/cla.js's JSON route (same
// pairing as matchableEvents.js), so both admin UIs behave identically.

const { extractWclLinks } = require("../utils/logcheck/logLinks");
const { eventStartMs } = require("./logEventMatch");
const { eventLinkFields } = require("./matchableEvents");
const logStore = require("./logStore");

/**
 * Register (if needed) and link a Warcraft-Logs report to an event, given the
 * pasted URL. The event must already be resolved server-side (never trust a
 * client-supplied label — same rule as the existing log-link routes).
 *
 * Deduplicates by report id: a log already tracked from a log channel is
 * re-used, not duplicated. A log already assigned to a *different* event is
 * refused so a paste cannot silently steal another raid's log — the admin has
 * to unlink it there first.
 *
 * @param {string} url     text containing a warcraftlogs.com/reports/<id> link
 * @param {object} event   resolved event ({ id, title, startTime, ... })
 * @param {string} guildId guild the log belongs to (for the CLA list filter)
 * @returns {{log: object, created: boolean}|{error: string}}
 */
function linkLogByUrl(url, event, guildId) {
    const [found] = extractWclLinks(url);
    if (!found) return { error: "Kein gültiger Warcraft-Logs-Link (erwartet: …warcraftlogs.com/reports/<ID>)." };
    const existing = logStore.getByReportId(found.reportId);
    if (existing && existing.eventId && existing.eventId !== event.id) {
        const label = existing.eventLabel || existing.eventId;
        return { error: `Dieses Log ist bereits dem Event „${label}" zugeordnet. Dort zuerst die Zuordnung entfernen.` };
    }
    const log = existing || logStore.saveLog({
        guildId: guildId || "",
        reportId: found.reportId,
        link: found.link,
        source: "manual",
        // No Discord message to date it by — use the raid's start so the CLA
        // logs list (sorted by post time) shows it at the raid's date.
        postedAt: eventStartMs(event),
    });
    logStore.linkEvent(log.id, eventLinkFields(event, "manual"));
    return { log: logStore.getLog(log.id) || log, created: !existing };
}

module.exports = { linkLogByUrl };
