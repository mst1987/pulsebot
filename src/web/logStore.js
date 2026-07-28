const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Detected/evaluated Warcraft-Logs from the log channels are tracked here so a
// report is only ever evaluated once. Stored as a single JSON file next to the
// other editable settings under data/settings/logs.json.
const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const LOGS_FILE = path.join(SETTINGS_DIR, "logs.json");

function ensureDir() {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
}

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(LOGS_FILE, "utf8"));
        return Array.isArray(data.logs) ? data.logs : [];
    } catch {
        return [];
    }
}

function writeAll(logs) {
    ensureDir();
    fs.writeFileSync(LOGS_FILE, JSON.stringify({ logs }, null, 2));
}

function newId() {
    return crypto.randomBytes(6).toString("hex");
}

/** All tracked logs, newest detection first. */
function listLogs() {
    return readAll().slice().sort((a, b) => (b.detectedAt || 0) - (a.detectedAt || 0));
}

/** A single tracked log by internal id, or null. */
function getLog(id) {
    return readAll().find((l) => l.id === id) || null;
}

/** A tracked log by its Warcraft-Logs report id, or null. This is the dedup key. */
function getByReportId(reportId) {
    if (!reportId) return null;
    return readAll().find((l) => l.reportId === reportId) || null;
}

/**
 * Register or refresh a detected log. Deduplicates by reportId: if a log for the
 * same report already exists it is updated in place (its status is preserved),
 * otherwise a new "open" entry is created. Returns the saved log.
 */
function saveLog(data) {
    const logs = readAll();
    const existing = data.reportId && logs.find((l) => l.reportId === data.reportId);
    const now = Date.now();
    const fields = {
        guildId: data.guildId || (existing && existing.guildId) || "",
        channelId: data.channelId || (existing && existing.channelId) || "",
        messageId: data.messageId || (existing && existing.messageId) || "",
        reportId: data.reportId || (existing && existing.reportId) || "",
        link: data.link || (existing && existing.link) || "",
        title: data.title || (existing && existing.title) || "",
        source: data.source || (existing && existing.source) || "listener",
        // When the Warcraft-Logs link was posted in the channel (Discord message
        // createdTimestamp). This is what the CLA logs list sorts by — not the
        // detection time. Falls back to the existing value on refresh.
        postedAt: data.postedAt || (existing && existing.postedAt) || 0,
    };
    let saved;
    if (existing) {
        saved = Object.assign(existing, fields, { updatedAt: now });
    } else {
        saved = Object.assign(
            { id: newId(), status: "open", detectedAt: now, updatedAt: now,
                buttonChannelId: "", buttonMessageId: "", reportRefId: "", reportUrl: "" },
            fields
        );
        logs.push(saved);
    }
    writeAll(logs);
    return saved;
}

/** Record the bot's own "evaluate" button message for a log (so it can be updated later). */
function setButtonMessage(id, { buttonChannelId, buttonMessageId }) {
    const logs = readAll();
    const log = logs.find((l) => l.id === id);
    if (!log) return null;
    log.buttonChannelId = buttonChannelId || "";
    log.buttonMessageId = buttonMessageId || "";
    log.updatedAt = Date.now();
    writeAll(logs);
    return log;
}

/**
 * Mark a log as evaluated and attach the generated report.
 *
 * A log can be evaluated twice — once for the CLA half and once for the RPB half
 * — and both write into the same report page. `sections` records which halves are
 * done so each button can be offered (and retired) on its own. `status` stays
 * "done" as soon as any half exists, which is what the admin list reads.
 *
 * @param {string} id
 * @param {object} opts
 * @param {string[]} [opts.sections]  the halves this run produced
 */
function markEvaluated(id, { reportRefId, reportUrl, title, zone, sections } = {}) {
    const logs = readAll();
    const log = logs.find((l) => l.id === id);
    if (!log) return null;
    log.status = "done";
    log.reportRefId = reportRefId || "";
    log.reportUrl = reportUrl || "";
    if (title) log.title = title;
    if (zone) log.zone = zone;
    const done = new Set(log.sections || []);
    for (const s of sections || []) done.add(s);
    log.sections = [...done];
    log.evaluatedAt = Date.now();
    log.updatedAt = Date.now();
    writeAll(logs);
    return log;
}

/** A tracked log by the id of the report it was evaluated into, or null. */
function getByReportRefId(reportRefId) {
    const ref = String(reportRefId || "").trim();
    if (!ref) return null;
    return readAll().find((l) => l.reportRefId === ref) || null;
}

/**
 * Undo a log's evaluation: back to status "open", report reference dropped. Used
 * when the generated report is deleted — the log itself (and its event
 * assignment) stays, so it can simply be evaluated again. Both halves are reset,
 * because CLA and RPB write into the one report page that just went away.
 * Returns the saved log, or null for an unknown id.
 */
function clearEvaluation(id) {
    const logs = readAll();
    const log = logs.find((l) => l.id === id);
    if (!log) return null;
    log.status = "open";
    log.reportRefId = "";
    log.reportUrl = "";
    delete log.sections;
    delete log.evaluatedAt;
    log.updatedAt = Date.now();
    writeAll(logs);
    return log;
}

/**
 * Which halves of a log have already been evaluated.
 *
 * Logs written before the CLA/RPB split have no `sections` field; a "done" one of
 * those was a full evaluation of everything that existed at the time, which is
 * exactly the CLA half.
 */
function evaluatedSections(log) {
    if (!log) return [];
    if (Array.isArray(log.sections) && log.sections.length) return log.sections;
    return log.status === "done" ? ["cla"] : [];
}

/**
 * Discard a single half of a log's evaluation, keeping the other one. This is
 * what makes a half that came out wrong — an RPB that was cut short, say —
 * repeatable without throwing away the CLA result next to it.
 *
 * Was it the last remaining half, the log falls back to "open" and loses its
 * report reference (same end state as clearEvaluation).
 *
 * @returns {null | { log, remaining: string[], wasLast: boolean }}
 *   null when the id is unknown or that half was not evaluated at all
 */
function clearSection(id, section) {
    const logs = readAll();
    const log = logs.find((l) => l.id === id);
    if (!log) return null;

    const done = evaluatedSections(log);
    if (!done.includes(section)) return null;

    const remaining = done.filter((s) => s !== section);
    if (remaining.length === 0) {
        log.status = "open";
        log.reportRefId = "";
        log.reportUrl = "";
        delete log.sections;
        delete log.evaluatedAt;
    } else {
        log.sections = remaining;
    }
    log.updatedAt = Date.now();
    writeAll(logs);
    return { log, remaining, wasLast: remaining.length === 0 };
}

/**
 * Set a log's display title (the Warcraft-Logs report name), backfilled lazily
 * when the CLA logs list is viewed. No-op for a blank title or unknown id.
 * Returns the saved log, or null.
 */
function setLogTitle(id, title) {
    const clean = String(title || "").trim();
    if (!clean) return null;
    const logs = readAll();
    const log = logs.find((l) => l.id === id);
    if (!log || log.title === clean) return log || null;
    log.title = clean;
    log.updatedAt = Date.now();
    writeAll(logs);
    return log;
}

/**
 * Link a log to the Raid-Helper event it belongs to. Stores a snapshot of the
 * event's title/start time as well, because Raid-Helper drops past events from
 * its list — without the snapshot an old assignment would lose its label.
 * `source` records whether the match was applied automatically ("auto") or
 * picked by an admin ("manual"). Returns the saved log, or null for an unknown
 * id / blank event id.
 */
function linkEvent(id, { eventId, eventLabel, eventStartTime, source } = {}) {
    const cleanEvent = String(eventId || "").trim();
    if (!cleanEvent) return null;
    const logs = readAll();
    const log = logs.find((l) => l.id === id);
    if (!log) return null;
    log.eventId = cleanEvent;
    log.eventLabel = String(eventLabel || "").trim();
    log.eventStartTime = Number(eventStartTime) || 0;
    log.eventLinkSource = source === "auto" ? "auto" : "manual";
    log.eventLinkedAt = Date.now();
    log.updatedAt = Date.now();
    writeAll(logs);
    return log;
}

/**
 * Remove a log's event assignment. Returns the saved log, or null when the id is
 * unknown or the log was not linked in the first place (no write in that case).
 */
function unlinkEvent(id) {
    const logs = readAll();
    const log = logs.find((l) => l.id === id);
    if (!log || !log.eventId) return null;
    delete log.eventId;
    delete log.eventLabel;
    delete log.eventStartTime;
    delete log.eventLinkSource;
    delete log.eventLinkedAt;
    log.updatedAt = Date.now();
    writeAll(logs);
    return log;
}

/** All logs linked to one event id, newest post first. */
function listLogsForEvent(eventId) {
    const id = String(eventId || "").trim();
    if (!id) return [];
    return listLogs().filter((l) => l.eventId === id);
}

/** Delete a tracked log by id. Returns true if one was removed. */
function deleteLog(id) {
    const logs = readAll();
    const next = logs.filter((l) => l.id !== id);
    if (next.length === logs.length) return false;
    writeAll(next);
    return true;
}

module.exports = {
    listLogs, getLog, getByReportId, getByReportRefId, saveLog, setButtonMessage,
    markEvaluated, evaluatedSections, clearEvaluation, clearSection, setLogTitle, deleteLog, LOGS_FILE,
    linkEvent, unlinkEvent, listLogsForEvent,
};
