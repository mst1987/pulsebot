// scripts/backup/snapshot.js (#691): the command line around createSnapshot, used by the deploy (#695) and the
// restore (#693) - arguments, exit codes, and one real run into scratch directories.
const fs = require("fs");
const path = require("path");
const { parseArgs, main, loadEnv, USAGE } = require("../../scripts/backup/snapshot");
const { createSnapshot } = require("../../src/services/backup/snapshot");
const { tempStoreFile } = require("../helpers/tempStore");

describe("parseArgs", () => {
    it("reads the reason and the commits, in both spellings", () => {
        expect(parseArgs(["--reason", "deploy", "--from", "ABCDEF1", "--to=1234567890"])).toEqual({
            reason: "deploy", fromCommit: "abcdef1", toCommit: "1234567890", json: false, help: false,
        });
        expect(parseArgs(["--reason=pre-restore", "--json"])).toMatchObject({ reason: "pre-restore", json: true });
        expect(parseArgs(["--help"]).help).toBe(true);
    });

    it("refuses a missing or unknown reason, a bad commit and unknown flags", () => {
        expect(() => parseArgs([])).toThrow(/--reason muss eins von manual, deploy, pre-restore sein/);
        expect(() => parseArgs(["--reason", "hourly"])).toThrow(/macht der Bot/);
        expect(() => parseArgs(["--reason", "manual", "--from", "main"])).toThrow("--from ist kein Commit-Hash: main");
        expect(() => parseArgs(["--reason"])).toThrow("--reason braucht einen Wert");
        expect(() => parseArgs(["--reason", "--json"])).toThrow("--reason braucht einen Wert");
        expect(() => parseArgs(["--reason", "manual", "--force"])).toThrow("Unbekanntes Argument: --force");
    });
});

describe("main", () => {
    const deps = (result) => ({
        createSnapshot: jest.fn(async () => result),
        backupDir: () => "/b",
        retention: () => ({ deployKeep: 3 }),
        commit: () => "c0ffee1",
    });
    const io = () => {
        const lines = { out: [], err: [] };
        return { lines, out: (l) => lines.out.push(l), err: (l) => lines.err.push(l) };
    };

    it("hands the arguments to createSnapshot and exits 0 when it worked", async () => {
        const d = deps({ ok: true, name: "20261010-120000-deploy", files: 3, bytes: 10, durationMs: 5, dir: "/b/snapshots/x" });
        const { lines, out, err } = io();
        expect(await main(["--reason", "deploy", "--from", "1111111", "--to", "2222222"], { deps: d, out, err })).toBe(0);
        expect(d.createSnapshot).toHaveBeenCalledWith({
            reason: "deploy", fromCommit: "1111111", toCommit: "2222222", commit: "c0ffee1", backupDir: "/b", retention: { deployKeep: 3 },
        });
        expect(lines.out).toEqual(["Schnappschuss 20261010-120000-deploy: 3 Dateien, 10 Bytes, 5 ms (/b/snapshots/x)"]);
    });

    it("exits 1 on a failure, 3 while another snapshot runs, 2 for wrong arguments", async () => {
        const { lines, out, err } = io();
        expect(await main(["--reason", "manual"], { deps: deps({ ok: false, error: "Zu wenig freier Speicher" }), out, err })).toBe(1);
        expect(lines.err).toEqual(["Kein Schnappschuss: Zu wenig freier Speicher"]);
        expect(await main(["--reason", "manual"], { deps: deps({ ok: false, skipped: "locked", error: "läuft" }), out, err })).toBe(3);
        const d = deps({ ok: true });
        expect(await main(["--reason", "weekly"], { deps: d, out, err })).toBe(2);
        expect(lines.err).toContain(USAGE);
        expect(d.createSnapshot).not.toHaveBeenCalled();
    });

    it("prints the whole result with --json and the usage with --help", async () => {
        const { lines, out, err } = io();
        const result = { ok: true, name: "n", files: 1 };
        expect(await main(["--reason", "manual", "--json"], { deps: deps(result), out, err })).toBe(0);
        expect(JSON.parse(lines.out[0])).toEqual(result);
        expect(await main(["--help"], { deps: deps(result), out, err })).toBe(0);
        expect(lines.out[1]).toBe(USAGE);
    });

    it("takes a real snapshot with the bot's code", async () => {
        const root = path.dirname(tempStoreFile("unused"));
        const dataDir = path.join(root, "data");
        fs.mkdirSync(path.join(dataDir, "settings"), { recursive: true });
        fs.writeFileSync(path.join(dataDir, "settings", "events.json"), "{\"events\":[]}");
        const d = {
            createSnapshot: (o) => createSnapshot({ ...o, dataDir }),
            backupDir: () => path.join(root, "backups"),
            retention: () => null,
            commit: () => "",
        };
        const { out, err } = io();
        expect(await main(["--reason", "manual"], { deps: d, out, err })).toBe(0);
        const names = fs.readdirSync(path.join(root, "backups", "snapshots"));
        expect(names).toHaveLength(1);
        expect(names[0]).toMatch(/^\d{8}-\d{6}-manual$/);
    });
});

describe("loadEnv", () => {
    it("prefers .env.dev like bot.js and names the file it read", () => {
        const root = path.dirname(tempStoreFile("unused"));
        fs.writeFileSync(path.join(root, ".env.dev"), "BACKUP_CLI_TEST_MARKER=dev\n");
        fs.writeFileSync(path.join(root, ".env"), "BACKUP_CLI_TEST_MARKER=live\n");
        const before = process.env.EVENTHELPER_ENV_FILE;
        delete process.env.EVENTHELPER_ENV_FILE;
        try {
            loadEnv(root);
            expect(process.env.BACKUP_CLI_TEST_MARKER).toBe("dev");
            expect(process.env.EVENTHELPER_ENV_FILE).toBe(".env.dev");
        } finally {
            delete process.env.BACKUP_CLI_TEST_MARKER;
            if (before === undefined) delete process.env.EVENTHELPER_ENV_FILE;
            else process.env.EVENTHELPER_ENV_FILE = before;
        }
    });
});
