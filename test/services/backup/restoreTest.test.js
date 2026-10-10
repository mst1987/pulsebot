// The weekly restore probe (#694) against real scratch directories: passes for a good snapshot; fails for a missing
// file, broken JSON, a file a store cannot normalise, a store file the snapshot lacks, and counts that dropped; the
// scratch directory is always gone afterwards; the live stores stay on their own files; the status file is what
// backupStatus.js (#696) reads.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DATA_DIR } = require("../../../src/config/paths");
const { createSnapshot, readManifest } = require("../../../src/services/backup/snapshot");
const { countDataDir } = require("../../../src/services/backup/restore");
const { registeredStores } = require("../../../src/stores/jsonStore");
const probe = require("../../../src/services/backup/restoreTest");
const { readParts } = require("../../../src/services/backup/backupStatus");
const { tempStoreFile } = require("../../helpers/tempStore");

const T0 = Date.UTC(2026, 9, 7, 2, 30, 0);
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const events = (n) => JSON.stringify({ events: Array.from({ length: n }, (_, i) => ({ id: `eh-${i}` })) });

let backupDir;
let snapDir;

const fileIn = (dir, rel) => path.join(dir, ...rel.split("/"));
function put(dir, rel, text) {
    const file = fileIn(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
}

/** The manifest after a change to the snapshot's data: entries and counts consistent again. */
async function saveManifest(change) {
    const manifest = readManifest(snapDir);
    change(manifest);
    manifest.counts = await countDataDir(path.join(snapDir, "data"));
    fs.writeFileSync(path.join(snapDir, "manifest.json"), JSON.stringify(manifest));
}

/** Rewrites one file of the snapshot together with its manifest: only what the test breaks is wrong. */
async function rewriteInSnapshot(rel, text) {
    put(path.join(snapDir, "data"), rel, text);
    await saveManifest((m) => { m.files[rel] = { size: Buffer.byteLength(text), sha256: sha(Buffer.from(text)) }; });
}

/** Removes one file from the snapshot and from its manifest, as if it had never been copied. */
async function dropFromSnapshot(rel) {
    fs.rmSync(fileIn(path.join(snapDir, "data"), rel));
    await saveManifest((m) => { delete m.files[rel]; });
}

const scratchLeft = () => fs.readdirSync(backupDir).filter((n) => n.startsWith(probe.SCRATCH_PREFIX));
const run = (o = {}) => probe.runRestoreTest({ backupDir, dataDir: DATA_DIR, now: () => T0 + 60000, ...o });

beforeEach(async () => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    backupDir = path.join(path.dirname(tempStoreFile("unused")), "backups");
    put(DATA_DIR, "settings/events.json", events(12));
    put(DATA_DIR, "settings/signups.json", JSON.stringify({ signups: { "eh-0": { u1: {}, u2: {} } } }));
    put(DATA_DIR, "settings/rosters.json", JSON.stringify({ rosters: [{ id: "r1" }] }));
    put(DATA_DIR, "settings/config.json", JSON.stringify({ guildId: "123456789" }));
    put(DATA_DIR, "sessions.json", JSON.stringify({ sid: {} }));
    put(DATA_DIR, "reports/aaaaaa.json", "{\"id\":\"aaaaaa\"}");
    const snap = await createSnapshot({ dataDir: DATA_DIR, backupDir, reason: "hourly", now: () => T0, retention: null });
    expect(snap.ok).toBe(true);
    snapDir = snap.dir;
});

afterEach(() => {
    // whatever a test did: never a scratch directory left behind
    expect(scratchLeft()).toEqual([]);
});

describe("storeChecks", () => {
    it("finds every store on jsonStore below DATA_DIR, the core ones included, and none elsewhere", () => {
        const rels = probe.storeChecks().map((c) => c.rel);
        expect(rels).toEqual(expect.arrayContaining([
            "settings/events.json", "settings/signups.json", "settings/rosters.json", "settings/config.json", "settings/raidplans.json",
        ]));
        expect(rels.length).toBeGreaterThan(40);
        expect(rels.every((r) => !r.startsWith("..") && !path.isAbsolute(r))).toBe(true);
    });
});

describe("runRestoreTest: passes", () => {
    it("restores the newest snapshot, reads every store, matches the counts and writes the status", async () => {
        const res = await run();
        expect(res.problems).toEqual([]);
        expect(res).toMatchObject({ ok: true, statusWritten: true, at: new Date(T0 + 60000).toISOString() });
        expect(res.snapshot).toMatchObject({ name: path.basename(snapDir), reason: "hourly" });
        expect(res.counts.restored).toEqual(res.counts.snapshot);
        expect(res.counts.snapshot).toMatchObject({ events: 12, signups: 2, rosters: 1, reports: 1, sessions: 1, files: 6 });
        expect(res.counts.live).toMatchObject({ events: 12 });
        expect(res.stores.checked).toBeGreaterThanOrEqual(5);
        expect(res.stores.failed).toBe(0);
        expect(res.files).toBe(6);
        expect(res.bytes).toBeGreaterThan(0);
        expect(res.durationMs).toBeGreaterThanOrEqual(0);
        expect(res.loop).toEqual({ maxMs: expect.any(Number), p99Ms: expect.any(Number), meanMs: expect.any(Number) });
        expect(res.error).toBeUndefined();

        const written = probe.readRestoreTestStatus(backupDir);
        expect(written).toMatchObject({ at: res.at, ok: true, durationMs: res.durationMs, snapshot: res.snapshot, problems: [] });
        expect(Object.keys(written.counts)).toEqual(["snapshot", "restored", "live"]);
        // exactly what the monitoring expects from #694
        const part = readParts({ backupDir, now: T0 + 2 * 3600 * 1000 }).parts.find((p) => p.key === "restoreTest");
        expect(part).toMatchObject({ light: "ok", ok: true, state: "fresh", durationMs: res.durationMs, bytes: res.bytes });
    });

    it("leaves every store on its own file and the live data untouched", async () => {
        const eventStore = require("../../../src/stores/eventStore");
        const before = registeredStores().map((s) => s.file);
        put(DATA_DIR, "settings/events.json", events(11));
        const res = await run();
        expect(res.ok).toBe(true);
        const after = registeredStores();
        expect(after.map((s) => s.file)).toEqual(before);
        for (const store of after) expect(store.file).toBe(store.defaultFile);
        // the live store reads the live file (11 events), not the snapshot's (12)
        expect(eventStore.listEvents()).toHaveLength(11);
    });

    it("skips pre-restore snapshots and removes scratch directories a crashed run left", async () => {
        fs.mkdirSync(path.join(backupDir, `${probe.SCRATCH_PREFIX}dead`, "data"), { recursive: true });
        const later = await createSnapshot({ dataDir: DATA_DIR, backupDir, reason: "pre-restore", now: () => T0 + 1000, retention: null });
        expect(probe.newestSnapshot(backupDir).name).toBe(path.basename(snapDir));
        const res = await run();
        expect(res.ok).toBe(true);
        expect(res.snapshot.name).not.toBe(later.name);
    });
});

describe("runRestoreTest: fails", () => {
    it("for a file missing from the snapshot", async () => {
        fs.rmSync(fileIn(path.join(snapDir, "data"), "settings/rosters.json"));
        const res = await run();
        expect(res.ok).toBe(false);
        expect(res.problems).toEqual([{ rel: "settings/rosters.json", problem: "fehlt" }]);
        expect(res.error).toBe("1 Problem - settings/rosters.json: fehlt");
        expect(probe.readRestoreTestStatus(backupDir)).toMatchObject({ ok: false, error: res.error });
        expect(readParts({ backupDir, now: T0 + 3600 * 1000 }).parts[2]).toMatchObject({ light: "bad", state: "failed" });
    });

    it("for broken JSON", async () => {
        await rewriteInSnapshot("settings/events.json", "{\"events\": [");
        const res = await run();
        expect(res.ok).toBe(false);
        expect(res.problems).toEqual([{ rel: "settings/events.json", problem: "kein gültiges JSON" }]);
    });

    it("for valid JSON that a store's normalize cannot read (no quiet fallback to the defaults)", async () => {
        await rewriteInSnapshot("settings/events.json", "null");
        const res = await run();
        expect(res.ok).toBe(false);
        expect(res.problems).toEqual(expect.arrayContaining([
            expect.objectContaining({ rel: "settings/events.json", problem: expect.stringMatching(/^Der Store liest die Datei nicht: /) }),
        ]));
        expect(res.stores.failed).toBeGreaterThanOrEqual(1);
    });

    it("for a store file the snapshot lacks although it existed live before", async () => {
        await dropFromSnapshot("settings/rosters.json");
        const old = new Date(T0 - 3600 * 1000);
        fs.utimesSync(path.join(DATA_DIR, "settings", "rosters.json"), old, old);
        const res = await run();
        expect(res.ok).toBe(false);
        expect(res.problems).toEqual(expect.arrayContaining([
            { rel: "settings/rosters.json", problem: "Fehlt im Schnappschuss, obwohl die Datei schon vorher existierte" },
        ]));
    });

    it("not for a store file created after the snapshot", async () => {
        await dropFromSnapshot("settings/rosters.json");
        const res = await run();
        expect(res.ok).toBe(true);
    });

    it("for a count more than 20 % below the live one (live at least 10)", async () => {
        put(DATA_DIR, "settings/events.json", events(16));
        const res = await run();
        expect(res.ok).toBe(false);
        expect(res.problems).toEqual([{ rel: "counts.events", problem: "Im Schnappschuss 12, live 16: mehr als 20 % weniger" }]);
    });

    it("not for a drop of 20 % or less, nor below 10 live", async () => {
        put(DATA_DIR, "settings/events.json", events(15));
        expect((await run()).ok).toBe(true);
        const problems = [];
        probe.compareCounts({ snapshot: { events: 0, sessions: 0 }, restored: null, live: { events: 9, sessions: 500 } }, problems);
        expect(problems).toEqual([]);
    });

    it("for restored counts that differ from the manifest", () => {
        const problems = [];
        probe.compareCounts({ snapshot: { events: 3, files: 4 }, restored: { events: 3, files: 2 }, live: null }, problems);
        expect(problems).toEqual([{ rel: "counts.files", problem: "Nach dem Zurückspielen 2 statt 4 laut Manifest" }]);
    });

    it("without any snapshot", async () => {
        fs.rmSync(path.join(backupDir, "snapshots"), { recursive: true, force: true });
        const res = await run();
        expect(res).toMatchObject({ ok: false, error: "1 Problem - Kein Schnappschuss vorhanden", snapshot: null, statusWritten: true });
    });

    it("never throws and still removes the scratch directory after an unexpected error", async () => {
        const res = await run({ stores: () => { throw new Error("boom"); } });
        expect(res.ok).toBe(false);
        expect(res.problems).toEqual([{ rel: "", problem: "Unerwarteter Fehler: boom" }]);
    });

    it("refuses a second run in the same process and writes nothing for it", async () => {
        const [a, b] = await Promise.all([run(), run()]);
        expect(a.ok).toBe(true);
        expect(b).toMatchObject({ ok: false, skipped: "locked" });
    });

    it("lists at most three problems in the error line", () => {
        const problems = [1, 2, 3, 4, 5].map((i) => ({ rel: `f${i}`, problem: "fehlt" }));
        expect(probe.errorLine(problems)).toBe("5 Probleme - f1: fehlt; f2: fehlt; f3: fehlt (und 2 weitere)");
    });
});
