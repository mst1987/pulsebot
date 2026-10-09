// The hourly snapshot job (#691): off for dev instances, due by the newest hourly snapshot on disk, runSnapshot with
// the settings' retention and the running commit - against real scratch directories.
const fs = require("fs");
const path = require("path");
const job = require("../../../src/services/backup/snapshotJob");
const { listSnapshots, readManifest, snapshotName } = require("../../../src/services/backup/snapshot");
const { tempStoreFile } = require("../../helpers/tempStore");

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 10, 12, 0, 0);

let dataDir;
let backupDir;
let now;

beforeEach(() => {
    const root = path.dirname(tempStoreFile("unused"));
    dataDir = path.join(root, "data");
    backupDir = path.join(root, "backups");
    fs.mkdirSync(path.join(dataDir, "settings"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "settings", "events.json"), JSON.stringify({ events: [{ id: "e1" }] }));
    now = T0;
});
afterEach(() => job.stopBackupJob());

const start = (over = {}) => job.startBackupJob({
    env: { BACKUP_ENABLED: "1" }, backupDir, dataDir, now: () => now, commit: () => "feedbee",
    getConfig: () => ({ backup: { intervalMinutes: 60, retention: { manualKeep: 1 } } }), firstDelayMs: 60 * 60 * 1000, ...over,
});

describe("startBackupJob", () => {
    it("stays off for a dev instance and starts no timer", () => {
        jest.useFakeTimers();
        try {
            expect(start({ env: { EVENTHELPER_ENV_FILE: ".env.dev" } })).toBe(false);
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    it("runs on the live bot, once, with unref'd timers, and stops again", () => {
        jest.useFakeTimers();
        try {
            expect(start({ env: { NODE_ENV: "production" } })).toBe(true);
            expect(start({ env: { NODE_ENV: "production" } })).toBe(true);
            expect(jest.getTimerCount()).toBe(2);
            job.stopBackupJob();
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe("isDue", () => {
    it("is due without an hourly snapshot and once the newest is an interval old (a minute early counts)", () => {
        expect(job.isDue(backupDir, T0, 60)).toBe(true);
        fs.mkdirSync(path.join(backupDir, "snapshots", snapshotName(T0, "hourly")), { recursive: true });
        fs.mkdirSync(path.join(backupDir, "snapshots", snapshotName(T0 + 50 * MIN, "manual")), { recursive: true });
        expect(job.isDue(backupDir, T0 + 58 * MIN, 60)).toBe(false);
        expect(job.isDue(backupDir, T0 + 59 * MIN, 60)).toBe(true);
        expect(job.isDue(backupDir, T0 + 3 * HOUR, 240)).toBe(false);
    });
});

describe("the timer's tick", () => {
    it("takes an hourly snapshot when due and none before the interval is over", async () => {
        start();
        await job._tickForTests();
        expect(listSnapshots(backupDir).map((s) => s.name)).toEqual(["20261010-120000-hourly"]);
        now = T0 + 30 * MIN;
        await job._tickForTests();
        expect(listSnapshots(backupDir)).toHaveLength(1);
        now = T0 + HOUR;
        await job._tickForTests();
        expect(listSnapshots(backupDir).map((s) => s.name)).toEqual(["20261010-120000-hourly", "20261010-130000-hourly"]);
    });
});

describe("runSnapshot", () => {
    it("uses the commit and the settings' retention, also while the timer is off", async () => {
        expect(start({ env: {} })).toBe(false);
        const first = await job.runSnapshot({ reason: "manual" });
        expect(first).toMatchObject({ ok: true, reason: "manual" });
        expect(readManifest(first.dir).commit).toBe("feedbee");
        now = T0 + HOUR;
        const second = await job.runSnapshot({ reason: "manual" });
        expect(second.pruned).toEqual([first.name]);
    });

    it("refuses a second run in the same process while one is going", async () => {
        start({ env: {} });
        const [a, b] = await Promise.all([job.runSnapshot({ reason: "manual" }), job.runSnapshot({ reason: "manual" })]);
        expect(a.ok).toBe(true);
        expect(b).toMatchObject({ ok: false, skipped: "locked" });
    });

    it("never throws, even when the settings and the commit do", async () => {
        start({ env: {}, getConfig: () => { throw new Error("no config"); }, commit: () => { throw new Error("no git"); } });
        const result = await job.runSnapshot({ reason: "deploy", fromCommit: "1111111", toCommit: "2222222" });
        expect(result.ok).toBe(true);
        expect(readManifest(result.dir)).toMatchObject({ commit: "", fromCommit: "1111111", toCommit: "2222222" });
    });
});
