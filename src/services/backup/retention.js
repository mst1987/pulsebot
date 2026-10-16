// Which snapshots stay (#691): grandfather-father-son over the hourly ones, "the newest n" for the rest.
//
// Pure: a list of { name, reason, at } in, the names to keep out. The periods are calendar periods in UTC (the
// snapshot names are UTC too): `dailyDays: 14` keeps the newest hourly snapshot of today and of each of the 13
// days before, `weeklyWeeks` counts ISO weeks (Monday to Sunday), `monthlyMonths` calendar months. A snapshot that
// one rule keeps is kept, whatever the others say, and the newest snapshot of all is always kept - it is what
// `latest` points at.
const { BACKUP_DEFAULTS } = require("./backupConfig");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const dayIndex = (ms) => Math.floor(ms / DAY_MS);
// 1970-01-01 was a Thursday; +3 moves the boundary to Monday.
const weekIndex = (ms) => Math.floor((dayIndex(ms) + 3) / 7);
const monthIndex = (ms) => {
    const d = new Date(ms);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
};

/** The newest snapshot of each period among `list`, for the last `count` periods up to `now`. */
function newestPerPeriod(list, now, count, periodOf) {
    const keep = new Set();
    if (!(count > 0)) return keep;
    const current = periodOf(now);
    const newest = new Map();
    for (const snap of list) {
        const period = periodOf(snap.at);
        if (period > current || current - period >= count) continue;
        const best = newest.get(period);
        if (!best || snap.at > best.at) newest.set(period, snap);
    }
    for (const snap of newest.values()) keep.add(snap.name);
    return keep;
}

/** The newest `count` of `list`. */
function newestN(list, count) {
    return [...list].sort((a, b) => b.at - a.at).slice(0, Math.max(0, count)).map((s) => s.name);
}

/**
 * The names of the snapshots to keep.
 * @param {{ name: string, reason: string, at: number }[]} snapshots
 * @param {number} now  ms
 * @param {object} [retention]  the `retention` block of the backup settings
 * @returns {Set<string>}
 */
function snapshotsToKeep(snapshots, now, retention = BACKUP_DEFAULTS.retention) {
    const r = { ...BACKUP_DEFAULTS.retention, ...(retention || {}) };
    const list = (snapshots || []).filter((s) => s && s.name && Number.isFinite(s.at));
    const keep = new Set();
    const byReason = (reason) => list.filter((s) => s.reason === reason);

    const hourly = byReason("hourly");
    for (const snap of hourly) if (snap.at > now - r.hourlyHours * HOUR_MS) keep.add(snap.name);
    for (const name of newestPerPeriod(hourly, now, r.dailyDays, dayIndex)) keep.add(name);
    for (const name of newestPerPeriod(hourly, now, r.weeklyWeeks, weekIndex)) keep.add(name);
    for (const name of newestPerPeriod(hourly, now, r.monthlyMonths, monthIndex)) keep.add(name);

    for (const name of newestN(byReason("deploy"), r.deployKeep)) keep.add(name);
    for (const name of newestN(byReason("manual"), r.manualKeep)) keep.add(name);
    for (const name of newestN(byReason("pre-restore"), r.preRestoreKeep)) keep.add(name);

    const newest = newestN(list, 1)[0];
    if (newest) keep.add(newest);
    return keep;
}

/** The snapshots `snapshotsToKeep` lets go, oldest first. */
function snapshotsToDelete(snapshots, now, retention) {
    const keep = snapshotsToKeep(snapshots, now, retention);
    return (snapshots || []).filter((s) => s && s.name && !keep.has(s.name)).sort((a, b) => a.at - b.at);
}

module.exports = { snapshotsToKeep, snapshotsToDelete, dayIndex, weekIndex, monthIndex };
