// The bot's hourly snapshot (#691): a background job (src/web/http/jobs.js) that takes one whenever the newest
// hourly snapshot is older than the interval from the settings (`backup.intervalMinutes`, default 60).
//
// It looks at the snapshot directory, not at its own memory, so a restart (every deploy) neither takes an extra
// snapshot nor skips one. Off unless backupEnabled() (backupConfig.js): the live bot by default, a dev instance
// only with BACKUP_ENABLED=1. The timers are unref'd and never started by requiring the module.
//
// runSnapshot() is the one entry for everything else in the process - "Jetzt sichern" on the status page (#696)
// will call it with reason "manual". The CLI (scripts/backup/snapshot.js) calls createSnapshot itself.
const { createSnapshot, listSnapshots } = require("./snapshot");
const { backupEnabled, resolveBackupDir, normalizeBackupSettings } = require("./backupConfig");
const configStore = require("../../stores/configStore");
const logger = require("../../logger").child("backup");

/** How often the job asks whether a snapshot is due. */
const CHECK_MS = 60 * 1000;
/** The first look after the start: the web server and the Discord login go first. */
const FIRST_DELAY_MS = 3 * 60 * 1000;
/** A snapshot this much early still counts as due, so a 60-minute interval does not slip to 61. */
const SLACK_MS = 60 * 1000;

let firstTimer = null;
let timer = null;
let running = null;
let options = {};

function settings() {
    try {
        return normalizeBackupSettings((options.getConfig || configStore.getConfig)().backup);
    } catch {
        return normalizeBackupSettings(null);
    }
}

function currentCommit() {
    try {
        return options.commit ? String(options.commit() || "") : "";
    } catch {
        return "";
    }
}

/** Whether the newest hourly snapshot under `backupDir` is older than `intervalMinutes`. */
function isDue(backupDir, now, intervalMinutes) {
    const hourly = listSnapshots(backupDir).filter((s) => s.reason === "hourly");
    const last = hourly[hourly.length - 1];
    return !last || now - last.at >= intervalMinutes * 60 * 1000 - SLACK_MS;
}

/**
 * One snapshot with the settings' retention and the running commit. Never throws; a second call while one runs
 * in this process gets { ok: false, skipped: "locked" } without touching the disk.
 */
async function runSnapshot({ reason = "manual", fromCommit, toCommit } = {}) {
    if (running) return { ok: false, reason, skipped: "locked", error: "Ein anderer Schnappschuss läuft gerade" };
    const env = options.env || process.env;
    running = createSnapshot({
        reason, fromCommit, toCommit, commit: currentCommit(),
        backupDir: options.backupDir || resolveBackupDir(env),
        dataDir: options.dataDir,
        retention: settings().retention,
        now: options.now,
    }).catch((e) => ({ ok: false, reason, error: e.message })); // createSnapshot never rejects; belt and braces
    try {
        return await running;
    } finally {
        running = null;
    }
}

async function tick() {
    try {
        const env = options.env || process.env;
        const now = (options.now || Date.now)();
        if (running || !isDue(options.backupDir || resolveBackupDir(env), now, settings().intervalMinutes)) return;
        await runSnapshot({ reason: "hourly" });
    } catch (e) {
        logger.error(`Schnappschuss-Job: ${e.message}`);
    }
}

/**
 * Start the job (idempotent). Returns whether it runs: false when snapshots are off for this instance.
 * @param {object} [o]
 * @param {Function} [o.commit]     () => the commit of the running code
 * @param {object} [o.env]          process.env
 * @param {string} [o.backupDir]    instead of resolveBackupDir(env)
 * @param {string} [o.dataDir]      instead of DATA_DIR
 * @param {Function} [o.getConfig]  instead of configStore.getConfig
 * @param {Function} [o.now]        clock (ms)
 * @param {number} [o.checkMs]      CHECK_MS
 * @param {number} [o.firstDelayMs] FIRST_DELAY_MS
 */
function startBackupJob(o = {}) {
    if (timer) return true;
    // Kept even when the job stays off: a "Jetzt sichern" (runSnapshot) still knows the commit.
    options = { ...o };
    if (!backupEnabled(o.env || process.env)) {
        logger.info("Schnappschüsse aus (keine Live-Instanz; einschalten mit BACKUP_ENABLED=1)");
        return false;
    }
    firstTimer = setTimeout(tick, o.firstDelayMs === undefined ? FIRST_DELAY_MS : o.firstDelayMs);
    timer = setInterval(tick, o.checkMs || CHECK_MS);
    if (firstTimer.unref) firstTimer.unref();
    if (timer.unref) timer.unref();
    return true;
}

/** Stop the job (idempotent). A run in progress finishes on its own. */
function stopBackupJob() {
    if (firstTimer) clearTimeout(firstTimer);
    if (timer) clearInterval(timer);
    firstTimer = null;
    timer = null;
}

/** Tests: run the due check once, as the timer would. */
const _tickForTests = () => tick();

module.exports = { startBackupJob, stopBackupJob, runSnapshot, isDue, _tickForTests, CHECK_MS, FIRST_DELAY_MS };
