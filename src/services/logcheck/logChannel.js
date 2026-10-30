// Log-channel watcher: detects Warcraft-Logs links posted into the log channels
// of a server (#921: serverSettings[guildId].logChannels, logChannelSettings.js), tracks them, and evaluates them once (via the shared buildReport
// pipeline). Used by both the live messageCreate listener and the admin menu.

const { getConfig } = require("../../stores/settings/settingsStore");
const logStore = require("../../stores/loot/logStore");
const eventStore = require("../../stores/events/eventStore");
const discord = require("../discord/discord");
const { extractWclLinks } = require("../../utils/logcheck/logLinks");
const { buildReport, ReportError } = require("../../utils/logcheck/report");
const { wclClientFor, recordVersion } = require("./logVersion");
const { autoLinkLogs } = require("./logAutoLink");
// Re-exported: the pages ask logChannel for the titles; the code lives in logTitles.js.
const { backfillLogTitles } = require("./logTitles");
const { logChannelEntry, logChannelsOf, allLogChannels } = require("./logChannelSettings");

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

/**
 * After the message under a fresh log is out: read the report's name and start from
 * Warcraft Logs (report/fights, one request) and draw them into the message, so it shows
 * "Black Temple + Hyjal · So 04.10." instead of "Warcraft-Logs-Report". Not awaited by the
 * listener — a slow or failing WCL never delays the buttons; without an answer the message
 * just keeps its plain title. Never throws.
 */
async function enrichLogButton(log, btn, { client } = {}) {
    try {
        // the site of the log's version; a version without one is not asked (#746)
        const wcl = client || wclClientFor(recordVersion(log));
        if (!wcl) return false;
        const report = await wcl.getFights(log.reportId);
        const title = String((report && report.title) || "").trim();
        const startMs = Number(report && report.start) || 0;
        if (!title && !startMs) return false;
        if (title) logStore.setLogTitle(log.id, title);
        if (startMs) logStore.setReportStart(log.id, startMs);
        const fresh = logStore.getLog(log.id) || log;
        return await discord.finishLogButton(btn.channelId, btn.messageId, {
            logId: fresh.id, title: fresh.title, link: fresh.link, startMs: fresh.reportStart,
            doneSections: logStore.evaluatedSections(fresh),
        });
    } catch (e) {
        console.error(`enrichLogButton ${log && log.reportId}: ${e.message}`);
        return false;
    }
}

/**
 * Redraw the message under a detected log from the log's stored state: the halves
 * that ran lose their button and gain the evaluation's link, an open half keeps
 * its button. Every way an evaluation runs or is discarded goes through here —
 * the Discord buttons, the web's log list, "evaluate anyway" — so the message
 * never lags behind (before, only the Discord buttons redrew it).
 *
 * The message is the one stored on the log; without one (logs from before the ids
 * were stored) or when it is gone, `hint` (the clicked message) or the bot's reply
 * of this log under the log post is used and remembered; nothing found forgets the
 * stored one. Best-effort, never throws.
 *
 * @param {object|string} logOrId the log or its id
 * @param {{ hint?: { channelId?: string, messageId?: string } }} [opts]
 * @returns {Promise<boolean>} whether the message was redrawn
 */
function refreshLogButton(logOrId, opts = {}) {
    const id = typeof logOrId === "string" ? logOrId : String((logOrId && logOrId.id) || "");
    if (!id) return Promise.resolve(false);
    // One redraw per log at a time, each reading the stored state when its turn
    // comes: a CLA and an RPB run finishing together never leave "1 von 2" behind.
    const next = (redrawChains.get(id) || Promise.resolve()).then(() => redrawLogButton(id, logOrId, opts));
    redrawChains.set(id, next);
    void next.then(() => { if (redrawChains.get(id) === next) redrawChains.delete(id); });
    return next;
}

const redrawChains = new Map();

async function redrawLogButton(id, given, { hint } = {}) {
    try {
        const log = logStore.getLog(id) || (given && typeof given === "object" ? given : null);
        if (!log) return false;
        const doneSections = logStore.evaluatedSections(log);
        const draw = async (at) => !!(await discord.finishLogButton(at.channelId, at.messageId, {
            logId: log.id, title: log.title, link: log.link, startMs: log.reportStart, doneSections,
            reportUrl: doneSections.length ? log.reportUrl || "" : "",
        }));
        const usable = (at) => !!(at && at.channelId && at.messageId);
        const stored = log.buttonMessageId ? { channelId: log.buttonChannelId, messageId: log.buttonMessageId } : null;
        if (usable(stored) && await draw(stored)) {
            // an older message of the same log that was clicked follows too
            if (usable(hint) && hint.messageId !== stored.messageId) await draw(hint);
            return true;
        }
        // nothing stored, or the stored message is gone: the clicked one, else the bot's reply of this log
        const found = usable(hint) && (!stored || hint.messageId !== stored.messageId)
            ? hint
            : await discord.findLogButtonMessage(log.channelId, log.messageId, { logId: log.id, link: log.link });
        if (!usable(found) || (stored && found.messageId === stored.messageId)) {
            // gone and nowhere else: forget it, so a new post of the link gets its buttons again
            if (stored && !usable(found)) logStore.setButtonMessage(log.id, {});
            return false;
        }
        if (!(await draw(found))) return false;
        logStore.setButtonMessage(log.id, { buttonChannelId: found.channelId, buttonMessageId: found.messageId });
        return true;
    } catch (e) {
        console.error(`refreshLogButton ${id}: ${e.message}`);
        return false;
    }
}

/**
 * The log-channel entry of `channelId` on `guildId` ({ channelId, versionId }),
 * null when that server does not watch it (#921: the channels are per server).
 * While the old global list still waits for its migration (logChannelMigration.js:
 * the bot was offline, or Discord did not answer), its channels count too, with no
 * version of their own.
 */
function isLogChannel(channelId, guildId) {
    const config = getConfig();
    const entry = logChannelEntry(guildId, channelId, { config });
    if (entry) return entry;
    const legacy = Array.isArray(config.logChannelIds) ? config.logChannelIds.map(String) : [];
    return legacy.includes(String(channelId || "")) ? { channelId: String(channelId), versionId: "" } : null;
}

/**
 * The channels a scan visits: those of `guildId`, or of every server without
 * one, plus the old global list while it waits for its migration.
 * @returns {{ channelId: string, versionId: string }[]}
 */
function scanTargets(guildId) {
    const config = getConfig();
    const list = guildId ? logChannelsOf(guildId, { config }) : allLogChannels({ config });
    const seen = new Set(list.map((c) => c.channelId));
    for (const id of Array.isArray(config.logChannelIds) ? config.logChannelIds.map(String) : []) {
        if (!seen.has(id)) list.push({ channelId: id, versionId: "" });
        seen.add(id);
    }
    return list;
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
    const logChannel = isLogChannel(message.channelId, message.guildId);
    if (!logChannel) return;

    const links = extractWclLinks(messageText(message));
    let registered = 0;
    for (const { link, reportId } of links) {
        const existing = logStore.getByReportId(reportId);
        // Only skip once *both* analyses are done — a log whose CLA already ran
        // should still offer its RPB button.
        if (existing && logStore.evaluatedSections(existing).length >= 2) continue;
        // already has a live button in this channel — one that was deleted, or sits on
        // another server's log channel, does not stop a new post from getting its own
        if (existing && existing.buttonMessageId && existing.buttonChannelId === message.channelId
            && await discord.logButtonExists(existing.buttonChannelId, existing.buttonMessageId)) continue;

        const log = logStore.saveLog({
            guildId: message.guildId,
            channelId: message.channelId,
            messageId: message.id,
            reportId,
            link,
            source: "listener",
            postedAt: message.createdTimestamp,
            channelVersionId: logChannel.versionId,
        });
        registered += 1;
        try {
            // a half that already ran keeps its button off the fresh message
            const btn = await discord.postLogButton(message, {
                logId: log.id,
                title: log.title,
                link: log.link,
                startMs: log.reportStart,
                doneSections: logStore.evaluatedSections(log),
            });
            logStore.setButtonMessage(log.id, { buttonChannelId: btn.channelId, buttonMessageId: btn.messageId });
            // name and date of the report follow as soon as Warcraft Logs answers
            if (!log.title || !log.reportStart) void enrichLogButton(log, btn);
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
 * The instances the log's own raid planned ("Hyjal + BT" → hyjal, bt), so the
 * guard also waits for a raid the log has not reached yet. [] for a log without
 * a raid or linked to a Raid-Helper event, which names no instances.
 */
function plannedInstances(log) {
    const id = (log && log.eventId) || "";
    if (!eventStore.isOwnEventId(id)) return [];
    const event = eventStore.getEvent(id);
    return (event && Array.isArray(event.instanceIds)) ? event.instanceIds : [];
}

/**
 * Evaluate one half of a tracked log — the CLA (gear/consumables) or the RPB
 * (performance) analysis. Each half runs at most once; the second one merges into
 * the page the first one created, so the link stays the same and just gains tabs.
 *
 * @param {string} logId
 * @param {string} [section]  "cla" or "rpb" (default: "cla")
 * @param {object} [opts]
 * @param {{ channelId?: string, messageId?: string }} [opts.button]  the clicked
 *   message under the log, a hint for logs that never stored theirs
 * @param {boolean} [opts.force]  evaluate even though the raid's final boss is
 *   not down yet; without it such a log comes back as `{ incomplete: true }`
 *   with the progress, so the caller can ask before spending the analysis
 * @returns {Promise<{ok:true,id,url,report,log,section}
 *   | {ok:false,error,already?,url?,incomplete?,progress?,unsupported?,versionId?}>}
 */
async function evaluateLog(logId, section = SECTION_CLA, opts = {}) {
    const kind = section === SECTION_RPB ? SECTION_RPB : SECTION_CLA;
    const log = logStore.getLog(logId);
    if (!log) return { ok: false, error: "Log nicht gefunden." };

    const done = logStore.evaluatedSections(log);
    if (done.includes(kind)) {
        // a click on a message that lags behind (evaluated elsewhere) brings it up to date
        await refreshLogButton(log, { hint: opts.button });
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
                // the log's stored version: its raid's, else its host's, else TBC (#746)
                versionId: recordVersion(log),
                sections: [kind],
                // fold into the page the other half already created, if there is one
                mergeIntoId: log.reportRefId || undefined,
                force: !!opts.force,
                plannedIds: plannedInstances(log),
                // the evaluation belongs to the log's server (#920)
                guildId: log.guildId || "",
            });
        } catch (e) {
            // The raid is still running: a refusal to answer, not a failure —
            // the caller offers "evaluate anyway" instead of showing an error.
            if (e && e.incomplete) {
                return { ok: false, incomplete: true, progress: e.progress, error: e.message };
            }
            // A version the log check has no rules for (#746): the bot words it in the reader's language.
            if (e && e.unsupported) {
                return { ok: false, unsupported: true, versionId: e.versionId, error: e.message };
            }
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
        await refreshLogButton(saved || log, { hint: opts.button });
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
    if (!discord.isOnline()) return 0;
    let count = 0;
    for (const { channelId, versionId } of scanTargets(guildId)) {
        let channel;
        try {
            channel = await discord.fetchTextChannel(channelId);
        } catch {
            continue;
        }
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
                    channelVersionId: versionId,
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

module.exports = {
    handleLogMessage, evaluateLog, scanLogChannels, backfillLogTitles, enrichLogButton, refreshLogButton,
    messageText, isLogChannel, SECTION_LABEL, SECTION_CLA, SECTION_RPB,
};
