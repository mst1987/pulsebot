// Where the data snapshots go, whether this process takes them, and the schedule and retention from the settings
// (#691, docs/data-storage.md "Sichern und Wiederherstellen").
//
//   BACKUP_DIR      env; a relative value is taken from the repository root. Unset: /var/backups/pulsebot on the
//                   live Linux server, <repo>/../pulsebot-backups everywhere else (Windows, a dev checkout) - in
//                   both cases outside the repository and outside DATA_DIR.
//   BACKUP_ENABLED  env; "1"/"true" on, "0"/"false" off. Unset: on for the live bot (config/runMode.js), off for a
//                   dev or test instance, so a worktree does not fill a disk with snapshots nobody asked for.
//
// Schedule and retention are settings (config.json key `backup`, configSchema.js), not env: they may change
// without a restart. Only the defaults and the normaliser live here, so configSchema can use them without a cycle.
const path = require("path");
const { REPO_ROOT } = require("../../config/paths");
const { isLiveInstance } = require("../../config/runMode");

const SERVER_BACKUP_DIR = "/var/backups/pulsebot";

/** The snapshot directory for an environment - pure, so tests need no re-require. */
function resolveBackupDir(env = process.env, platform = process.platform) {
    const override = String((env && env.BACKUP_DIR) || "").trim();
    if (override) return path.resolve(REPO_ROOT, override);
    if (platform !== "win32" && isLiveInstance(env)) return SERVER_BACKUP_DIR;
    return path.resolve(REPO_ROOT, "..", "pulsebot-backups");
}

/** Whether the bot takes its hourly snapshots: BACKUP_ENABLED wins, else only the live bot. */
function backupEnabled(env = process.env) {
    const flag = String((env && env.BACKUP_ENABLED) || "").trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(flag)) return true;
    if (["0", "false", "no", "off"].includes(flag)) return false;
    return isLiveInstance(env);
}

/**
 * The `backup` block of config.json. Retention is grandfather-father-son over the hourly snapshots (every
 * hourly one of the last `hourlyHours`, the newest of each of the last `dailyDays` days, `weeklyWeeks` weeks and
 * `monthlyMonths` months, UTC), plus the newest `deployKeep` deploy snapshots, `manualKeep` manual ones and
 * `preRestoreKeep` taken before a restore.
 */
const BACKUP_DEFAULTS = Object.freeze({
    intervalMinutes: 60,
    retention: Object.freeze({
        hourlyHours: 48,
        dailyDays: 14,
        weeklyWeeks: 8,
        monthlyMonths: 12,
        deployKeep: 10,
        manualKeep: 10,
        preRestoreKeep: 10,
    }),
    // The weekly restore probe (#694, restoreTest.js): ISO weekday (1 = Monday ... 7 = Sunday) and the time of day
    // in TIMEZONE (config/timezone.js). The probe only ever starts within RESTORE_TEST_WINDOW_MS after that time of
    // day - a night/morning window, never a raid evening - also when it catches up a missed week.
    restoreTest: Object.freeze({ weekday: 3, time: "04:30" }),
});

/** How long after the configured time of day the restore probe may still start (also when it catches up). */
const RESTORE_TEST_WINDOW_MS = 6 * 60 * 60 * 1000;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** The `restoreTest` block: a weekday 1-7 and an "HH:MM", each falling back to its default on its own. */
function normalizeRestoreTest(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const weekday = Number(src.weekday);
    const time = TIME_RE.exec(String(src.time === undefined || src.time === null ? "" : src.time).trim());
    return {
        weekday: Number.isInteger(weekday) && weekday >= 1 && weekday <= 7 ? weekday : BACKUP_DEFAULTS.restoreTest.weekday,
        time: time ? `${time[1].padStart(2, "0")}:${time[2]}` : BACKUP_DEFAULTS.restoreTest.time,
    };
}

// Bounds that keep a typo from deleting everything or snapshotting every second.
const LIMITS = {
    intervalMinutes: [15, 24 * 60],
    hourlyHours: [1, 24 * 14],
    dailyDays: [0, 366],
    weeklyWeeks: [0, 260],
    monthlyMonths: [0, 120],
    deployKeep: [1, 100],
    manualKeep: [1, 100],
    preRestoreKeep: [1, 100],
};

function bounded(value, key, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    const [min, max] = LIMITS[key];
    return Math.min(max, Math.max(min, n));
}

/** A stored `backup` block over the defaults, every number whole and within its bounds. */
function normalizeBackupSettings(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const ret = src.retention && typeof src.retention === "object" && !Array.isArray(src.retention) ? src.retention : {};
    const retention = {};
    for (const [key, fallback] of Object.entries(BACKUP_DEFAULTS.retention)) {
        retention[key] = ret[key] === undefined || ret[key] === null || ret[key] === "" ? fallback : bounded(ret[key], key, fallback);
    }
    const interval = src.intervalMinutes;
    return {
        intervalMinutes: interval === undefined || interval === null || interval === ""
            ? BACKUP_DEFAULTS.intervalMinutes
            : bounded(interval, "intervalMinutes", BACKUP_DEFAULTS.intervalMinutes),
        retention,
        restoreTest: normalizeRestoreTest(src.restoreTest),
    };
}

module.exports = {
    resolveBackupDir, backupEnabled, normalizeBackupSettings, normalizeRestoreTest, BACKUP_DEFAULTS, SERVER_BACKUP_DIR, RESTORE_TEST_WINDOW_MS,
};
