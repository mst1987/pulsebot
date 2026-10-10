// The weekly restore probe as a background job (#694, restoreTest.js, docs/backup.md "Wiederherstellungsprobe").
//
// When: on the weekday and from the time of the settings (`backup.restoreTest`, default Wednesday 04:30 in
// TIMEZONE), and only within RESTORE_TEST_WINDOW_MS (6 h) after that time of day - a night/morning window, never a
// raid evening. Within the window of ANY day it also runs when
//   - it never ran (status/restore-test.json missing),
//   - the last run is 7 days old or older (the bot was down on the day, a deploy hit the window), or
//   - the last run failed (tried again the next morning, so a fixed problem turns green soon).
// Like the snapshot job it looks at the status file, not at its own memory, so a restart neither runs it twice nor
// skips it; a run from the command line counts as well. While a snapshot holds its lock ($BACKUP_DIR/.snapshot.lock)
// the probe waits for the next check, so the two never compete for the disk.
// Off unless backupEnabled() (backupConfig.js) - the same switch as the hourly snapshot. Timers are unref'd.
const fs = require("fs");
const path = require("path");
const { DateTime } = require("luxon");
const { TIMEZONE } = require("../../config/timezone");
const { runRestoreTest, readRestoreTestStatus } = require("./restoreTest");
const { backupEnabled, resolveBackupDir, normalizeBackupSettings, RESTORE_TEST_WINDOW_MS } = require("./backupConfig");
const configStore = require("../../stores/configStore");
const logger = require("../../logger").child("backup");

/** How often the job asks whether a probe is due. */
const CHECK_MS = 10 * 60 * 1000;
/** The first look after the start: the web server, the Discord login and the first snapshot go first. */
const FIRST_DELAY_MS = 5 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let firstTimer = null;
let timer = null;
let options = {};

function settings() {
    try {
        return normalizeBackupSettings((options.getConfig || configStore.getConfig)().backup).restoreTest;
    } catch {
        return normalizeBackupSettings(null).restoreTest;
    }
}

/** The start (ms) of the window `now` lies in, or null outside every window. */
function windowStart(now, time, zone = TIMEZONE) {
    const [hour, minute] = String(time).split(":").map(Number);
    const local = DateTime.fromMillis(now, { zone });
    let start = local.set({ hour, minute, second: 0, millisecond: 0 });
    if (start.toMillis() > now) start = start.minus({ days: 1 }); // a window that began yesterday (late time of day)
    return now - start.toMillis() < RESTORE_TEST_WINDOW_MS ? start : null;
}

/**
 * Whether a probe is due at `now`, given the last status ({ at, ok } or null) and the slot ({ weekday, time }).
 * @returns {false|"weekly"|"never"|"overdue"|"retry"}
 */
function isDue(now, last, slot, zone = TIMEZONE) {
    const start = windowStart(now, slot.time, zone);
    if (!start) return false;
    const lastAt = last && last.at ? new Date(last.at).getTime() : NaN;
    if (!Number.isFinite(lastAt)) return "never";
    if (lastAt >= start.toMillis()) return false; // already ran in this window
    if (start.weekday === slot.weekday) return "weekly";
    if (now - lastAt >= WEEK_MS) return "overdue";
    return last.ok === false ? "retry" : false;
}

function snapshotLocked(backupDir) {
    return fs.existsSync(path.join(backupDir, ".snapshot.lock"));
}

let running = false;

async function tick() {
    if (running) return null;
    running = true;
    try {
        const env = options.env || process.env;
        const backupDir = options.backupDir || resolveBackupDir(env);
        const now = (options.now || Date.now)();
        const why = isDue(now, readRestoreTestStatus(backupDir), settings());
        if (!why || snapshotLocked(backupDir)) return null;
        logger.info(`Wiederherstellungsprobe startet (${why})`);
        return await runRestoreTest({ backupDir, dataDir: options.dataDir, now: options.now });
    } catch (e) {
        logger.error(`Wiederherstellungsprobe-Job: ${e.message}`);
        return null;
    } finally {
        running = false;
    }
}

/**
 * Start the job (idempotent). Returns whether it runs: false when backups are off for this instance.
 * @param {object} [o]
 * @param {object} [o.env]          process.env
 * @param {string} [o.backupDir]    instead of resolveBackupDir(env)
 * @param {string} [o.dataDir]      instead of DATA_DIR
 * @param {Function} [o.getConfig]  instead of configStore.getConfig
 * @param {Function} [o.now]        clock (ms)
 * @param {number} [o.checkMs]      CHECK_MS
 * @param {number} [o.firstDelayMs] FIRST_DELAY_MS
 */
function startRestoreTestJob(o = {}) {
    if (timer) return true;
    options = { ...o };
    if (!backupEnabled(o.env || process.env)) return false;
    firstTimer = setTimeout(tick, o.firstDelayMs === undefined ? FIRST_DELAY_MS : o.firstDelayMs);
    timer = setInterval(tick, o.checkMs || CHECK_MS);
    if (firstTimer.unref) firstTimer.unref();
    if (timer.unref) timer.unref();
    return true;
}

/** Stop the job (idempotent). A probe in progress finishes on its own. */
function stopRestoreTestJob() {
    if (firstTimer) clearTimeout(firstTimer);
    if (timer) clearInterval(timer);
    firstTimer = null;
    timer = null;
}

/** Tests: run the due check once, as the timer would; resolves to the probe's result or null. */
const _tickForTests = () => tick();

module.exports = { startRestoreTestJob, stopRestoreTestJob, isDue, windowStart, _tickForTests, CHECK_MS, FIRST_DELAY_MS, WEEK_MS };
