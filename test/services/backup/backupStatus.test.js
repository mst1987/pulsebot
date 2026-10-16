// The evaluation of the backup status files (#696): traffic-light limits per part, "never" as grey (the off-site copy
// red 26 h after the first known snapshot), the overall light, and the readers over a real scratch directory.
const fs = require("fs");
const path = require("path");
const status = require("../../../src/services/backup/backupStatus");
const { snapshotName } = require("../../../src/services/backup/snapshot");
const { tempStoreFile } = require("../../helpers/tempStore");

const H = 3600 * 1000;
const D = 24 * H;
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
const iso = (ago) => new Date(NOW - ago).toISOString();
const snap = (ago, extra = {}) => ({ at: iso(ago), ok: true, reason: "hourly", durationMs: 900, bytes: 5000, ...extra });
const off = (ago, extra = {}) => ({ at: iso(ago), ok: true, durationMs: 4000, addedBytes: 100, totalBytes: 9000, ...extra });
const lightOf = (res, key) => res.parts.find((p) => p.key === key).light;

describe("evaluate: snapshot and off-site limits", () => {
    it.each([
        [0, "ok"], [25 * H + 59 * 60000, "ok"], [26 * H, "warn"], [47 * H, "warn"], [48 * H, "bad"], [10 * D, "bad"],
    ])("a snapshot %i ms old is %s", (ago, light) => {
        expect(lightOf(status.evaluate({ snapshot: snap(ago), now: NOW }), "snapshot")).toBe(light);
        expect(lightOf(status.evaluate({ offsite: off(ago), now: NOW }), "offsite")).toBe(light);
    });

    it("a failed run is red at any age and carries its error", () => {
        const res = status.evaluate({ snapshot: snap(H, { ok: false, error: "Platte voll" }), now: NOW });
        const part = res.parts[0];
        expect(part).toMatchObject({ light: "bad", ok: false, error: "Platte voll", state: "failed" });
        expect(res.light).toBe("bad");
    });

    it("takes the size from the status: bytes for the snapshot, totalBytes for the off-site copy", () => {
        const res = status.evaluate({ snapshot: snap(H), offsite: off(H), now: NOW });
        expect(res.parts[0].bytes).toBe(5000);
        expect(res.parts[1]).toMatchObject({ bytes: 9000, addedBytes: 100 });
    });
});

describe("evaluate: the restore test", () => {
    it.each([
        [0, "ok"], [7 * D, "ok"], [8 * D, "warn"], [14 * D, "warn"], [15 * D, "bad"], [40 * D, "bad"],
    ])("a restore test %i ms old is %s", (ago, light) => {
        expect(lightOf(status.evaluate({ restoreTest: { at: iso(ago), ok: true }, now: NOW }), "restoreTest")).toBe(light);
    });

    it("is grey, never red, while no restore-test.json exists", () => {
        const res = status.evaluate({ snapshot: snap(H), offsite: off(H), now: NOW });
        expect(res.parts[2]).toMatchObject({ light: "none", state: "never", at: 0 });
        expect(res.light).toBe("ok");
    });
});

describe("evaluate: never ran", () => {
    it("is grey when nothing is known at all", () => {
        const res = status.evaluate({ now: NOW });
        expect(res.parts.map((p) => p.light)).toEqual(["none", "none", "none"]);
        expect(res.light).toBe("none");
    });

    it("keeps the off-site copy grey for 26 h after the first known snapshot, red after that", () => {
        expect(lightOf(status.evaluate({ snapshot: snap(H), firstKnown: NOW - 25 * H, now: NOW }), "offsite")).toBe("none");
        const late = status.evaluate({ snapshot: snap(H), firstKnown: NOW - 27 * H, now: NOW });
        expect(late.parts[1]).toMatchObject({ light: "bad", state: "never" });
        expect(late.light).toBe("bad");
    });
});

describe("overallLight", () => {
    it("is the worst light of the parts that know something", () => {
        expect(status.overallLight([{ light: "ok" }, { light: "none" }, { light: "warn" }])).toBe("warn");
        expect(status.overallLight([{ light: "ok" }, { light: "bad" }, { light: "warn" }])).toBe("bad");
        expect(status.overallLight([{ light: "none" }, { light: "none" }])).toBe("none");
    });
});

describe("readBackupStatus", () => {
    let backupDir;
    beforeEach(() => {
        status._clearSizeCache();
        backupDir = path.join(path.dirname(tempStoreFile("unused")), "backups");
        fs.mkdirSync(path.join(backupDir, "status"), { recursive: true });
    });

    function addSnapshot(ago, reason, files) {
        const dir = path.join(backupDir, "snapshots", snapshotName(NOW - ago, reason));
        fs.mkdirSync(path.join(dir, "data"), { recursive: true });
        if (files) fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ version: 1, commit: "abc1234", files }));
    }
    const write = (name, data) => fs.writeFileSync(path.join(backupDir, "status", name), JSON.stringify(data));

    it("reads the three status files and lists the snapshots newest first with their size from the manifest", () => {
        addSnapshot(5 * H, "hourly", { "a.json": { size: 100 }, "b.json": { size: 50 } });
        addSnapshot(H, "manual", { "a.json": { size: 120 } });
        addSnapshot(30 * 60000, "hourly", null); // no manifest: not complete
        write("snapshot.json", snap(H));
        write("offsite.json", off(2 * H));
        const res = status.readBackupStatus({ backupDir, now: NOW, env: { BACKUP_ENABLED: "1" } });
        expect(res.enabled).toBe(true);
        expect(res.light).toBe("ok");
        expect(res.parts.map((p) => p.light)).toEqual(["ok", "ok", "none"]);
        expect(res.snapshots.map((s) => [s.reason, s.bytes, s.complete])).toEqual([["hourly", 0, false], ["manual", 120, true], ["hourly", 150, true]]);
        expect(res.snapshots[2]).toMatchObject({ files: 2, commit: "abc1234" });
    });

    it("limits the list to the 30 newest", () => {
        for (let i = 0; i < 35; i++) addSnapshot(i * H, "hourly", { "a.json": { size: 1 } });
        expect(status.readBackupStatus({ backupDir, now: NOW }).snapshots).toHaveLength(30);
    });

    it("falls back to the newest snapshot when snapshot.json does not exist yet, and counts the off-site copy from the oldest", () => {
        addSnapshot(50 * H, "hourly", { "a.json": { size: 1 } });
        addSnapshot(2 * H, "hourly", { "a.json": { size: 1 } });
        const res = status.readParts({ backupDir, now: NOW });
        expect(res.parts[0]).toMatchObject({ light: "ok", ok: true });
        expect(res.parts[1].light).toBe("bad");
        expect(res.count).toBe(2);
    });

    it("answers an empty or missing directory with grey parts and no list", () => {
        const res = status.readBackupStatus({ backupDir: path.join(backupDir, "nope"), now: NOW, env: {} });
        expect(res.light).toBe("none");
        expect(res.exists).toBe(false);
        expect(res.snapshots).toEqual([]);
    });
});

describe("the deploy snapshot (#695)", () => {
    const deploy = (ago, extra = {}) => ({
        at: iso(ago), ok: true, exitCode: 0, attempts: 1, fromCommit: "1111111aaaa", toCommit: "2222222BBBB",
        result: { ok: true, name: "20261010-110000-deploy", durationMs: 800, bytes: 4000 }, ...extra,
    });

    it("is null and changes nothing while no deploy wrote the file", () => {
        const res = status.evaluate({ snapshot: snap(H), now: NOW });
        expect(res.deploy).toBeNull();
        expect(res.parts).toHaveLength(3);
    });

    it("is green after a deploy snapshot that worked, with its commits, name and size", () => {
        const res = status.evaluate({ snapshot: snap(H), offsite: off(H), deploy: deploy(2 * D), now: NOW });
        expect(res.deploy).toEqual({
            light: "ok", at: NOW - 2 * D, ok: true, fromCommit: "1111111aaaa", toCommit: "2222222bbbb",
            name: "20261010-110000-deploy", bytes: 4000, durationMs: 800, attempts: 1, error: "",
        });
        expect(res.light).toBe("ok");
    });

    it("turns the overall light yellow, never red, after a failed one - for a week", () => {
        const failed = deploy(H, { ok: false, exitCode: 3, attempts: 2, error: "another snapshot still held the lock", result: null });
        const res = status.evaluate({ snapshot: snap(H), offsite: off(H), deploy: failed, now: NOW });
        expect(res.deploy).toMatchObject({ light: "warn", ok: false, error: "another snapshot still held the lock", name: "", attempts: 2 });
        expect(res.light).toBe("warn");
        expect(res.parts.map((p) => p.light)).toEqual(["ok", "ok", "none"]);
        const old = status.evaluate({ snapshot: snap(H), offsite: off(H), deploy: { ...failed, at: iso(status.DEPLOY_WARN_MS) }, now: NOW });
        expect(old.deploy.light).toBe("none");
        expect(old.light).toBe("ok");
    });

    it("ignores a file without a time and commits that are no hashes", () => {
        expect(status.evalDeploy({ ok: true }, NOW)).toBeNull();
        expect(status.evalDeploy("x", NOW)).toBeNull();
        expect(status.evalDeploy({ at: iso(H), ok: true, fromCommit: "main; rm", toCommit: "" }, NOW)).toMatchObject({ fromCommit: "", toCommit: "", name: "" });
    });

    it("is read from status/deploy-snapshot.json by readParts", () => {
        const backupDir = path.join(path.dirname(tempStoreFile("unused")), "backups");
        fs.mkdirSync(path.join(backupDir, "status"), { recursive: true });
        fs.writeFileSync(path.join(backupDir, "status", "deploy-snapshot.json"), JSON.stringify(deploy(H, { ok: false, error: "timed out" })));
        const res = status.readParts({ backupDir, now: NOW });
        expect(res.deploy).toMatchObject({ light: "warn", error: "timed out" });
        expect(res.light).toBe("warn");
    });
});

describe("the restore probe's status file (#694)", () => {
    it("is read as the restore test part: time, result, size, duration and the error line", () => {
        const backupDir = path.join(path.dirname(tempStoreFile("unused")), "backups");
        fs.mkdirSync(path.join(backupDir, "status"), { recursive: true });
        fs.writeFileSync(path.join(backupDir, "status", "restore-test.json"), JSON.stringify({
            at: iso(D), ok: false, durationMs: 1234, bytes: 999, snapshot: { name: "x" }, problems: [{ rel: "a", problem: "b" }],
            counts: { snapshot: {}, restored: {}, live: {} }, error: "1 Problem - a: b",
        }));
        expect(status.readParts({ backupDir, now: NOW }).parts[2]).toMatchObject({
            light: "bad", state: "failed", ok: false, error: "1 Problem - a: b", bytes: 999, durationMs: 1234,
        });
    });
});
