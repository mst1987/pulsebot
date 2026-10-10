// scripts/backup/list.js (#693): the local snapshots with time, reason, size and counts, newest first.
const fs = require("fs");
const path = require("path");
const { parseArgs, collect, formatTable, main, USAGE } = require("../../scripts/backup/list");
const snapshot = require("../../src/services/backup/snapshot");
const { tempStoreFile } = require("../helpers/tempStore");

const T0 = Date.UTC(2026, 0, 5, 12, 0, 0);
let root;
let dataDir;
let backupDir;

beforeEach(async () => {
    root = path.dirname(tempStoreFile("unused"));
    dataDir = path.join(root, "data");
    backupDir = path.join(root, "backups");
    fs.mkdirSync(path.join(dataDir, "settings"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "settings", "events.json"), JSON.stringify({ events: [{ id: "e1" }, { id: "e2" }] }));
    await snapshot.createSnapshot({ dataDir, backupDir, reason: "hourly", now: () => T0, retention: null, commit: "abc1234" });
    await snapshot.createSnapshot({ dataDir, backupDir, reason: "manual", now: () => T0 + 3600000, retention: null });
});

const io = () => {
    const lines = { out: [], err: [] };
    return { lines, out: (l) => lines.out.push(l), err: (l) => lines.err.push(l) };
};
const deps = () => ({ ...snapshot, backupDir: () => backupDir });

describe("backup list", () => {
    it("collects the snapshots newest first with size, counts and the latest mark", () => {
        const rows = collect(backupDir, snapshot);
        expect(rows.map((r) => [r.name, r.latest])).toEqual([["20260105-130000-manual", true], ["20260105-120000-hourly", false]]);
        const size = Buffer.byteLength(JSON.stringify({ events: [{ id: "e1" }, { id: "e2" }] }));
        expect(rows[1]).toMatchObject({ reason: "hourly", at: "2026-01-05T12:00:00.000Z", ok: true, bytes: size, files: 1, commit: "abc1234" });
        expect(rows[1].counts).toMatchObject({ events: 2, files: 1 });
    });

    it("marks a snapshot with an unreadable manifest", () => {
        fs.writeFileSync(path.join(backupDir, "snapshots", "20260105-120000-hourly", "manifest.json"), "{");
        const rows = collect(backupDir, snapshot);
        expect(rows[1]).toMatchObject({ ok: false, bytes: null, counts: null });
        expect(formatTable(rows)[2]).toMatch(/^20260105-120000-hourly\s+2026-01-05 12:00\s+kaputt/);
    });

    it("prints a table, JSON, the usage, and says when there is nothing", async () => {
        const { lines, out, err } = io();
        expect(await main([], { deps: deps(), out, err })).toBe(0);
        expect(lines.out[1]).toMatch(/^20260105-130000-manual \*\s+2026-01-05 13:00\s+0\.0 MB\s+2\s+0\s+0\s+0\s+1$/);
        expect(lines.out[3]).toMatch(/^2 Schnappschüsse unter /);

        lines.out.length = 0;
        expect(await main(["--json"], { deps: deps(), out, err })).toBe(0);
        expect(JSON.parse(lines.out[0])).toMatchObject({ backupDir, snapshots: [{ name: "20260105-130000-manual" }, { name: "20260105-120000-hourly" }] });

        expect(await main(["--bogus"], { deps: deps(), out, err })).toBe(2);
        expect(lines.err).toContain(USAGE);
        expect(parseArgs(["--help"]).help).toBe(true);

        lines.out.length = 0;
        expect(await main([], { deps: { ...snapshot, backupDir: () => path.join(root, "none") }, out, err })).toBe(0);
        expect(lines.out[0]).toMatch(/^Keine Schnappschüsse unter /);
    });
});
