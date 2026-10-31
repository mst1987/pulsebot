// One instance per raid ID: who was in an instance this raid ID by the logs
// and the loot - also without any setup entry. The stores are mocked; the
// instance tables (raidContent) and the raid ID are the real ones.
const mockLogs = [];
const mockItems = [];
const mockReports = {};
const mockCalls = { logs: 0, items: 0, versions: [] };

jest.mock("../../../src/stores/loot/logStore", () => ({
    logsBetween: (since, until) => {
        mockCalls.logs++;
        return mockLogs.filter((l) => (l.reportStart || 0) >= since && (l.reportStart || 0) < until);
    },
    playedAtOf: (l) => l.reportStart || 0,
}));
jest.mock("../../../src/stores/loot/lootStore", () => ({
    itemsBetween: (since, until) => {
        mockCalls.items++;
        return mockItems.filter((r) => r.awardedAt >= since && r.awardedAt < until);
    },
}));
jest.mock("../../../src/stores/loot/reportStore", () => ({
    getReportRoster: (id) => mockReports[id] || null,
}));
jest.mock("../../../src/services/loot/lootVersion", () => ({
    versionOfImport: ({ eventId, categoryId }) => {
        mockCalls.versions.push(`${eventId}|${categoryId}`);
        return categoryId === "cat-forever" ? "forever" : "tbc";
    },
}));
jest.mock("../../../src/services/loot/lootServer", () => ({
    serverContext: () => ({}),
    guildOfLootEvent: (ctx, eventId, categoryId, guildId) => guildId || "g1",
}));

const { historyOfRaidId, clearHistoryCache } = require("../../../src/services/setup/raidIdHistory");
const { raidIdOf, DAY_MS } = require("../../../src/utils/time/raidId");

const WED = Date.UTC(2026, 11, 9, 19, 0);
const ID = raidIdOf(WED);
const roster = (...names) => ({ roster: names.map((name) => ({ name })), players: [] });

beforeEach(() => {
    mockLogs.length = 0;
    mockItems.length = 0;
    for (const k of Object.keys(mockReports)) delete mockReports[k];
    mockCalls.logs = 0;
    mockCalls.items = 0;
    mockCalls.versions.length = 0;
    clearHistoryCache();
});

describe("logs", () => {
    test("a log with a kill names its instance, its server, its raid and its characters", () => {
        mockLogs.push({ reportRefId: "r1", reportStart: WED, guildId: "g1", eventId: "eh-x", raids: [{ contentId: "hyjal", killed: 2 }, { contentId: "bt", killed: 0 }] });
        mockReports.r1 = roster("Jaina", "Forever~Devi Res");
        const [rec] = historyOfRaidId(ID);
        expect(rec).toEqual({ source: "log", contentIds: new Set(["hyjal"]), guildId: "g1", eventId: "eh-x", startTime: WED / 1000, keys: new Set(["jaina", "devi res"]) });
    });

    test("without raids the zone tells the instance; without a roster the players", () => {
        mockLogs.push({ reportRefId: "r1", reportStart: WED, zone: "Hyjal Summit", versionId: "forever" });
        mockReports.r1 = { roster: [], players: [{ name: "Thrall" }] };
        expect(historyOfRaidId(ID)).toMatchObject([{ contentIds: new Set(["forever-hyjal"]), keys: new Set(["thrall"]) }]);
    });

    test("no kill, no stored report or another raid ID - no record", () => {
        mockLogs.push({ reportRefId: "r1", reportStart: WED, raids: [{ contentId: "hyjal", killed: 0 }] });
        mockLogs.push({ reportRefId: "r2", reportStart: WED, raids: [{ contentId: "hyjal", killed: 1 }] });
        mockLogs.push({ reportRefId: "r1", reportStart: WED + 7 * DAY_MS, raids: [{ contentId: "hyjal", killed: 1 }] });
        mockReports.r1 = roster("Jaina");
        expect(historyOfRaidId(ID)).toEqual([]);
    });
});

describe("loot", () => {
    test("rows of one raid and instance make one record, from the earliest award", () => {
        mockItems.push({ eventId: "e1", categoryId: "c1", itemId: 30105, character: "Jaina", characterKey: "jaina", awardedAt: WED + 3600000 });
        mockItems.push({ eventId: "e1", categoryId: "c1", itemId: 30105, character: "Arthas", awardedAt: WED });
        const recs = historyOfRaidId(ID);
        expect(recs).toEqual([{ source: "loot", contentIds: new Set(["ssc"]), guildId: "g1", eventId: "e1", startTime: WED / 1000, keys: new Set(["jaina", "arthas"]) }]);
        expect(mockCalls.versions).toEqual(["e1|c1"]);
    });

    test("a row with only a date counts as played at noon of that day", () => {
        // Tuesday 08.12. midnight UTC is still the old ID by the hour, at noon too (reset Wed)
        const tue = Date.UTC(2026, 11, 8);
        const wed = Date.UTC(2026, 11, 9);
        mockItems.push({ eventId: "e1", itemId: 30105, character: "Jaina", awardedAt: tue });
        mockItems.push({ eventId: "e2", itemId: 30105, character: "Arthas", awardedAt: wed });
        const recs = historyOfRaidId(ID);
        expect(recs.map((r) => [...r.keys])).toEqual([["arthas"]]);
        expect(recs[0].startTime).toBe((wed + 12 * 3600000) / 1000);
    });

    test("the version comes from the raid the loot is filed under - TBC loot is no Forever Hyjal", () => {
        mockItems.push({ eventId: "", categoryId: "cat-forever", instance: "Hyjal Summit", character: "Devi", awardedAt: WED });
        mockItems.push({ eventId: "", categoryId: "cat-tbc", instance: "Hyjal Summit", character: "Jaina", awardedAt: WED });
        const recs = historyOfRaidId(ID);
        expect(recs.map((r) => [[...r.contentIds][0], [...r.keys][0]])).toEqual([["forever-hyjal", "devi"], ["hyjal", "jaina"]]);
    });
});

describe("the cache", () => {
    test("reads the stores once a minute per raid ID", () => {
        historyOfRaidId(ID, 1000);
        historyOfRaidId(ID, 50000);
        expect(mockCalls.logs).toBe(1);
        historyOfRaidId(ID, 62000);
        expect(mockCalls.logs).toBe(2);
        expect(historyOfRaidId(null)).toEqual([]);
    });
});
