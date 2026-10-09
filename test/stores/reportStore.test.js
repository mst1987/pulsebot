// Mock fs with an in-memory store so tests never touch the repo's disk.
// It keeps an mtime per file, because the store remembers what a report's
// header said until that file changes — a mock without `statSync` would make
// every listing look unreadable.
jest.mock("fs", () => {
    const store = new Map();
    const mtimes = new Map();
    let tick = 0;
    const enoent = (p) => {
        const e = new Error(`ENOENT: no such file '${p}'`);
        e.code = "ENOENT";
        return e;
    };
    const write = (p, data) => {
        store.set(p, String(data));
        mtimes.set(p, ++tick);
    };
    return {
        __store: {
            clear: () => { store.clear(); mtimes.clear(); },
            get: (p) => store.get(p),
            set: write,
            keys: () => store.keys(),
        },
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(write),
        readFileSync: jest.fn((p) => {
            if (!store.has(p)) throw enoent(p);
            return store.get(p);
        }),
        statSync: jest.fn((p) => {
            if (!store.has(p)) throw enoent(p);
            return { mtimeMs: mtimes.get(p) || 0, size: store.get(p).length };
        }),
        unlinkSync: jest.fn((p) => {
            if (!store.has(p)) throw enoent(p);
            store.delete(p);
            mtimes.delete(p);
        }),
        // saveReport writes atomically: a temporary file, then renamed over the real one
        renameSync: jest.fn((from, to) => {
            if (!store.has(from)) throw enoent(from);
            write(to, store.get(from));
            store.delete(from);
            mtimes.delete(from);
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
    getReportRoster,
    getReportHints,
    deleteReport,
    listReports,
    resetCache,
    REPORTS_DIR,
} = require("../../src/stores/reportStore.js");

beforeEach(() => {
    fs.__store.clear();
    // the cache outlives a test's files, so it starts empty like the store
    resetCache();
});

describe("stores/reportStore", () => {
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

        it("overwrites in place when an explicit id is passed", () => {
            const first = saveReport({ title: "CLA only", consumables: { players: [] } });
            const again = saveReport({ title: "CLA + RPB", rpb: { roles: {} } }, first);
            expect(again).toBe(first);
            const stored = getReport(first);
            expect(stored.title).toBe("CLA + RPB");
            expect(stored.rpb).toEqual({ roles: {} });
        });

        it("ignores a malformed id and generates a fresh one", () => {
            const id = saveReport({ title: "T" }, "../../etc/passwd");
            expect(id).toMatch(/^[a-f0-9]{6,}$/);
            expect(id).not.toBe("../../etc/passwd");
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

        it("exposes the WCL report code + url, deriving the url from the code when absent", () => {
            const withUrl = saveReport({ title: "A", reportId: "abc", reportUrl: "https://x/y", players: [] });
            const codeOnly = saveReport({ title: "B", reportId: "def", players: [] });
            const neither = saveReport({ title: "C", players: [] });
            const byId = Object.fromEntries(listReports().map((r) => [r.id, r]));
            expect(byId[withUrl]).toMatchObject({ reportId: "abc", reportUrl: "https://x/y" });
            expect(byId[codeOnly]).toMatchObject({
                reportId: "def",
                reportUrl: "https://classic.warcraftlogs.com/reports/def",
            });
            expect(byId[neither]).toMatchObject({ reportId: "", reportUrl: "" });
        });

        it("carries the halves and the raids with their boss count for the log list", () => {
            const withProgress = saveReport({
                title: "Hyjal", sections: ["cla"], players: [],
                raidProgress: { raids: [{ contentId: "hyjal", short: "Hyjal", done: false, finalBosses: ["Archimonde"], bosses: [{ name: "Rage Winterchill", killed: true }, { name: "Archimonde", killed: false }] }] },
            });
            const old = saveReport({ title: "Alt", players: [] });
            const byId = Object.fromEntries(listReports().map((r) => [r.id, r]));
            expect(byId[withProgress].sections).toEqual(["cla"]);
            expect(byId[withProgress].raids).toEqual([expect.objectContaining({ contentId: "hyjal", killed: 1, total: 2, finalKilled: false })]);
            expect(byId[old]).toMatchObject({ sections: [], raids: null });
        });

        it("skips unreadable files", () => {
            saveReport({ title: "Good", players: [] });
            fs.__store.set(path.join(REPORTS_DIR, "corrupt99.json"), "{broken");
            const list = listReports();
            expect(list).toHaveLength(1);
            expect(list[0].title).toBe("Good");
        });
    });

    // What a report file's header said is remembered until the file changes —
    // parsing a couple of megabytes per raider is what made the Loot-Council
    // take minutes.
    describe("was zwischengespeichert wird", () => {
        it("liest eine unveränderte Datei nicht noch einmal", () => {
            saveReport({ title: "Alt", players: [] });
            listReports();
            fs.readFileSync.mockClear();
            expect(listReports()).toHaveLength(1);
            expect(fs.readFileSync).not.toHaveBeenCalled();
        });

        // From the 61st report on the bounded map evicted on every insert, so a
        // listing never hit and parsed every file again — seconds of a blocked
        // process on every page that lists reports (Okt 2026).
        it("trifft auch bei mehr Reports als der Roster-Cache fasst", () => {
            for (let i = 0; i < 75; i++) saveReport({ title: `R${i}`, generatedAt: i, players: [] });
            expect(listReports()).toHaveLength(75);
            fs.readFileSync.mockClear();
            expect(listReports()).toHaveLength(75);
            expect(fs.readFileSync).not.toHaveBeenCalled();
        });

        it("hält den Roster-Cache bei 60 Einträgen und behält dabei die zuletzt gelesenen", () => {
            const ids = [];
            for (let i = 0; i < 61; i++) ids.push(saveReport({ title: `R${i}`, roster: [], players: [] }));
            for (const id of ids) getReportRoster(id);
            fs.readFileSync.mockClear();
            // the newest 60 come out of the cache, the first one fell out
            for (const id of ids.slice(1)) getReportRoster(id);
            expect(fs.readFileSync).not.toHaveBeenCalled();
            getReportRoster(ids[0]);
            expect(fs.readFileSync).toHaveBeenCalledTimes(1);
        });

        it("liest sie wieder, sobald sie sich ändert", () => {
            const id = saveReport({ title: "Alt", players: [] });
            listReports();
            saveReport({ title: "Neu", players: [] }, id);
            expect(listReports()[0].title).toBe("Neu");
        });

        it("vergisst eine gelöschte Datei", () => {
            const id = saveReport({ title: "Weg", players: [] });
            listReports();
            deleteReport(id);
            expect(listReports()).toHaveLength(0);
        });

        it("gibt mit getReportRoster nur den Teil heraus, den die Gear-Auswertung liest", () => {
            const id = saveReport({
                title: "Hyjal",
                generatedAt: 4000,
                roster: [{ name: "Devihra", type: "Priest", armory: [{ slot: 0 }] }],
                players: [{ name: "Devihra", issues: [] }],
                // the bulk of a real report, and of no use to that walk
                timeline: { fights: [{ id: 1, duration: 1000 }] },
            });
            const slim = getReportRoster(id);
            expect(slim).toEqual({
                id,
                title: "Hyjal",
                generatedAt: 4000,
                roster: [{ name: "Devihra", type: "Priest", armory: [{ slot: 0 }] }],
                players: [{ name: "Devihra", issues: [] }],
            });
            expect(slim.timeline).toBeUndefined();
            // and the second call comes out of the store
            fs.readFileSync.mockClear();
            expect(getReportRoster(id).title).toBe("Hyjal");
            expect(fs.readFileSync).not.toHaveBeenCalled();
        });

        it("beantwortet eine unbekannte oder kaputte Datei mit null", () => {
            expect(getReportRoster("nichtshex")).toBeNull();
            expect(getReportRoster("deadbeef01")).toBeNull();
            fs.__store.set(path.join(REPORTS_DIR, "cafebabe01.json"), "{kaputt");
            expect(getReportRoster("cafebabe01")).toBeNull();
        });
    });
});

describe("getReportHints", () => {
    const report = () => ({
        title: "BT",
        roster: [{ name: "Thrall" }, { name: "Heilbert" }],
        recommendations: {
            raid: [],
            players: [
                { name: "Heilbert", type: "healer", items: [{ key: "k1", title: "a" }, { key: "k2", title: "b" }, { key: "k3", title: "c" }] },
                { name: "Thrall", type: "dps", items: [{ key: "k1", title: "a" }] },
                { name: "Gone", type: "dps", items: [{ key: "k1", title: "a" }] },
            ],
        },
        recommendationReview: { players: { Heilbert: { k1: { approved: true }, k2: { approved: false }, k3: { approved: true } } } },
    });

    it("counts the approved recommendations per player and finds their player page", () => {
        const id = saveReport(report());
        const hints = getReportHints(id);
        expect(hints.id).toBe(id);
        expect(hints.players).toEqual({
            heilbert: { name: "Heilbert", idx: 1, approved: 2 },
            thrall: { name: "Thrall", idx: 0, approved: 0 },
            gone: { name: "Gone", idx: -1, approved: 0 },
        });
    });

    it("reads the file once until it changes", () => {
        const id = saveReport(report());
        getReportHints(id);
        const reads = fs.readFileSync.mock.calls.length;
        getReportHints(id);
        expect(fs.readFileSync.mock.calls.length).toBe(reads);
        saveReport({ ...report(), recommendationReview: {} }, id);
        expect(getReportHints(id).players.heilbert.approved).toBe(0);
    });

    it("is null for a bad id or a missing report, and empty without recommendations", () => {
        expect(getReportHints("../x")).toBeNull();
        expect(getReportHints("abcdef99")).toBeNull();
        const id = saveReport({ title: "old", roster: [] });
        expect(getReportHints(id).players).toEqual({});
    });
});
