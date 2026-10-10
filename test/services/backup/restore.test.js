// The restore (#693) against real scratch directories: the check of a snapshot (sha256, size, JSON, missing files,
// unsafe paths), the plan (create / update / unchanged / extra), dry run, --only, --prune, modes, the counts
// before/after, a snapshot outside BACKUP_DIR (what restic brings back) and a failure before the swap.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createSnapshot, readManifest } = require("../../../src/services/backup/snapshot");
const {
    verifySnapshot, restoreSnapshot, countDataDir, listDataFiles, normalizeOnly, matchesOnly, isSafeRel, summaryLine,
} = require("../../../src/services/backup/restore");
const { tempStoreFile } = require("../../helpers/tempStore");

const T0 = Date.UTC(2026, 0, 5, 12, 0, 0);
const posix = process.platform !== "win32";
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

let root;
let dataDir;
let backupDir;
let snapDir;

const fileIn = (dir, rel) => path.join(dir, ...rel.split("/"));
function put(dir, rel, text) {
    const file = fileIn(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
}
const get = (dir, rel) => fs.readFileSync(fileIn(dir, rel), "utf8");

const EVENTS = JSON.stringify({ events: [{ id: "e1" }, { id: "e2" }, { id: "e3" }] });
const SIGNUPS = JSON.stringify({ signups: { e1: { u1: {}, u2: {} }, e2: { u3: {} } } });
const ROSTERS = JSON.stringify({ rosters: { r1: {}, r2: {} } });

/** Every file below `dir` with its content, for "nothing changed" comparisons. */
function treeOf(dir) {
    const out = {};
    const walk = (d, rel) => {
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const ent of entries) {
            const r = rel ? `${rel}/${ent.name}` : ent.name;
            if (ent.isDirectory()) walk(path.join(d, ent.name), r);
            else out[r] = fs.readFileSync(path.join(d, ent.name), "utf8");
        }
    };
    walk(dir, "");
    return out;
}

/** Rewrites one file of the snapshot and its manifest entry, so only what the test breaks on purpose is wrong. */
function rewriteInSnapshot(rel, text) {
    put(path.join(snapDir, "data"), rel, text);
    const manifest = readManifest(snapDir);
    manifest.files[rel] = { size: Buffer.byteLength(text), sha256: sha(Buffer.from(text)) };
    fs.writeFileSync(path.join(snapDir, "manifest.json"), JSON.stringify(manifest));
}

beforeEach(async () => {
    root = path.dirname(tempStoreFile("unused"));
    dataDir = path.join(root, "data");
    backupDir = path.join(root, "backups");
    put(dataDir, "settings/events.json", EVENTS);
    put(dataDir, "settings/signups.json", SIGNUPS);
    put(dataDir, "settings/rosters.json", ROSTERS);
    put(dataDir, "settings/config.json", JSON.stringify({ anthropic: { apiKey: "secret" } }));
    put(dataDir, "sessions.json", JSON.stringify({ sid1: {}, sid2: {} }));
    put(dataDir, "reports/aaaaaa.json", "{\"id\":\"a\"}");
    put(dataDir, "raidplan-maps/gruul.png", "png bytes");
    const snap = await createSnapshot({ dataDir, backupDir, reason: "hourly", now: () => T0, retention: null });
    expect(snap.ok).toBe(true);
    snapDir = snap.dir;
});

describe("helpers", () => {
    it("normalises --only paths and matches files and directories", () => {
        expect(normalizeOnly(".\\data\\settings\\rosters.json")).toBe("settings/rosters.json");
        expect(normalizeOnly("reports/")).toBe("reports");
        expect(matchesOnly("reports/a.json", ["reports"])).toBe(true);
        expect(matchesOnly("reports-old/a.json", ["reports"])).toBe(false);
        expect(matchesOnly("x", [])).toBe(true);
    });

    it("accepts only relative paths that stay inside data/", () => {
        expect(isSafeRel("settings/a.json")).toBe(true);
        for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:/x", "a\\b", "", "a//b", "./a"]) expect(isSafeRel(bad)).toBe(false);
    });

    it("lists a data directory without temporary store files and counts it like the manifest does", async () => {
        put(dataDir, "settings/.events.json.1.ab.tmp", "half");
        expect(await listDataFiles(dataDir)).toEqual([
            "raidplan-maps/gruul.png", "reports/aaaaaa.json", "sessions.json", "settings/config.json",
            "settings/events.json", "settings/rosters.json", "settings/signups.json",
        ]);
        expect(await countDataDir(dataDir)).toEqual(readManifest(snapDir).counts);
        expect(await countDataDir(path.join(root, "nothing"))).toMatchObject({ events: 0, files: 0 });
    });
});

describe("verifySnapshot", () => {
    it("passes a sound snapshot", async () => {
        const v = await verifySnapshot(snapDir);
        expect(v).toMatchObject({ ok: true, dir: snapDir, problems: [], checked: 7 });
        expect(v.rels).toHaveLength(7);
        expect(v.bytes).toBe(Object.values(readManifest(snapDir).files).reduce((s, f) => s + f.size, 0));
    });

    it("finds a checksum error, a broken JSON file and a missing file", async () => {
        put(path.join(snapDir, "data"), "raidplan-maps/gruul.png", "PNG BYTES"); // same size, other content
        rewriteInSnapshot("settings/rosters.json", "{\"rosters\": {"); // matches the manifest, but no JSON
        fs.rmSync(fileIn(path.join(snapDir, "data"), "reports/aaaaaa.json"));
        const v = await verifySnapshot(snapDir);
        expect(v.ok).toBe(false);
        expect(v.problems).toEqual([
            { rel: "raidplan-maps/gruul.png", problem: "Prüfsumme weicht ab" },
            { rel: "reports/aaaaaa.json", problem: "fehlt" },
            { rel: "settings/rosters.json", problem: "kein gültiges JSON" },
        ]);
        expect(v.checked).toBe(4);
    });

    it("finds a wrong size, a manifest without files, an unsafe path and an unknown version", async () => {
        put(path.join(snapDir, "data"), "sessions.json", "{}");
        expect((await verifySnapshot(snapDir)).problems).toEqual([{ rel: "sessions.json", problem: expect.stringMatching(/^Größe 2 statt \d+ Bytes$/) }]);

        const manifest = readManifest(snapDir);
        fs.writeFileSync(path.join(snapDir, "manifest.json"), JSON.stringify({ ...manifest, files: { "../escape.json": { size: 1, sha256: sha("x") } } }));
        expect((await verifySnapshot(snapDir)).problems).toEqual([{ rel: "../escape.json", problem: "ungültiger Pfad im Manifest" }]);

        fs.writeFileSync(path.join(snapDir, "manifest.json"), JSON.stringify({ version: 9 }));
        expect((await verifySnapshot(snapDir)).problems.map((p) => p.problem)).toEqual([
            "unbekannte Version 9 (erwartet 1)", "ohne Dateiliste (files)",
        ]);
        fs.writeFileSync(path.join(snapDir, "manifest.json"), "{");
        expect((await verifySnapshot(snapDir)).problems).toEqual([{ rel: "manifest.json", problem: "kein gültiges JSON" }]);
        expect((await verifySnapshot(path.join(root, "nowhere"))).problems).toEqual([{ rel: "manifest.json", problem: "fehlt" }]);
    });

    it("checks only the --only files and names an --only the snapshot does not know", async () => {
        put(path.join(snapDir, "data"), "raidplan-maps/gruul.png", "PNG BYTES");
        const v = await verifySnapshot(snapDir, { only: ["settings/rosters.json"] });
        expect(v).toMatchObject({ ok: true, rels: ["settings/rosters.json"], checked: 1, only: ["settings/rosters.json"] });
        const unknown = await verifySnapshot(snapDir, { only: ["settings/nope.json"] });
        expect(unknown.ok).toBe(false);
        expect(unknown.problems).toEqual([{ rel: "settings/nope.json", problem: "nicht im Schnappschuss" }]);
    });
});

describe("restoreSnapshot", () => {
    function damage() {
        put(dataDir, "settings/rosters.json", JSON.stringify({ rosters: {} }));
        put(dataDir, "settings/events.json", JSON.stringify({ events: [{ id: "e1" }] }));
        fs.rmSync(fileIn(dataDir, "reports/aaaaaa.json"));
        put(dataDir, "settings/new-since.json", "{}");
    }

    it("plays the snapshot back, lists extra files without deleting them and counts before/after", async () => {
        damage();
        const r = await restoreSnapshot({ snapshotDir: snapDir, dataDir });
        expect(r).toMatchObject({ ok: true, dryRun: false, created: 1, updated: 2, unchanged: 4, deleted: 0, extra: ["settings/new-since.json"] });
        expect(r.changes).toEqual([
            { rel: "reports/aaaaaa.json", action: "create", size: 10 },
            { rel: "settings/events.json", action: "update", size: EVENTS.length },
            { rel: "settings/rosters.json", action: "update", size: ROSTERS.length },
        ]);
        expect(r.countsBefore).toMatchObject({ events: 1, rosters: 0, reports: 0, files: 7 });
        expect(r.countsAfter).toMatchObject({ events: 3, rosters: 2, reports: 1, files: 8 });
        expect(r.countsSnapshot).toEqual(readManifest(snapDir).counts);
        expect(r.bytesWritten).toBe(10 + EVENTS.length + ROSTERS.length);
        expect(get(dataDir, "settings/rosters.json")).toBe(ROSTERS);
        expect(get(dataDir, "reports/aaaaaa.json")).toBe("{\"id\":\"a\"}");
        expect(get(dataDir, "settings/new-since.json")).toBe("{}");
        expect((await listDataFiles(dataDir)).length).toBe(8); // no temporary file left
        expect(fs.readdirSync(fileIn(dataDir, "settings")).filter((n) => n.endsWith(".tmp"))).toEqual([]);
        expect(summaryLine(r)).toBe("2 geändert, 1 neu, 4 unverändert, 1 nur im Ziel");
    });

    it("changes nothing on a dry run but says what it would do", async () => {
        damage();
        const before = treeOf(dataDir);
        const r = await restoreSnapshot({ snapshotDir: snapDir, dataDir, dryRun: true, prune: true });
        expect(r).toMatchObject({ ok: true, dryRun: true, created: 1, updated: 2, deleted: 1, countsAfter: null });
        expect(r.changes.map((c) => c.action)).toEqual(["create", "update", "update", "delete"]);
        expect(treeOf(dataDir)).toEqual(before);
    });

    it("restores only the --only file", async () => {
        damage();
        const r = await restoreSnapshot({ snapshotDir: snapDir, dataDir, only: ["settings/rosters.json"] });
        expect(r).toMatchObject({ ok: true, updated: 1, created: 0, unchanged: 0, extra: [] });
        expect(get(dataDir, "settings/rosters.json")).toBe(ROSTERS);
        expect(get(dataDir, "settings/events.json")).toBe(JSON.stringify({ events: [{ id: "e1" }] }));
        expect(fs.existsSync(fileIn(dataDir, "reports/aaaaaa.json"))).toBe(false);
    });

    it("deletes extra files only with prune, and only within --only", async () => {
        damage();
        put(dataDir, "reports/zzz.json", "{}");
        const scoped = await restoreSnapshot({ snapshotDir: snapDir, dataDir, only: ["reports"], prune: true });
        expect(scoped).toMatchObject({ ok: true, created: 1, deleted: 1, extra: ["reports/zzz.json"] });
        expect(fs.existsSync(fileIn(dataDir, "reports/zzz.json"))).toBe(false);
        expect(fs.existsSync(fileIn(dataDir, "settings/new-since.json"))).toBe(true);

        const all = await restoreSnapshot({ snapshotDir: snapDir, dataDir, prune: true });
        expect(all).toMatchObject({ ok: true, deleted: 1, extra: ["settings/new-since.json"] });
        expect(fs.existsSync(fileIn(dataDir, "settings/new-since.json"))).toBe(false);
        expect(treeOf(dataDir)).toEqual(treeOf(path.join(snapDir, "data")));
    });

    it("refuses a damaged snapshot and leaves the target as it was", async () => {
        damage();
        put(path.join(snapDir, "data"), "raidplan-maps/gruul.png", "PNG BYTES");
        const before = treeOf(dataDir);
        const r = await restoreSnapshot({ snapshotDir: snapDir, dataDir });
        expect(r.ok).toBe(false);
        expect(r.error).toBe("Schnappschuss fehlerhaft (1 Problem), nichts zurückgespielt");
        expect(r.problems).toEqual([{ rel: "raidplan-maps/gruul.png", problem: "Prüfsumme weicht ab" }]);
        expect(treeOf(dataDir)).toEqual(before);

        rewriteInSnapshot("settings/signups.json", "not json");
        const broken = await restoreSnapshot({ snapshotDir: snapDir, dataDir, only: ["settings"] });
        expect(broken.ok).toBe(false);
        expect(broken.problems).toEqual([{ rel: "settings/signups.json", problem: "kein gültiges JSON" }]);
        expect(treeOf(dataDir)).toEqual(before);
    });

    it("stops before the swap when a file changed after the check, without leftovers", async () => {
        damage();
        const verification = await verifySnapshot(snapDir);
        put(path.join(snapDir, "data"), "settings/rosters.json", ROSTERS.replace("r1", "r9"));
        const before = treeOf(dataDir);
        const r = await restoreSnapshot({ snapshotDir: snapDir, dataDir, verification });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/^settings\/rosters\.json: die Kopie hat eine andere Prüfsumme/);
        expect(treeOf(dataDir)).toEqual(before);
    });

    it("restores from a directory outside BACKUP_DIR, as restic brings it back, into an empty data directory", async () => {
        const stage = path.join(root, "restore", "var", "backups", "pulsebot", "offsite-stage", "latest");
        fs.cpSync(snapDir, stage, { recursive: true });
        const fresh = path.join(root, "new-server", "data");
        const r = await restoreSnapshot({ snapshotDir: stage, dataDir: fresh });
        expect(r).toMatchObject({ ok: true, created: 7, updated: 0 });
        expect(r.countsBefore).toMatchObject({ events: 0, files: 0 });
        expect(r.countsAfter).toEqual(readManifest(snapDir).counts);
        expect(treeOf(fresh)).toEqual(treeOf(path.join(snapDir, "data")));
    });

    it("copies instead of linking, so a store writing in place never changes the snapshot", async () => {
        const fresh = path.join(root, "copy", "data");
        await restoreSnapshot({ snapshotDir: snapDir, dataDir: fresh });
        fs.writeFileSync(fileIn(fresh, "sessions.json"), "{\"changed\":1}");
        expect(get(path.join(snapDir, "data"), "sessions.json")).toBe(JSON.stringify({ sid1: {}, sid2: {} }));
    });

    it("refuses nested directories and a missing snapshot argument", async () => {
        expect((await restoreSnapshot({ snapshotDir: snapDir, dataDir: path.join(snapDir, "data") })).error)
            .toBe("Schnappschuss und Datenverzeichnis dürfen nicht ineinander liegen");
        expect((await restoreSnapshot({ dataDir })).error).toBe("Kein Schnappschuss angegeben");
    });

    (posix ? it : it.skip)("keeps the mode of a replaced file and gives a new sensitive file 600", async () => {
        fs.chmodSync(fileIn(dataDir, "settings/rosters.json"), 0o640);
        put(dataDir, "settings/rosters.json", "{}");
        fs.rmSync(fileIn(dataDir, "sessions.json"));
        fs.rmSync(fileIn(dataDir, "reports/aaaaaa.json"));
        fs.rmSync(fileIn(dataDir, "raidplan-maps"), { recursive: true });
        expect((await restoreSnapshot({ snapshotDir: snapDir, dataDir })).ok).toBe(true);
        const mode = (rel) => fs.statSync(fileIn(dataDir, rel)).mode & 0o777;
        expect(mode("settings/rosters.json")).toBe(0o640);
        expect(mode("sessions.json")).toBe(0o600);
        expect(mode("reports/aaaaaa.json")).toBe(0o644);
        expect(fs.statSync(fileIn(dataDir, "raidplan-maps")).mode & 0o777).toBe(0o700);
    });
});
