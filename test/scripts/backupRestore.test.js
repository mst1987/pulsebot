// scripts/backup/restore.js (#693): arguments, which snapshot an argument names, the health check, and whole runs
// with the real snapshot and restore code against scratch directories - only the health answer is faked.
const fs = require("fs");
const path = require("path");
const http = require("http");
const { EventEmitter } = require("events");
const { parseArgs, resolveSnapshot, checkHealth, formatSummary, main, USAGE } = require("../../scripts/backup/restore");
const snapshot = require("../../src/services/backup/snapshot");
const { verifySnapshot, restoreSnapshot } = require("../../src/services/backup/restore");
const { tempStoreFile } = require("../helpers/tempStore");

const T0 = Date.UTC(2026, 0, 5, 12, 0, 0);
const ROSTERS = JSON.stringify({ rosters: { r1: {}, r2: {} } });

let root;
let dataDir;
let backupDir;
let hourly;

function put(dir, rel, text) {
    const file = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}
const get = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split("/")), "utf8");
const snapshotNames = () => fs.readdirSync(path.join(backupDir, "snapshots")).filter((n) => !n.startsWith(".")).sort();

beforeEach(async () => {
    root = path.dirname(tempStoreFile("unused"));
    dataDir = path.join(root, "data");
    backupDir = path.join(root, "backups");
    put(dataDir, "settings/events.json", JSON.stringify({ events: [{ id: "e1" }, { id: "e2" }] }));
    put(dataDir, "settings/rosters.json", ROSTERS);
    put(dataDir, "sessions.json", "{}");
    hourly = await snapshot.createSnapshot({ dataDir, backupDir, reason: "hourly", now: () => T0, retention: null });
    // the accident: a roster emptied, an event gone
    put(dataDir, "settings/rosters.json", JSON.stringify({ rosters: {} }));
    put(dataDir, "settings/events.json", JSON.stringify({ events: [{ id: "e1" }] }));
});

const io = () => {
    const lines = { out: [], err: [] };
    return { lines, out: (l) => lines.out.push(l), err: (l) => lines.err.push(l) };
};

const deps = (over = {}) => ({
    snapshot, verifySnapshot, restoreSnapshot,
    createSnapshot: snapshot.createSnapshot,
    acquireLock: snapshot.acquireLock,
    backupDir: () => backupDir,
    dataDir: () => dataDir,
    retention: () => null,
    commit: () => "abc1234",
    port: () => 3999,
    health: jest.fn(async () => ({ running: false, detail: "Port 3999: ECONNREFUSED" })),
    ...over,
});
const running = () => jest.fn(async () => ({ running: true, detail: "HTTP 200 auf Port 3999" }));

describe("parseArgs", () => {
    it("reads the snapshot, repeated --only and the switches", () => {
        expect(parseArgs(["latest", "--dry-run", "--only", "settings/a.json", "--only=reports", "--force", "--prune", "--json"])).toEqual({
            snapshot: "latest", dryRun: true, only: ["settings/a.json", "reports"], force: true, prune: true, json: true, help: false,
        });
        expect(parseArgs(["--help"]).help).toBe(true);
    });

    it("refuses no snapshot, two snapshots, an --only without a path and unknown flags", () => {
        expect(() => parseArgs([])).toThrow(/Welcher Schnappschuss/);
        expect(() => parseArgs(["a", "b"])).toThrow("Nur ein Schnappschuss auf einmal (zweiter: b)");
        expect(() => parseArgs(["latest", "--only"])).toThrow(/--only braucht einen Pfad/);
        expect(() => parseArgs(["latest", "--only", "--force"])).toThrow(/--only braucht einen Pfad/);
        expect(() => parseArgs(["latest", "--yes"])).toThrow("Unbekanntes Argument: --yes");
    });
});

describe("resolveSnapshot", () => {
    it("takes latest as the newest snapshot that is not a pre-restore one", async () => {
        await snapshot.createSnapshot({ dataDir, backupDir, reason: "pre-restore", now: () => T0 + 60000, retention: null });
        expect(resolveSnapshot("latest", backupDir, snapshot)).toBe(hourly.dir);
    });

    it("finds a name under BACKUP_DIR and a path with manifest.json, and explains what it cannot find", () => {
        expect(resolveSnapshot("20260105-120000-hourly", backupDir, snapshot)).toBe(hourly.dir);
        expect(resolveSnapshot(hourly.dir, backupDir, snapshot)).toBe(hourly.dir);
        expect(resolveSnapshot("snapshots/20260105-120000-hourly", backupDir, snapshot, backupDir)).toBe(hourly.dir);
        expect(() => resolveSnapshot("20260105-130000-hourly", backupDir, snapshot)).toThrow(/gibt es unter .* nicht/);
        expect(() => resolveSnapshot("latest", path.join(root, "empty"), snapshot)).toThrow(/Kein Schnappschuss unter/);

        const restic = path.join(root, "restore");
        fs.cpSync(hourly.dir, path.join(restic, "var", "backups", "pulsebot", "offsite-stage", "latest"), { recursive: true });
        expect(() => resolveSnapshot(restic, backupDir, snapshot)).toThrow(/gemeint ist wohl .*offsite-stage.latest/);
    });
});

describe("checkHealth", () => {
    const fakeGet = (behave) => (_opts, onResponse) => {
        const req = new EventEmitter();
        req.destroy = jest.fn();
        setImmediate(() => behave(req, onResponse));
        return req;
    };

    it("says running for any answer and for a timeout, stopped for a refused connection", async () => {
        const answer = fakeGet((_req, cb) => cb({ statusCode: 503, resume: () => {} }));
        expect(await checkHealth(3005, { get: answer })).toEqual({ running: true, detail: "HTTP 503 auf Port 3005" });
        const refused = fakeGet((req) => req.emit("error", Object.assign(new Error("x"), { code: "ECONNREFUSED" })));
        expect(await checkHealth(3005, { get: refused })).toEqual({ running: false, detail: "Port 3005: ECONNREFUSED" });
        const silent = fakeGet((req) => req.emit("timeout"));
        expect(await checkHealth(3005, { get: silent, timeoutMs: 50 })).toEqual({ running: true, detail: "Port 3005 antwortet nicht innerhalb von 50 ms" });
    });

    it("asks a real server on loopback", async () => {
        const server = http.createServer((_req, res) => res.end("{\"status\":\"ok\"}"));
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address();
        expect(await checkHealth(port)).toEqual({ running: true, detail: `HTTP 200 auf Port ${port}` });
        await new Promise((resolve) => server.close(resolve));
        expect((await checkHealth(port)).running).toBe(false);
    });
});

describe("main", () => {
    it("checks, takes the way back, restores and reports the counts", async () => {
        const { lines, out, err } = io();
        expect(await main(["latest"], { deps: deps(), out, err })).toBe(0);
        expect(lines.err).toEqual([]);
        expect(get(dataDir, "settings/rosters.json")).toBe(ROSTERS);
        const names = snapshotNames();
        expect(names).toHaveLength(2);
        const pre = names.find((n) => n.endsWith("-pre-restore"));
        expect(get(path.join(backupDir, "snapshots", pre, "data"), "settings/rosters.json")).toBe(JSON.stringify({ rosters: {} }));
        expect(lines.out[0]).toMatch(/^Prüfung ok: 20260105-120000-hourly \(hourly, 2026-01-05T12:00:00.000Z\), 3 Dateien/);
        expect(lines.out).toContain(`Rückweg-Schnappschuss: ${pre}`);
        expect(lines.out).toContain("  2 geändert, 0 neu, 1 unverändert, 0 nur im Ziel (bleiben; --prune löscht sie)");
        expect(lines.out).toContain("    events             1 ->      2  *");
        expect(lines.out).toContain("    rosters            0 ->      2  *");
        expect(lines.out).toContain(`Rückweg (bei gestopptem Bot): npm run backup:restore -- ${pre}`);
        expect(fs.existsSync(path.join(backupDir, snapshot.LOCK_NAME))).toBe(false);
    });

    it("changes nothing and takes no snapshot on a dry run, even with the bot running", async () => {
        const { lines, out, err } = io();
        expect(await main(["latest", "--dry-run"], { deps: deps({ health: running() }), out, err })).toBe(0);
        expect(get(dataDir, "settings/rosters.json")).toBe(JSON.stringify({ rosters: {} }));
        expect(snapshotNames()).toEqual(["20260105-120000-hourly"]);
        expect(lines.out.some((l) => l.startsWith("Hinweis: der Bot läuft"))).toBe(true);
        expect(lines.out.some((l) => l.startsWith("Trockenlauf - würde zurückspielen: 20260105-120000-hourly"))).toBe(true);
        expect(lines.out).toContain("    rosters            0 ->      2  *");
    });

    it("refuses while the bot runs, unless --force", async () => {
        const { lines, out, err } = io();
        expect(await main(["latest"], { deps: deps({ health: running() }), out, err })).toBe(4);
        expect(lines.err[0]).toMatch(/^Der Bot läuft noch \(HTTP 200 auf Port 3999\)/);
        expect(snapshotNames()).toHaveLength(1);
        expect(get(dataDir, "settings/rosters.json")).toBe(JSON.stringify({ rosters: {} }));

        expect(await main(["latest", "--force"], { deps: deps({ health: running() }), out, err })).toBe(0);
        expect(get(dataDir, "settings/rosters.json")).toBe(ROSTERS);
        expect(lines.out.some((l) => l.startsWith("Achtung: der Bot läuft"))).toBe(true);
    });

    it("restores only --only and lists it", async () => {
        const { lines, out, err } = io();
        expect(await main(["20260105-120000-hourly", "--only", "settings/rosters.json"], { deps: deps(), out, err })).toBe(0);
        expect(get(dataDir, "settings/rosters.json")).toBe(ROSTERS);
        expect(get(dataDir, "settings/events.json")).toBe(JSON.stringify({ events: [{ id: "e1" }] }));
        expect(lines.out).toContain("  geändert  settings/rosters.json");
    });

    it("stops at a damaged snapshot before any snapshot or change", async () => {
        put(path.join(hourly.dir, "data"), "settings/rosters.json", ROSTERS.replace("r1", "r9"));
        const d = deps();
        const { lines, out, err } = io();
        expect(await main(["latest"], { deps: d, out, err })).toBe(1);
        expect(lines.err).toEqual([
            `Schnappschuss ${hourly.dir} ist fehlerhaft - nichts geändert:`,
            "  settings/rosters.json: Prüfsumme weicht ab",
            "Prüfung fehlgeschlagen: 1 Problem",
        ]);
        expect(d.health).not.toHaveBeenCalled();
        expect(snapshotNames()).toHaveLength(1);
    });

    it("stops without the way back: a failed or locked pre-restore snapshot, a held lock", async () => {
        const { lines, out, err } = io();
        const failing = deps({ createSnapshot: async () => ({ ok: false, error: "Zu wenig freier Speicher" }) });
        expect(await main(["latest"], { deps: failing, out, err })).toBe(1);
        expect(lines.err).toContain("Kein Rückweg-Schnappschuss, daher nichts zurückgespielt: Zu wenig freier Speicher");
        const locked = deps({ createSnapshot: async () => ({ ok: false, skipped: "locked", error: "läuft" }) });
        expect(await main(["latest"], { deps: locked, out, err })).toBe(3);
        expect(await main(["latest"], { deps: deps({ acquireLock: () => null }), out, err })).toBe(3);
        expect(get(dataDir, "settings/rosters.json")).toBe(JSON.stringify({ rosters: {} }));
    });

    it("restores from a directory restic brought back and prints JSON", async () => {
        const stage = path.join(root, "restore", "var", "backups", "pulsebot", "offsite-stage", "latest");
        fs.cpSync(hourly.dir, stage, { recursive: true });
        const { lines, out, err } = io();
        expect(await main([stage, "--json"], { deps: deps(), out, err })).toBe(0);
        expect(lines.out).toHaveLength(1);
        const report = JSON.parse(lines.out[0]);
        expect(report).toMatchObject({ ok: true, snapshotDir: stage, verification: { ok: true, checked: 3 }, health: { running: false } });
        expect(report.preRestore.name).toMatch(/-pre-restore$/);
        expect(report.restore).toMatchObject({ ok: true, updated: 2, countsAfter: { rosters: 2, events: 2 } });
        expect(get(dataDir, "settings/rosters.json")).toBe(ROSTERS);
    });

    it("exits 2 for wrong arguments or an unknown snapshot, prints the usage with --help", async () => {
        const { lines, out, err } = io();
        expect(await main([], { deps: deps(), out, err })).toBe(2);
        expect(lines.err).toContain(USAGE);
        expect(await main(["20260105-130000-hourly"], { deps: deps(), out, err })).toBe(2);
        expect(await main(["--help"], { deps: deps(), out, err })).toBe(0);
        expect(lines.out).toContain(USAGE);
    });
});

describe("formatSummary", () => {
    it("cuts a long change list and explains the snapshot column of a dry run with --only", () => {
        const changes = Array.from({ length: 45 }, (_, i) => ({ rel: `reports/${i}.json`, action: "create" }));
        const lines = formatSummary({
            dryRun: true, prune: false, only: ["reports"], dataDir: "/d", changes, extra: [], created: 45, updated: 0, unchanged: 0,
            deleted: 0, countsBefore: { reports: 0 }, countsSnapshot: { reports: 45 }, countsAfter: null,
        }, { snapshotLabel: "x", preRestore: null });
        expect(lines).toContain("  ... und 25 weitere (--json zeigt alle)");
        expect(lines).toContain("    reports            0 ->     45  *");
        expect(lines[lines.length - 1]).toMatch(/gelten für den ganzen Schnappschuss/);
    });
});
