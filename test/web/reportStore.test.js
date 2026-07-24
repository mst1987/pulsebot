// Mock fs with an in-memory store so tests never touch the repo's disk.
jest.mock("fs", () => {
    const store = new Map();
    const enoent = (p) => {
        const e = new Error(`ENOENT: no such file '${p}'`);
        e.code = "ENOENT";
        return e;
    };
    return {
        __store: store,
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn((p, data) => {
            store.set(p, String(data));
        }),
        readFileSync: jest.fn((p) => {
            if (!store.has(p)) throw enoent(p);
            return store.get(p);
        }),
        unlinkSync: jest.fn((p) => {
            if (!store.has(p)) throw enoent(p);
            store.delete(p);
        }),
        readdirSync: jest.fn(() =>
            [...store.keys()].map((p) => p.split(/[\\/]/).pop())
        ),
    };
});

const fs = require("fs");
const path = require("path");
const {
    saveReport,
    getReport,
    deleteReport,
    listReports,
    REPORTS_DIR,
} = require("../../src/web/reportStore.js");

beforeEach(() => {
    fs.__store.clear();
});

describe("web/reportStore", () => {
    describe("saveReport", () => {
        it("returns a short hex id and persists the payload", () => {
            const id = saveReport({ title: "Test", players: [] });
            expect(id).toMatch(/^[a-f0-9]{6,}$/);
            expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
            const stored = JSON.parse(fs.__store.get(path.join(REPORTS_DIR, `${id}.json`)));
            expect(stored.id).toBe(id);
            expect(stored.title).toBe("Test");
            expect(typeof stored.generatedAt).toBe("number");
        });

        it("preserves a provided generatedAt", () => {
            const id = saveReport({ title: "T", generatedAt: 12345 });
            const stored = getReport(id);
            expect(stored.generatedAt).toBe(12345);
        });
    });

    describe("getReport", () => {
        it("round-trips a saved report", () => {
            const id = saveReport({ title: "Round Trip", zone: "Kara", players: [{ name: "A" }] });
            const loaded = getReport(id);
            expect(loaded).toMatchObject({ id, title: "Round Trip", zone: "Kara" });
        });

        it("returns null for a malformed id", () => {
            expect(getReport("nope!")).toBeNull();
            expect(getReport("ABC")).toBeNull(); // too short
            expect(getReport("../etc")).toBeNull();
        });

        it("returns null when the file does not exist", () => {
            expect(getReport("aabbccddeeff")).toBeNull();
        });

        it("returns null when the stored JSON is corrupt", () => {
            fs.__store.set(path.join(REPORTS_DIR, "deadbeef01.json"), "{not json");
            expect(getReport("deadbeef01")).toBeNull();
        });
    });

    describe("deleteReport", () => {
        it("removes an existing report and returns true", () => {
            const id = saveReport({ title: "X" });
            expect(deleteReport(id)).toBe(true);
            expect(getReport(id)).toBeNull();
        });

        it("returns false for a missing report", () => {
            expect(deleteReport("aabbccddeeff")).toBe(false);
        });

        it("returns false for a malformed id", () => {
            expect(deleteReport("bad id")).toBe(false);
            expect(fs.unlinkSync).not.toHaveBeenCalled();
        });
    });

    describe("listReports", () => {
        it("returns an empty array when there are no reports", () => {
            expect(listReports()).toEqual([]);
        });

        it("returns lightweight metadata, newest first", () => {
            const id1 = saveReport({
                title: "Older",
                zone: "Kara",
                date: "2026-01-01",
                generatedAt: 1000,
                players: [{ issues: [{}, {}] }, { issues: [{}] }],
            });
            const id2 = saveReport({
                title: "Newer",
                zone: "Gruul",
                date: "2026-02-02",
                generatedAt: 5000,
                players: [{ issues: [] }],
            });

            const list = listReports();
            expect(list).toHaveLength(2);
            // newest first
            expect(list[0].id).toBe(id2);
            expect(list[1].id).toBe(id1);

            const older = list.find((r) => r.id === id1);
            expect(older).toMatchObject({
                title: "Older",
                zone: "Kara",
                date: "2026-01-01",
                generatedAt: 1000,
                playerCount: 2,
                issueCount: 3,
            });
            const newer = list.find((r) => r.id === id2);
            expect(newer).toMatchObject({ playerCount: 1, issueCount: 0 });
        });

        it("skips unreadable files", () => {
            saveReport({ title: "Good", players: [] });
            fs.__store.set(path.join(REPORTS_DIR, "corrupt99.json"), "{broken");
            const list = listReports();
            expect(list).toHaveLength(1);
            expect(list[0].title).toBe("Good");
        });
    });
});
