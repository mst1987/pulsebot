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
});

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
    };
}

module.exports = { resolveBackupDir, backupEnabled, normalizeBackupSettings, BACKUP_DEFAULTS, SERVER_BACKUP_DIR };
