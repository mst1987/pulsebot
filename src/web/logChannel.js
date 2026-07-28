// Log-channel watcher: detects Warcraft-Logs links posted into the configured
// log channels, tracks them, and evaluates them once (via the shared buildReport
// pipeline). Used by both the live messageCreate listener and the admin menu.

const { getConfig } = require("./settingsStore");
const logStore = require("./logStore");
const discord = require("./discord");
const { extractWclLinks } = require("../utils/logcheck/logLinks");
const { buildReport, ReportError } = require("../utils/logcheck/report");
const WarcraftLogs = require("../classes/warcraftlogs");
const { autoLinkLogs } = require("./logAutoLink");

// In-process guard so a double click (or a click racing the web button) cannot
// start two evaluations of the same log before the first marks it done.
const running = new Set();

/** Collect every place a WCL link might hide in a message: content, embeds, link buttons. */
function messageText(message) {
    const parts = [message.content || ""];
    for (const embed of message.embeds || []) {
        if (embed.url) parts.push(embed.url);
        if (embed.title) parts.push(embed.title);
        if (embed.description) parts.push(embed.description);
        if (embed.author && embed.author.url) parts.push(embed.author.url);
        for (const field of embed.fields || []) {
            if (field.name) parts.push(field.name);
            if (field.value) parts.push(field.value);
        }
    }
    for (const row of message.components || []) {
        for (const comp of row.components || []) {
            if (comp.url) parts.push(comp.url);
        }
    }
    return parts.join("\n");
}

/** Is this channel one of the configured log channels? */
function isLogChannel(channelId) {
    const ids = getConfig().logChannelIds || [];
    return ids.includes(channelId);
}

/**
 * Handle a message posted in a (potential) log channel: for each fresh WCL link,
 * register it and post an "evaluate" button underneath. Already-evaluated reports
 * are ignored, and a report that already has a pending button is not re-posted.
 */
async function handleLogMessage(message) {
    const client = discord.getClient();
    if (!client) return;
    if (message.author && client.user && message.author.id === client.user.id) return;
    if (!isLogChannel(message.channelId)) return;

    const links = extractWclLinks(messageText(message));
    let registered = 0;
    for (const { link, reportId } of links) {
        const existing = logStore.getByReportId(reportId);
        // Only skip once *both* analyses are done — a log whose CLA already ran
        // should still offer its RPB button.
        if (existing && logStore.evaluatedSections(existing).length >= 2) continue;
        if (existing && existing.buttonMessageId) continue;        // already has a live button

        const log = logStore.saveLog({
            guildId: message.guildId,
            channelId: message.channelId,
            messageId: message.id,
            reportId,
            link,
            source: "listener",
            postedAt: message.createdTimestamp,
        });
        registered += 1;
        try {
            // a half that already ran keeps its button off the fresh message
            const btn = await discord.postLogButton(message, {
                logId: log.id,
                doneSections: logStore.evaluatedSections(log),
            });
            logStore.setButtonMessage(log.id, btn);
        } catch (e) {
            console.error("postLogButton failed:", e.message);
        }
    }
    // Assign the fresh log to its raid straight away (best-effort) instead of
    // waiting for the periodic sweep, so it is already linked by the time anyone
    // opens the raid list or the event's detail page.
    if (registered) {
        try {
            await autoLinkLogs(message.guildId);
        } catch (e) {
            console.error("autoLinkLogs after detection failed:", e.message);
        }
    }
}

// The two analysis halves. Defined here rather than imported from report.js so
// this module keeps working independently of that module's shape.
const SECTION_CLA = "cla";
const SECTION_RPB = "rpb";

/** Human label for a section, used in the button replies. */
const SECTION_LABEL = { [SECTION_CLA]: "CLA", [SECTION_RPB]: "RPB" };

/**
 * Evaluate one half of a tracked log — the CLA (gear/consumables) or the RPB
 * (performance) analysis. Each half runs at most once; the second one merges into
 * the page the first one created, so the link stays the same and just gains tabs.
 *
 * @param {string} logId
 * @param {string} [section]  "cla" or "rpb" (default: "cla")
 * @returns {Promise<{ok:true,id,url,report,log,section} | {ok:false,error,already?,url?}>}
 */
async function evaluateLog(logId, section = SECTION_CLA) {
    const kind = section === SECTION_RPB ? SECTION_RPB : SECTION_CLA;
    const log = logStore.getLog(logId);
    if (!log) return { ok: false, error: "Log nicht gefunden." };

    const done = logStore.evaluatedSections(log);
    if (done.includes(kind)) {
        return {
            ok: false,
            already: true,
            url: log.reportUrl,
            error: `Die ${SECTION_LABEL[kind]}-Auswertung liegt für diesen Log bereits vor.`,
        };
    }

    // Guard per log *and* half, so CLA and RPB can run side by side.
    const guardKey = `${logId}:${kind}`;
    if (running.has(guardKey)) {
        return { ok: false, error: "Auswertung läuft bereits — bitte einen Moment warten." };
    }
    running.add(guardKey);
    try {
        let result;
        try {
            result = await buildReport(log.link, {
                sections: [kind],
                // fold into the page the other half already created, if there is one
                mergeIntoId: log.reportRefId || undefined,
            });
        } catch (e) {
            const msg = e instanceof ReportError ? e.message : "Unerwarteter Fehler beim Erstellen der Auswertung.";
            if (!(e instanceof ReportError)) console.error("evaluateLog build failed:", e);
            return { ok: false, error: msg };
        }
        const saved = logStore.markEvaluated(log.id, {
            reportRefId: result.id,
            reportUrl: result.url,
            title: result.report.title,
            zone: result.report.zone,
            sections: [kind],
        });
        return { ok: true, id: result.id, url: result.url, report: result.report, log: saved || log, section: kind };
    } finally {
        running.delete(guardKey);
    }
}

/**
 * Scan the configured log channels for WCL links posted while the bot was down /
 * before the channel was configured, and register any new ones (status "open").
 * Optionally restrict to a single guild. Newly found logs are assigned to their
 * raid right away (best-effort) so a backfilled log behaves exactly like one that
 * was picked up live. Returns the number of new logs found.
 */
async function scanLogChannels(guildId, { perChannel = 50 } = {}) {
    const client = discord.getClient();
    if (!client) return 0;
    const ids = getConfig().logChannelIds || [];
    let count = 0;
    for (const channelId of ids) {
        let channel;
        try {
            channel = await client.channels.fetch(channelId);
        } catch {
            continue;
        }
        if (!channel || !channel.isTextBased()) continue;
        if (guildId && channel.guildId !== guildId) continue;
        let messages;
        try {
            messages = await channel.messages.fetch({ limit: perChannel });
        } catch {
            continue;
        }
        for (const msg of messages.values()) {
            for (const { link, reportId } of extractWclLinks(messageText(msg))) {
                if (logStore.getByReportId(reportId)) continue;
                logStore.saveLog({
                    guildId: channel.guildId,
                    channelId: channel.id,
                    messageId: msg.id,
                    reportId,
                    link,
                    source: "scan",
                    postedAt: msg.createdTimestamp,
                });
                count++;
            }
        }
    }
    if (count && guildId) {
        try {
            await autoLinkLogs(guildId);
        } catch (e) {
            console.error("autoLinkLogs after scan failed:", e.message);
        }
    }
    return count;
}

/**
 * Backfill missing display titles for a set of logs from the Warcraft-Logs
 * report name (report/fights → title). Mutates each log's `title` in place and
 * persists it, so the CLA logs list shows the real log name instead of the raw
 * report code. Best-effort: a missing API key or a failed/rate-limited request
 * is ignored (the row keeps its code and is retried on the next view). Only the
 * given logs (i.e. the current page) are fetched, in parallel. Returns how many
 * titles were filled.
 */
async function backfillLogTitles(logs) {
    const missing = (logs || []).filter((l) => l && !l.title && l.reportId);
    if (!missing.length) return 0;
    let wcl;
    try {
        wcl = new WarcraftLogs();
    } catch {
        return 0; // no WARCRAFTLOGS_API_KEY — skip silently
    }
    let filled = 0;
    await Promise.all(missing.map(async (l) => {
        try {
            const data = await wcl.getFights(l.reportId);
            const title = data && data.title ? String(data.title).trim() : "";
            if (title) {
                logStore.setLogTitle(l.id, title);
                l.title = title; // reflect in the in-memory page items
                filled += 1;
            }
        } catch {
            // report deleted / rate-limited — leave the code, retry next time
        }
    }));
    return filled;
}

module.exports = {
    handleLogMessage, evaluateLog, scanLogChannels, backfillLogTitles,
    messageText, isLogChannel, SECTION_LABEL, SECTION_CLA, SECTION_RPB,
};
