// Which snapshots stay (#691): grandfather-father-son over the hourly ones, "the newest n" for the rest - against
// fixed points in time (now = Saturday 2026-10-10 12:00 UTC, ISO week from Monday 2026-10-05).
const { snapshotsToKeep, snapshotsToDelete, dayIndex, weekIndex, monthIndex } = require("../../../src/services/backup/retention");
const { snapshotName, parseSnapshotName } = require("../../../src/services/backup/snapshot");

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
const snap = (ms, reason = "hourly") => parseSnapshotName(snapshotName(ms, reason));

/** One hourly snapshot every full hour from 2025-09-01 up to and including NOW. */
function hourlySeries() {
    const out = [];
    for (let t = Date.UTC(2025, 8, 1, 0, 0, 0); t <= NOW; t += HOUR) out.push(snap(t));
    return out;
}

describe("period indexes", () => {
    it("count UTC days, ISO weeks from Monday and calendar months", () => {
        expect(dayIndex(Date.UTC(1970, 0, 2, 0, 0, 0)) - dayIndex(Date.UTC(1970, 0, 1, 23, 59, 59))).toBe(1);
        // Sunday 2026-08-16 and Monday 2026-08-17 lie in two weeks, Monday 08-10 and Sunday 08-16 in one
        expect(weekIndex(Date.UTC(2026, 7, 17, 0)) - weekIndex(Date.UTC(2026, 7, 16, 23))).toBe(1);
        expect(weekIndex(Date.UTC(2026, 7, 10, 0))).toBe(weekIndex(Date.UTC(2026, 7, 16, 23)));
        expect(monthIndex(Date.UTC(2026, 9, 1)) - monthIndex(Date.UTC(2025, 9, 31))).toBe(12);
    });
});

describe("snapshotsToKeep (hourly, GFS)", () => {
    const keep = snapshotsToKeep(hourlySeries(), NOW);

    it("keeps every hourly snapshot of the last 48 hours", () => {
        expect(keep.has("20261010-120000-hourly")).toBe(true);
        expect(keep.has("20261008-130000-hourly")).toBe(true);
        expect(keep.has("20261008-120000-hourly")).toBe(false);
    });

    it("keeps the newest of each of the last 14 days", () => {
        expect(keep.has("20261007-230000-hourly")).toBe(true);
        expect(keep.has("20261007-220000-hourly")).toBe(false);
        expect(keep.has("20260928-230000-hourly")).toBe(true);
        expect(keep.has("20260928-220000-hourly")).toBe(false);
        // 14 days back: no longer a daily one, and not the newest of its week (Sunday 09-27 is)
        expect(keep.has("20260926-230000-hourly")).toBe(false);
    });

    it("keeps the newest of each of the last 8 ISO weeks", () => {
        expect(keep.has("20260920-230000-hourly")).toBe(true); // Sunday
        expect(keep.has("20260919-230000-hourly")).toBe(false); // Saturday of the same week
        expect(keep.has("20260823-230000-hourly")).toBe(true); // 8th week back
        expect(keep.has("20260816-230000-hourly")).toBe(false); // 9th week back, not a month's last
    });

    it("keeps the newest of each of the last 12 months", () => {
        expect(keep.has("20260831-230000-hourly")).toBe(true);
        expect(keep.has("20260331-230000-hourly")).toBe(true);
        expect(keep.has("20260330-230000-hourly")).toBe(false);
        expect(keep.has("20251130-230000-hourly")).toBe(true);
        expect(keep.has("20251031-230000-hourly")).toBe(false); // 12 months back
    });

    it("keeps 48 hourly + 11 daily + 5 weekly + 10 monthly snapshots", () => {
        expect(keep.size).toBe(74);
    });

    it("follows the retention it is given", () => {
        const small = snapshotsToKeep(hourlySeries(), NOW, { hourlyHours: 2, dailyDays: 0, weeklyWeeks: 0, monthlyMonths: 0 });
        expect([...small].sort()).toEqual(["20261010-110000-hourly", "20261010-120000-hourly"]);
    });
});

describe("snapshotsToKeep (deploy, manual, pre-restore)", () => {
    const series = (reason, n) => Array.from({ length: n }, (_, i) => snap(NOW - (n - i) * 24 * HOUR, reason));

    it("keeps the newest n of each reason, independent of the hourly rules", () => {
        const list = [...series("deploy", 12), ...series("manual", 11), ...series("pre-restore", 3)];
        const del = snapshotsToDelete(list, NOW, { deployKeep: 10, manualKeep: 10, preRestoreKeep: 10 });
        expect(del.map((s) => s.name)).toEqual([
            snapshotName(NOW - 12 * 24 * HOUR, "deploy"),
            snapshotName(NOW - 11 * 24 * HOUR, "deploy"),
            snapshotName(NOW - 11 * 24 * HOUR, "manual"),
        ]);
    });

    it("always keeps the newest snapshot of all, however old", () => {
        const old = snap(Date.UTC(2020, 0, 1), "hourly");
        expect([...snapshotsToKeep([old], NOW)]).toEqual([old.name]);
        expect(snapshotsToDelete([], NOW)).toEqual([]);
    });
});
