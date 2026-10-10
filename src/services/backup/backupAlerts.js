// The Discord DM to the bootstrap admin (ADMIN_USER_ID) when the backup needs a look (#696): a failed run or a part
// that turned red. Checked every 30 minutes by a background job; per part at most one message a day, and again at once
// when the state changes (stale -> failed) or after it was red and recovered in between.
//
// A DM the bot could not deliver (DMs closed) is logged and counts as sent for the day: the page and the overview
// task show the same thing, and a retry every half hour would only fill the log. A bot that is not connected yet
// marks nothing - the next check tries again.
const { readParts, PARTS } = require("./backupStatus");
const { backupEnabled } = require("./backupConfig");
const alertStore = require("../../stores/backupAlertStore");
const logger = require("../../logger").child("backup");

const CHECK_MS = 30 * 60 * 1000;
const FIRST_DELAY_MS = 3 * 60 * 1000;
const REPEAT_MS = 24 * 60 * 60 * 1000;

const PART_NAMES = { snapshot: "Schnappschuss", offsite: "Kopie außer Haus", restoreTest: "Wiederherstellungsprobe" };

let timer = null;
let firstTimer = null;

/** The German line for one red part. */
function lineFor(part, now) {
    const name = PART_NAMES[part.key] || part.key;
    if (part.state === "failed") return `${name}: fehlgeschlagen${part.error ? ` (${part.error})` : ""}.`;
    if (part.state === "never") return `${name}: bisher nie gelaufen.`;
    const hours = Math.max(1, Math.round((now - part.at) / 3600000));
    const age = hours < 48 ? `${hours} Stunden` : `${Math.round(hours / 24)} Tagen`;
    return `${name}: zuletzt vor ${age}.`;
}

/** The parts that need a message now: red, and not announced in this state within the last day. */
function dueParts(parts, sent, now) {
    return parts.filter((p) => {
        if (p.light !== "bad") return false;
        const before = sent[p.key];
        return !before || before.state !== p.state || now - before.at >= REPEAT_MS;
    });
}

/**
 * One check. `send(userId, payload)` is discord.sendDirectMessage. Returns what it did, for tests and the log.
 * @returns {Promise<{ sent: string[], skipped?: string }>}
 */
async function check({ now = Date.now(), send, adminId, backupDir } = {}) {
    const admin = String(adminId || "").split(",")[0].trim();
    if (!admin) return { sent: [], skipped: "no-admin" };
    const status = readParts({ now, ...(backupDir ? { backupDir } : {}) });
    const sent = alertStore.readAll();
    const next = { ...sent };
    // a part that is fine again forgets its entry, so the next failure is announced at once
    for (const key of PARTS) if (status.parts.find((p) => p.key === key).light !== "bad") delete next[key];
    const save = () => {
        if (JSON.stringify(next) !== JSON.stringify(sent)) alertStore.writeAll(next);
    };
    const due = dueParts(status.parts, sent, now);
    if (!due.length) {
        save();
        return { sent: [] };
    }
    const content = [
        "**Datensicherung: bitte ansehen**",
        ...due.map((p) => `- ${lineFor(p, now)}`),
        "Details auf der Systemstatus-Seite im Web-Admin.",
    ].join("\n");
    let result;
    try {
        result = await send(admin, { content });
    } catch (e) {
        logger.warn(`Sicherungs-Warnung nicht gesendet: ${e.message}`);
        save();
        return { sent: [], skipped: "offline" };
    }
    if (!result || !result.ok) logger.warn(`Sicherungs-Warnung nicht zugestellt: ${result && result.error}`);
    for (const p of due) next[p.key] = { state: p.state, at: now };
    save();
    return { sent: due.map((p) => p.key) };
}

async function tick() {
    try {
        const { sendDirectMessage } = require("../discord/discord");
        const { adminUserId } = require("../../config/env");
        await check({ send: sendDirectMessage, adminId: adminUserId });
    } catch (e) {
        logger.error(`Sicherungs-Überwachung: ${e.message}`);
    }
}

/** Start the check (idempotent). Returns whether it runs: false where snapshots are off for this instance. */
function startBackupAlerts(o = {}) {
    if (timer) return true;
    if (!backupEnabled(o.env || process.env)) return false;
    firstTimer = setTimeout(tick, o.firstDelayMs === undefined ? FIRST_DELAY_MS : o.firstDelayMs);
    timer = setInterval(tick, o.checkMs || CHECK_MS);
    if (firstTimer.unref) firstTimer.unref();
    if (timer.unref) timer.unref();
    return true;
}

function stopBackupAlerts() {
    if (firstTimer) clearTimeout(firstTimer);
    if (timer) clearInterval(timer);
    firstTimer = null;
    timer = null;
}

module.exports = { check, dueParts, lineFor, startBackupAlerts, stopBackupAlerts, _tickForTests: () => tick(), CHECK_MS, FIRST_DELAY_MS, REPEAT_MS };
