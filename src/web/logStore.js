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

/** Mark a log as evaluated and attach the generated report. Returns the saved log. */
function markEvaluated(id, { reportRefId, reportUrl, title, zone } = {}) {
    const logs = readAll();
    const log = logs.find((l) => l.id === id);
    if (!log) return null;
    log.status = "done";
    log.reportRefId = reportRefId || "";
    log.reportUrl = reportUrl || "";
    if (title) log.title = title;
    if (zone) log.zone = zone;
    log.evaluatedAt = Date.now();
    log.updatedAt = Date.now();
    writeAll(logs);
    return log;
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

/** Delete a tracked log by id. Returns true if one was removed. */
function deleteLog(id) {
    const logs = readAll();
    const next = logs.filter((l) => l.id !== id);
    if (next.length === logs.length) return false;
    writeAll(next);
    return true;
}

module.exports = {
    listLogs, getLog, getByReportId, saveLog, setButtonMessage,
    markEvaluated, setLogTitle, deleteLog, LOGS_FILE,
};
