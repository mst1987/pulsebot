// scripts/backup/restore-test.js (#694): the restore probe by hand - arguments, exit codes, the printed lines, and
// one real run against scratch directories.
const fs = require("fs");
const path = require("path");
const { parseArgs, main, summaryLines, USAGE } = require("../../scripts/backup/restore-test");
const { createSnapshot } = require("../../src/services/backup/snapshot");
const { runRestoreTest } = require("../../src/services/backup/restoreTest");
const { DATA_DIR } = require("../../src/config/paths");
const { tempStoreFile } = require("../helpers/tempStore");

const io = () => {
    const lines = { out: [], err: [] };
    return { lines, out: (l) => lines.out.push(l), err: (l) => lines.err.push(l) };
};

describe("parseArgs", () => {
    it("knows --json and --help, nothing else", () => {
        expect(parseArgs([])).toEqual({ json: false, help: false });
        expect(parseArgs(["--json"]).json).toBe(true);
        expect(parseArgs(["-h"]).help).toBe(true);
        expect(() => parseArgs(["--force"])).toThrow("Unbekanntes Argument: --force");
    });
});

describe("main", () => {
    const deps = (result) => ({ runRestoreTest: jest.fn(async () => result), backupDir: () => "/b" });
    const passed = {
        ok: true, files: 3, bytes: 300, durationMs: 40, snapshot: { name: "20261007-023000-hourly", commit: "abcdef123456" },
        stores: { checked: 50, failed: 0, missing: 0 }, counts: { snapshot: { events: 2 }, restored: { events: 2 }, live: { events: 2 } },
        loop: { maxMs: 12.3, p99Ms: 4.1, meanMs: 1 }, problems: [], problemCount: 0,
    };

    it("runs the probe in BACKUP_DIR and exits 0 when it passed", async () => {
        const d = deps(passed);
        const { lines, out, err } = io();
        expect(await main([], { deps: d, out, err })).toBe(0);
        expect(d.runRestoreTest).toHaveBeenCalledWith({ backupDir: "/b" });
        expect(lines.out).toEqual([
            "Bestanden: Schnappschuss 20261007-023000-hourly (abcdef1), 3 Dateien, 300 Bytes, 40 ms",
            "Stores gelesen: 50, davon unlesbar: 0, fehlend: 0",
            "Kennzahlen (Schnappschuss / zurückgespielt / live): events 2/2/2",
            "Event-Loop-Verzögerung: max 12.3 ms, p99 4.1 ms",
        ]);
    });

    it("exits 1 with the problems on stderr when it failed, and 2 for wrong arguments", async () => {
        const { lines, out, err } = io();
        const failed = { ok: false, files: 0, bytes: 0, durationMs: 5, snapshot: null, stores: null, counts: {}, problems: [{ rel: "", problem: "Kein Schnappschuss vorhanden" }], problemCount: 1 };
        expect(await main([], { deps: deps(failed), out, err })).toBe(1);
        expect(lines.err).toEqual(["DURCHGEFALLEN: Schnappschuss -, 0 Dateien, 0 Bytes, 5 ms", "  - Kein Schnappschuss vorhanden"]);
        const d = deps(passed);
        expect(await main(["--prune"], { deps: d, out, err })).toBe(2);
        expect(lines.err).toContain(USAGE);
        expect(d.runRestoreTest).not.toHaveBeenCalled();
        expect(await main(["--help"], { deps: d, out, err })).toBe(0);
    });

    it("prints the result as one JSON line with --json", async () => {
        const { lines, out, err } = io();
        expect(await main(["--json"], { deps: deps(passed), out, err })).toBe(0);
        expect(JSON.parse(lines.out[0])).toMatchObject({ ok: true, files: 3 });
    });

    it("mentions problems beyond the listed ones", () => {
        const lines = summaryLines({ ok: false, files: 0, bytes: 0, durationMs: 0, problems: [{ rel: "a", problem: "b" }], problemCount: 60 });
        expect(lines.slice(-2)).toEqual(["  - a: b", "  ... und 59 weitere"]);
    });

    it("runs a real probe against scratch directories", async () => {
        const backupDir = path.join(path.dirname(tempStoreFile("unused")), "backups");
        fs.mkdirSync(path.join(DATA_DIR, "settings"), { recursive: true });
        fs.writeFileSync(path.join(DATA_DIR, "settings", "events.json"), JSON.stringify({ events: [{ id: "eh-1" }] }));
        expect((await createSnapshot({ dataDir: DATA_DIR, backupDir, reason: "manual", retention: null })).ok).toBe(true);
        const { lines, out, err } = io();
        expect(await main([], { deps: { runRestoreTest, backupDir: () => backupDir }, out, err })).toBe(0);
        expect(lines.out[0]).toMatch(/^Bestanden: Schnappschuss \d{8}-\d{6}-manual/);
        expect(fs.existsSync(path.join(backupDir, "status", "restore-test.json"))).toBe(true);
    });
});
