// The data snapshot (#691) against real scratch directories: the layout contract with #692/#693/#695/#696, the
// one-tick copy of settings/ + sessions.json, hard links for unchanged files, the manifest, lock, space guard,
// failure clean-up, `latest` and pruning.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
    createSnapshot, latestSnapshot, listSnapshots, readManifest, readStatus, snapshotName, parseSnapshotName,
    setLatest, acquireLock, LOCK_NAME,
} = require("../../../src/services/backup/snapshot");
const { writeJsonAtomic } = require("../../../src/stores/jsonStore");
const { tempStoreFile } = require("../../helpers/tempStore");

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 10, 12, 0, 0);
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const posix = process.platform !== "win32";

let root;
let dataDir;
let backupDir;

function write(rel, text) {
    const file = path.join(dataDir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, "data", ...rel.split("/")), "utf8");

const EVENTS = JSON.stringify({ events: [{ id: "e1" }, { id: "e2" }, { id: "e3" }] });
const SIGNUPS = JSON.stringify({ signups: { e1: { u1: {}, u2: {} }, e2: { u3: {} } } });

beforeEach(() => {
    root = path.dirname(tempStoreFile("unused"));
    dataDir = path.join(root, "data");
    backupDir = path.join(root, "backups");
    write("settings/events.json", EVENTS);
    write("settings/signups.json", SIGNUPS);
    write("settings/rosters.json", JSON.stringify({ rosters: { r1: {}, r2: {} } }));
    write("settings/raidplans.json", JSON.stringify({ plans: [{ id: "p1" }] }));
    write("settings/config.json", JSON.stringify({ anthropic: { apiKey: "secret" } }));
    write("settings/.events.json.123.abcd.tmp", "half a write");
    write("sessions.json", JSON.stringify({ sid1: {}, sid2: {} }));
    write("reports/aaaaaa.json", "report a");
    write("reports/bbbbbb.json", "report b");
    write("raidplan-maps/gruul.png", "png bytes");
});

const run = (over = {}) => createSnapshot({ dataDir, backupDir, reason: "hourly", now: () => T0, commit: "abc1234", ...over });

describe("names", () => {
    it("are the UTC time and the reason, and only those parse", () => {
        expect(snapshotName(T0 + 5000, "pre-restore")).toBe("20261010-120005-pre-restore");
        expect(parseSnapshotName("20261010-120005-deploy")).toEqual({ name: "20261010-120005-deploy", reason: "deploy", at: T0 + 5000 });
        expect(parseSnapshotName(".20261010-120005-deploy.part")).toBeNull();
        expect(parseSnapshotName("20261010-120005-weekly")).toBeNull();
    });
});

describe("createSnapshot", () => {
    it("builds snapshots/<name>/ with data/, manifest.json, latest and status as the contract says", async () => {
        const result = await run();
        expect(result).toMatchObject({ ok: true, reason: "hourly", name: "20261010-120000-hourly", files: 9 });
        const dir = path.join(backupDir, "snapshots", "20261010-120000-hourly");
        expect(result.dir).toBe(dir);

        expect(read(dir, "settings/events.json")).toBe(EVENTS);
        expect(read(dir, "sessions.json")).toBe(JSON.stringify({ sid1: {}, sid2: {} }));
        expect(read(dir, "raidplan-maps/gruul.png")).toBe("png bytes");
        expect(fs.existsSync(path.join(dir, "data", "settings", ".events.json.123.abcd.tmp"))).toBe(false);

        const manifest = readManifest(dir);
        expect(Object.keys(manifest)).toEqual(["version", "createdAt", "reason", "commit", "files", "counts"]);
        expect(manifest).toMatchObject({ version: 1, createdAt: "2026-10-10T12:00:00.000Z", reason: "hourly", commit: "abc1234" });
        expect(Object.keys(manifest.files)).toEqual([
            "raidplan-maps/gruul.png", "reports/aaaaaa.json", "reports/bbbbbb.json", "sessions.json",
            "settings/config.json", "settings/events.json", "settings/raidplans.json", "settings/rosters.json", "settings/signups.json",
        ]);
        expect(manifest.files["settings/events.json"]).toEqual({ size: EVENTS.length, sha256: sha(EVENTS) });
        expect(manifest.files["reports/aaaaaa.json"]).toEqual({ size: 8, sha256: sha("report a") });
        expect(manifest.counts).toEqual({ events: 3, signups: 3, rosters: 2, raidplans: 1, reports: 2, raidplanMaps: 1, sessions: 2, files: 9 });
        expect(result.bytes).toBe(Object.values(manifest.files).reduce((s, f) => s + f.size, 0));

        const status = readStatus(backupDir);
        expect(status).toEqual({ at: "2026-10-10T12:00:00.000Z", ok: true, reason: "hourly", durationMs: result.durationMs, bytes: result.bytes });
        expect(latestSnapshot(backupDir)).toEqual({ name: "20261010-120000-hourly", reason: "hourly", at: T0, dir });
        expect(fs.readdirSync(path.join(backupDir, "snapshots"))).toEqual(["20261010-120000-hourly"]);
        expect(fs.existsSync(path.join(backupDir, LOCK_NAME))).toBe(false);
    });

    it("writes fromCommit and toCommit only when given", async () => {
        const result = await run({ reason: "deploy", fromCommit: "1111111", toCommit: "2222222" });
        expect(readManifest(result.dir)).toMatchObject({ reason: "deploy", fromCommit: "1111111", toCommit: "2222222" });
        expect(result.name).toBe("20261010-120000-deploy");
    });

    it("copies settings/ and sessions.json in one tick: a store write after it is in none of them", async () => {
        const live = path.join(dataDir, "settings", "events.json");
        const result = await run({
            hooks: {
                afterSync: () => {
                    writeJsonAtomic(live, { events: [] });
                    writeJsonAtomic(path.join(dataDir, "settings", "signups.json"), { signups: {} });
                    fs.writeFileSync(path.join(dataDir, "sessions.json"), "{}");
                },
            },
        });
        expect(result.ok).toBe(true);
        expect(read(result.dir, "settings/events.json")).toBe(EVENTS);
        expect(read(result.dir, "settings/signups.json")).toBe(SIGNUPS);
        expect(readManifest(result.dir).files["settings/events.json"].sha256).toBe(sha(EVENTS));
        expect(readManifest(result.dir).counts).toMatchObject({ events: 3, signups: 3, sessions: 2 });
        expect(JSON.parse(fs.readFileSync(live, "utf8"))).toEqual({ events: [] });
    });

    it("a write before the run lands whole", async () => {
        writeJsonAtomic(path.join(dataDir, "settings", "events.json"), { events: [{ id: "new" }] });
        const result = await run();
        expect(readManifest(result.dir).counts.events).toBe(1);
    });

    it("hard-links unchanged files to the previous snapshot and takes their sha256 from its manifest", async () => {
        const first = await run();
        // Proof that the hash is not computed again: the second manifest repeats what the first one says.
        const m1 = readManifest(first.dir);
        m1.files["reports/aaaaaa.json"].sha256 = "f".repeat(64);
        fs.writeFileSync(path.join(first.dir, "manifest.json"), JSON.stringify(m1));

        const second = await run({ now: () => T0 + HOUR });
        expect(second).toMatchObject({ ok: true, name: "20261010-130000-hourly", linked: 3, copied: 6 });
        const m2 = readManifest(second.dir);
        expect(m2.files["reports/aaaaaa.json"]).toEqual({ size: 8, sha256: "f".repeat(64) });
        expect(m2.files["reports/bbbbbb.json"]).toEqual({ size: 8, sha256: sha("report b") });

        const a1 = fs.statSync(path.join(first.dir, "data", "reports", "aaaaaa.json"));
        const a2 = fs.statSync(path.join(second.dir, "data", "reports", "aaaaaa.json"));
        expect(a2.ino).toBe(a1.ino);
        expect(a2.nlink).toBeGreaterThanOrEqual(2);
        // settings are always copied, never linked
        const s1 = fs.statSync(path.join(first.dir, "data", "settings", "events.json"));
        const s2 = fs.statSync(path.join(second.dir, "data", "settings", "events.json"));
        expect(s2.ino).not.toBe(s1.ino);
        expect(latestSnapshot(backupDir).name).toBe("20261010-130000-hourly");
    });

    it("copies a changed report and hashes it anew", async () => {
        await run();
        const file = write("reports/aaaaaa.json", "report A, rebuilt");
        fs.utimesSync(file, new Date(T0 + 10 * 60 * 1000), new Date(T0 + 10 * 60 * 1000));
        const second = await run({ now: () => T0 + HOUR });
        expect(second).toMatchObject({ ok: true, linked: 2 });
        expect(read(second.dir, "reports/aaaaaa.json")).toBe("report A, rebuilt");
        expect(readManifest(second.dir).files["reports/aaaaaa.json"]).toEqual({ size: 17, sha256: sha("report A, rebuilt") });
    });

    it("links a file whose content is unchanged although its mtime moved", async () => {
        const first = await run();
        const file = path.join(dataDir, "reports", "bbbbbb.json");
        fs.utimesSync(file, new Date(T0 + 5 * 60 * 1000), new Date(T0 + 5 * 60 * 1000));
        const second = await run({ now: () => T0 + HOUR });
        expect(second.linked).toBe(3);
        const b1 = fs.statSync(path.join(first.dir, "data", "reports", "bbbbbb.json"));
        const b2 = fs.statSync(path.join(second.dir, "data", "reports", "bbbbbb.json"));
        expect(b2.ino).toBe(b1.ino);
    });

    it("copies where the filesystem refuses a hard link", async () => {
        await run();
        const refuse = async () => {
            const e = new Error("cross-device link");
            e.code = "EXDEV";
            throw e;
        };
        const second = await run({ now: () => T0 + HOUR, fsApi: { link: refuse } });
        expect(second).toMatchObject({ ok: true, linked: 0, copied: 9 });
        expect(read(second.dir, "reports/aaaaaa.json")).toBe("report a");
        expect(readManifest(second.dir).files["reports/aaaaaa.json"].sha256).toBe(sha("report a"));
    });

    it("refuses a second run while the first holds the lock, without touching the status", async () => {
        const [a, b] = await Promise.all([run(), run({ reason: "manual" })]);
        expect(a.ok).toBe(true);
        expect(b).toMatchObject({ ok: false, skipped: "locked" });
        expect(readStatus(backupDir)).toMatchObject({ ok: true, reason: "hourly" });
        expect(listSnapshots(backupDir).map((s) => s.name)).toEqual(["20261010-120000-hourly"]);
    });

    it("honours a lock of another live process and takes over a stale one", async () => {
        fs.mkdirSync(backupDir, { recursive: true });
        const lockFile = path.join(backupDir, LOCK_NAME);
        fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, host: require("os").hostname(), at: T0 }));
        expect(await run()).toMatchObject({ ok: false, skipped: "locked" });
        expect(readStatus(backupDir)).toBeNull();

        fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, host: "elsewhere", at: T0 - 3 * HOUR }));
        expect((await run()).ok).toBe(true);
        expect(fs.existsSync(lockFile)).toBe(false);
    });

    it("takes over the lock of a process that is gone", () => {
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(path.join(backupDir, LOCK_NAME), JSON.stringify({ pid: 2147483646, host: require("os").hostname(), at: T0 }));
        const lock = acquireLock(backupDir, T0);
        expect(lock).not.toBeNull();
        expect(acquireLock(backupDir, T0)).toBeNull();
        lock.release();
        expect(fs.existsSync(path.join(backupDir, LOCK_NAME))).toBe(false);
    });

    it("takes no snapshot with less than 10 % free space and says so in the status", async () => {
        const statfs = async () => ({ bsize: 4096, blocks: 1000, bavail: 50 });
        const result = await run({ fsApi: { statfs } });
        expect(result).toMatchObject({ ok: false });
        expect(result.error).toMatch(/Zu wenig freier Speicher: 5 % frei/);
        expect(readStatus(backupDir)).toEqual({
            at: "2026-10-10T12:00:00.000Z", ok: false, reason: "hourly", durationMs: result.durationMs, bytes: 0, error: result.error,
        });
        expect(fs.readdirSync(path.join(backupDir, "snapshots"))).toEqual([]);
    });

    it("removes the .part directory after a failure and leaves latest where it was", async () => {
        const first = await run();
        const failed = await run({ now: () => T0 + HOUR, hooks: { beforeFinish: () => { throw new Error("disk gone"); } } });
        expect(failed).toMatchObject({ ok: false, error: "disk gone" });
        expect(fs.readdirSync(path.join(backupDir, "snapshots"))).toEqual([first.name]);
        expect(latestSnapshot(backupDir).name).toBe(first.name);
        expect(readStatus(backupDir)).toMatchObject({ ok: false, error: "disk gone", reason: "hourly" });
    });

    it("clears a .part directory a crashed run left behind", async () => {
        const stale = path.join(backupDir, "snapshots", ".20261010-110000-hourly.part");
        fs.mkdirSync(path.join(stale, "data"), { recursive: true });
        expect((await run()).ok).toBe(true);
        expect(fs.existsSync(stale)).toBe(false);
    });

    it("refuses a BACKUP_DIR inside DATA_DIR and an unknown reason", async () => {
        const inside = await run({ backupDir: path.join(dataDir, "backups") });
        expect(inside).toMatchObject({ ok: false, error: "BACKUP_DIR und DATA_DIR dürfen nicht ineinander liegen" });
        expect(fs.existsSync(path.join(dataDir, "backups"))).toBe(false);
        const weekly = await run({ reason: "weekly" });
        expect(weekly.ok).toBe(false);
        expect(weekly.error).toMatch(/Unbekannter Anlass "weekly"/);
    });

    it("takes the next second when the name is taken", async () => {
        await run({ reason: "manual" });
        const again = await run({ reason: "manual" });
        expect(again.name).toBe("20261010-120001-manual");
    });

    it("prunes by the retention after a successful run", async () => {
        const first = await run({ reason: "manual" });
        const second = await run({ reason: "manual", now: () => T0 + HOUR, retention: { manualKeep: 1 } });
        expect(second.pruned).toEqual([first.name]);
        expect(listSnapshots(backupDir).map((s) => s.name)).toEqual([second.name]);
    });

    (posix ? it : it.skip)("keeps the backup private: directories 700, files 600", async () => {
        const result = await run();
        const mode = (p) => fs.statSync(p).mode & 0o777;
        expect(mode(backupDir)).toBe(0o700);
        expect(mode(result.dir)).toBe(0o700);
        expect(mode(path.join(result.dir, "data", "settings"))).toBe(0o700);
        expect(mode(path.join(result.dir, "data", "settings", "config.json"))).toBe(0o600);
        expect(mode(path.join(result.dir, "data", "reports", "aaaaaa.json"))).toBe(0o600);
        expect(mode(path.join(result.dir, "manifest.json"))).toBe(0o600);
        expect(mode(path.join(backupDir, "status", "snapshot.json"))).toBe(0o600);
    });

    it("never throws, even for a backup directory that cannot be created", async () => {
        const blocker = path.join(root, "not-a-dir");
        fs.writeFileSync(blocker, "x");
        const result = await run({ backupDir: path.join(blocker, "backups") });
        expect(result.ok).toBe(false);
        expect(result.error).toBeTruthy();
    });
});

describe("latest", () => {
    it("is a symlink where the OS allows one, else a file - latestSnapshot reads both", async () => {
        const result = await run();
        const link = path.join(backupDir, "latest");
        if (result.latest === "symlink") expect(fs.readlinkSync(link).replace(/\\/g, "/")).toBe(`snapshots/${result.name}`);
        else expect(fs.readFileSync(link, "utf8")).toBe(`snapshots/${result.name}\n`);

        const noSymlinks = { ...fs, symlinkSync: () => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); } };
        expect(setLatest(backupDir, result.name, noSymlinks)).toBe("file");
        expect(fs.lstatSync(link).isFile()).toBe(true);
        expect(latestSnapshot(backupDir).name).toBe(result.name);
    });

    it("falls back to the newest finished snapshot when latest is missing or points nowhere", async () => {
        const a = await run();
        const b = await run({ now: () => T0 + HOUR });
        fs.rmSync(path.join(backupDir, "latest"), { force: true });
        expect(latestSnapshot(backupDir).name).toBe(b.name);

        fs.writeFileSync(path.join(backupDir, "latest"), "snapshots/20200101-000000-manual\n");
        expect(latestSnapshot(backupDir).name).toBe(b.name);

        // a directory without manifest (half copied by hand) and a .part directory are no snapshots
        fs.mkdirSync(path.join(backupDir, "snapshots", "20261010-150000-hourly"));
        fs.mkdirSync(path.join(backupDir, "snapshots", ".20261010-160000-hourly.part"));
        expect(latestSnapshot(backupDir).name).toBe(b.name);
        expect(listSnapshots(backupDir).map((s) => s.name)).toEqual([a.name, b.name, "20261010-150000-hourly"]);
    });

    it("is null for an empty or missing backup directory", () => {
        expect(latestSnapshot(path.join(root, "nothing"))).toBeNull();
        expect(readStatus(path.join(root, "nothing"))).toBeNull();
    });
});
