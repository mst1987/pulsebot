// The restore probe's schedule (#694): the weekday and time of the settings (default Wednesday 04:30 Europe/Berlin),
// only within the six-hour window after that time of day; catches up a missed week, retries a failed run the next
// morning, never twice in one window; off for dev instances; waits while a snapshot holds its lock.
const fs = require("fs");
const path = require("path");
const { DateTime } = require("luxon");
const { DATA_DIR } = require("../../../src/config/paths");
const job = require("../../../src/services/backup/restoreTestJob");
const { createSnapshot } = require("../../../src/services/backup/snapshot");
const { readRestoreTestStatus } = require("../../../src/services/backup/restoreTest");
const { tempStoreFile } = require("../../helpers/tempStore");

const ZONE = "Europe/Berlin";
const at = (iso) => DateTime.fromISO(iso, { zone: ZONE }).toMillis();
const WED = { weekday: 3, time: "04:30" };
const D = 24 * 3600 * 1000;

describe("windowStart", () => {
    it("is the slot of the day while within six hours after it, else null - in Berlin time, also across DST", () => {
        expect(job.windowStart(at("2026-10-07T04:29"), "04:30")).toBeNull();
        expect(job.windowStart(at("2026-10-07T04:30"), "04:30").toMillis()).toBe(at("2026-10-07T04:30"));
        expect(job.windowStart(at("2026-10-07T10:29"), "04:30").toMillis()).toBe(at("2026-10-07T04:30"));
        expect(job.windowStart(at("2026-10-07T10:30"), "04:30")).toBeNull();
        expect(job.windowStart(at("2026-10-07T21:00"), "04:30")).toBeNull();
        // winter time: 04:30 Berlin is 03:30 UTC
        expect(new Date(job.windowStart(at("2026-11-04T05:00"), "04:30").toMillis()).toISOString()).toBe("2026-11-04T03:30:00.000Z");
    });

    it("handles a window that crosses midnight", () => {
        expect(job.windowStart(at("2026-10-08T01:00"), "22:00").toMillis()).toBe(at("2026-10-07T22:00"));
        expect(job.windowStart(at("2026-10-08T04:00"), "22:00")).toBeNull();
    });
});

describe("isDue", () => {
    const last = (iso, ok = true) => ({ at: new Date(at(iso)).toISOString(), ok });

    it("runs on the configured weekday within the window, once", () => {
        const now = at("2026-10-07T04:40"); // a Wednesday
        expect(job.isDue(now, last("2026-09-30T04:31"), WED)).toBe("weekly");
        expect(job.isDue(now, last("2026-10-07T04:31"), WED)).toBe(false);
        expect(job.isDue(at("2026-10-07T20:00"), last("2026-09-30T04:31"), WED)).toBe(false); // raid evening: never
    });

    it("waits on other days while the last run is younger than a week and passed", () => {
        expect(job.isDue(at("2026-10-06T05:00"), last("2026-09-30T04:31"), WED)).toBe(false); // Tuesday, 6 days
    });

    it("catches up in the next morning window when a week was missed or nothing ran yet", () => {
        expect(job.isDue(at("2026-10-08T05:00"), last("2026-09-30T04:31"), WED)).toBe("overdue"); // Thursday after a missed Wednesday
        expect(job.isDue(at("2026-10-08T05:00"), null, WED)).toBe("never");
        expect(job.isDue(at("2026-10-08T05:00"), { at: "garbage" }, WED)).toBe("never");
        expect(job.isDue(at("2026-10-08T12:00"), null, WED)).toBe(false); // but only within the window
    });

    it("tries a failed run again the next morning", () => {
        expect(job.isDue(at("2026-10-08T04:35"), last("2026-10-07T04:31", false), WED)).toBe("retry");
        expect(job.isDue(at("2026-10-07T05:00"), last("2026-10-07T04:31", false), WED)).toBe(false); // not in the same window
    });

    it("follows the weekday and time of the settings", () => {
        expect(job.isDue(at("2026-10-11T23:30"), last("2026-10-05T00:00"), { weekday: 7, time: "23:00" })).toBe("weekly");
    });
});

describe("the job", () => {
    let backupDir;
    let now;
    const start = (over = {}) => job.startRestoreTestJob({
        env: { BACKUP_ENABLED: "1" }, backupDir, dataDir: DATA_DIR, now: () => now,
        getConfig: () => ({ backup: { restoreTest: WED } }), firstDelayMs: 1000, checkMs: 60 * 1000, ...over,
    });

    beforeEach(async () => {
        backupDir = path.join(path.dirname(tempStoreFile("unused")), "backups");
        fs.mkdirSync(path.join(DATA_DIR, "settings"), { recursive: true });
        fs.writeFileSync(path.join(DATA_DIR, "settings", "events.json"), JSON.stringify({ events: [{ id: "eh-1" }] }));
        const snap = await createSnapshot({ dataDir: DATA_DIR, backupDir, reason: "hourly", now: () => at("2026-10-07T04:00"), retention: null });
        expect(snap.ok).toBe(true);
        now = at("2026-10-07T04:40");
    });
    afterEach(() => {
        job.stopRestoreTestJob();
        jest.useRealTimers();
    });

    it("stays off for a dev instance and starts no timer", () => {
        jest.useFakeTimers();
        expect(start({ env: { EVENTHELPER_ENV_FILE: ".env.dev" } })).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });

    it("runs with BACKUP_ENABLED or on the live bot, once, with unref'd timers, and stops again", () => {
        jest.useFakeTimers();
        expect(start()).toBe(true);
        expect(start()).toBe(true);
        expect(jest.getTimerCount()).toBe(2);
        job.stopRestoreTestJob();
        expect(jest.getTimerCount()).toBe(0);
        expect(start({ env: { NODE_ENV: "production" } })).toBe(true);
    });

    it("probes when its timer fires inside the window, and not again in the same window", async () => {
        jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick", "queueMicrotask", "performance"] });
        start();
        await jest.advanceTimersByTimeAsync(1000);
        // the probe itself runs on real I/O: wait for its status file
        jest.useRealTimers();
        for (let i = 0; i < 200 && !readRestoreTestStatus(backupDir); i += 1) await new Promise((r) => setTimeout(r, 10));
        const first = readRestoreTestStatus(backupDir);
        expect(first).toMatchObject({ ok: true, at: new Date(now).toISOString() });
        now += 30 * 60 * 1000;
        expect(await job._tickForTests()).toBeNull();
        expect(readRestoreTestStatus(backupDir).at).toBe(first.at);
    });

    it("does nothing outside the window and waits while a snapshot holds the lock", async () => {
        start({ firstDelayMs: 10 * 60 * 1000 });
        now = at("2026-10-07T19:30");
        expect(await job._tickForTests()).toBeNull();
        now = at("2026-10-07T04:40");
        fs.writeFileSync(path.join(backupDir, ".snapshot.lock"), "{}");
        expect(await job._tickForTests()).toBeNull();
        fs.rmSync(path.join(backupDir, ".snapshot.lock"));
        expect(await job._tickForTests()).toMatchObject({ ok: true });
        expect(readRestoreTestStatus(backupDir)).toMatchObject({ ok: true });
    });

    it("catches up after a restart when the last probe is over a week old", async () => {
        fs.mkdirSync(path.join(backupDir, "status"), { recursive: true });
        fs.writeFileSync(path.join(backupDir, "status", "restore-test.json"), JSON.stringify({ at: new Date(now - 9 * D).toISOString(), ok: true }));
        now = at("2026-10-08T06:00"); // Thursday morning
        start({ firstDelayMs: 10 * 60 * 1000 });
        expect(await job._tickForTests()).toMatchObject({ ok: true });
    });

    it("falls back to the default slot when the settings cannot be read", async () => {
        start({ getConfig: () => { throw new Error("no config"); }, firstDelayMs: 10 * 60 * 1000 });
        expect(await job._tickForTests()).toMatchObject({ ok: true });
    });
});
