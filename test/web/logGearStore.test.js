// Gear loaded from one Warcraft-Logs report on request (src/web/logGearStore.js).
// The WCL client is a fake handed in, the log list is mocked, and the file
// lives in an in-memory fs — what is under test is which report is read, how
// the raider is found in it, what is kept, and what a failure says.
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
        writeFileSync: jest.fn((p, data) => { store.set(p, String(data)); }),
        readFileSync: jest.fn((p) => {
            if (!store.has(p)) throw enoent(p);
            return store.get(p);
        }),
    };
});

const mockListLogs = jest.fn(() => []);
jest.mock("../../src/web/logStore", () => ({ listLogs: (...a) => mockListLogs(...a) }));

const fs = require("fs");
const {
    loadLogGear, gearFromReport, getLogGear, listLogGear, clearLogGear, recentLogs, MAX_LOGS,
} = require("../../src/web/logGearStore");

// A WCL player entry the way the casts table carries it: enough gear for
// buildArmory to make a set out of.
const player = (name, type = "Priest", gear = [{ slot: 0, id: 31064, name: "Hood of Absolution", quality: 4, itemLevel: 146, permanentEnchant: 3002, gems: [{ id: 25893 }] }]) => ({
    name, type, total: 1000, gear,
});

/** A fake client answering per report id. */
function fakeWcl(reports) {
    return {
        getFights: jest.fn(async (id) => {
            const r = reports[id];
            if (!r) { const e = new Error("404"); e.response = { status: 404 }; throw e; }
            return { title: r.title, start: r.start, end: r.start + 3600000, fights: [] };
        }),
        getCasts: jest.fn(async (id) => ({ entries: reports[id].players })),
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    fs.__store.clear();
    mockListLogs.mockReturnValue([]);
});

describe("web/logGearStore — one report, one raider", () => {
    it("builds the raider's armory out of the report's casts table", async () => {
        const wcl = fakeWcl({ abc: { title: "BT Donnerstag", start: 1700000000000, players: [player("Devihra")] } });
        const snap = await gearFromReport(wcl, "abc", "devihra-thunderstrike");
        expect(snap.key).toBe("devihra");
        expect(snap.character).toBe("Devihra");
        expect(snap.className).toBe("Priest");
        expect(snap.reportTitle).toBe("BT Donnerstag");
        expect(snap.reportStart).toBe(1700000000000);
        // The CLA's own builder: the piece carries its gems and enchant status.
        expect(snap.armory).toHaveLength(1);
        expect(snap.armory[0]).toMatchObject({ slot: 0, itemId: "31064", gems: [{ id: "25893" }] });
        expect(snap.armory[0].enchant.enchantId).toBe("3002");
        expect(snap.fetchedAt).toBeGreaterThan(0);
    });

    it("answers null for a raider who is not in the report", async () => {
        const wcl = fakeWcl({ abc: { title: "BT", start: 1, players: [player("Andere", "Mage")] } });
        expect(await gearFromReport(wcl, "abc", "Devihra")).toBeNull();
    });
});

describe("web/logGearStore — loading and keeping", () => {
    it("loads from a named report and keeps the snapshot under the character", async () => {
        const wcl = fakeWcl({ abc: { title: "BT", start: 5, players: [player("Devihra")] } });
        const { snapshot, tried } = await loadLogGear("Devihra", { reportId: "abc", wcl });
        expect(tried).toBe(1);
        expect(snapshot.reportId).toBe("abc");
        expect(getLogGear("devihra").reportId).toBe("abc");
        expect(listLogGear()).toHaveLength(1);
    });

    it("reads the report id out of a full link", async () => {
        const wcl = fakeWcl({ xyz123: { title: "BT", start: 5, players: [player("Devihra")] } });
        await loadLogGear("Devihra", { link: "https://classic.warcraftlogs.com/reports/xyz123#fight=3", wcl });
        expect(wcl.getFights).toHaveBeenCalledWith("xyz123");
        expect(getLogGear("Devihra").reportId).toBe("xyz123");
    });

    it("says so when the raider is not in the named report, and keeps nothing", async () => {
        const wcl = fakeWcl({ abc: { title: "BT", start: 5, players: [player("Andere", "Mage")] } });
        await expect(loadLogGear("Devihra", { reportId: "abc", wcl })).rejects.toMatchObject({
            logGear: true, status: 404, message: expect.stringContaining("steht nicht in diesem Log"),
        });
        expect(getLogGear("Devihra")).toBeNull();
    });

    it("turns an unreadable report into a message, not a stack trace", async () => {
        const wcl = fakeWcl({});
        await expect(loadLogGear("Devihra", { reportId: "nope", wcl })).rejects.toMatchObject({
            logGear: true, status: 400, message: expect.stringContaining("HTTP 404"),
        });
    });

    it("walks the bot's newest logs until one has the raider", async () => {
        mockListLogs.mockReturnValue([
            { reportId: "old", title: "Alt", postedAt: 1000 },
            { reportId: "new", title: "Neu", postedAt: 3000 },
            { reportId: "mid", title: "Mitte", postedAt: 2000 },
        ]);
        const wcl = fakeWcl({
            new: { title: "Neu", start: 3, players: [player("Andere", "Mage")] },
            mid: { title: "Mitte", start: 2, players: [player("Devihra")] },
            old: { title: "Alt", start: 1, players: [player("Devihra")] },
        });
        const { snapshot, tried } = await loadLogGear("Devihra", { wcl });
        // Newest first, and the walk stops at the first hit.
        expect(snapshot.reportId).toBe("mid");
        expect(tried).toBe(2);
        expect(wcl.getFights).not.toHaveBeenCalledWith("old");
    });

    it("skips a log it cannot read rather than giving up", async () => {
        mockListLogs.mockReturnValue([
            { reportId: "broken", title: "Kaputt", postedAt: 3000 },
            { reportId: "fine", title: "Gut", postedAt: 2000 },
        ]);
        const wcl = fakeWcl({ fine: { title: "Gut", start: 2, players: [player("Devihra")] } });
        const { snapshot } = await loadLogGear("Devihra", { wcl });
        expect(snapshot.reportId).toBe("fine");
    });

    it("names how many logs it tried when none has the raider", async () => {
        mockListLogs.mockReturnValue(Array.from({ length: MAX_LOGS + 3 }, (_, i) => ({ reportId: `r${i}`, title: `Log ${i}`, postedAt: 100 - i })));
        const reports = {};
        for (let i = 0; i < MAX_LOGS + 3; i += 1) reports[`r${i}`] = { title: `Log ${i}`, start: i, players: [player("Andere", "Mage")] };
        const wcl = fakeWcl(reports);
        await expect(loadLogGear("Devihra", { wcl })).rejects.toMatchObject({
            message: expect.stringContaining(`keinem der letzten ${MAX_LOGS} Logs`),
        });
        expect(wcl.getFights).toHaveBeenCalledTimes(MAX_LOGS);
    });

    it("asks for a link when the bot knows no log at all", async () => {
        await expect(loadLogGear("Devihra", { wcl: fakeWcl({}) })).rejects.toMatchObject({
            message: expect.stringContaining("kein Log"),
        });
    });

    it("refuses an empty character name", async () => {
        await expect(loadLogGear("  ", { wcl: fakeWcl({}) })).rejects.toMatchObject({ status: 400 });
    });

    it("forgets a snapshot on clear, and says whether there was one", async () => {
        const wcl = fakeWcl({ abc: { title: "BT", start: 5, players: [player("Devihra")] } });
        await loadLogGear("Devihra", { reportId: "abc", wcl });
        expect(clearLogGear("DEVIHRA")).toBe(true);
        expect(getLogGear("Devihra")).toBeNull();
        expect(clearLogGear("Devihra")).toBe(false);
    });

    it("tolerates a corrupt file", () => {
        const { LOG_GEAR_FILE } = require("../../src/web/logGearStore");
        fs.__store.set(LOG_GEAR_FILE, "{not json");
        expect(listLogGear()).toEqual([]);
    });
});

describe("web/logGearStore — the logs offered to pick from", () => {
    it("lists the newest posted first, without logs that have no report id", () => {
        mockListLogs.mockReturnValue([
            { reportId: "", title: "Ohne Report", postedAt: 9000 },
            { reportId: "a", title: "A", postedAt: 1000, eventLabel: "Raid Mo", link: "https://…/a" },
            { reportId: "b", title: "B", detectedAt: 2000 },
        ]);
        const logs = recentLogs(5);
        expect(logs.map((l) => l.reportId)).toEqual(["b", "a"]);
        expect(logs[1]).toEqual({ reportId: "a", title: "A", postedAt: 1000, eventLabel: "Raid Mo", link: "https://…/a" });
    });

    it("caps the list", () => {
        mockListLogs.mockReturnValue(Array.from({ length: 20 }, (_, i) => ({ reportId: `r${i}`, postedAt: i })));
        expect(recentLogs(3)).toHaveLength(3);
    });
});
