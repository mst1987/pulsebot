// The dashboard's data assembly. Only loadTopLoot() is covered here — the two
// event loaders talk to Raid-Helper/Discord and are exercised through the API
// router tests, where those clients are already mocked.
jest.mock("../../src/web/lootStore", () => {
    const actual = jest.requireActual("../../src/web/lootStore");
    return {
        listAll: jest.fn(() => []),
        listByEvent: jest.fn(() => []),
        // The trimming itself is real: the dashboard row's shape is exactly the
        // one the history pages get.
        charLootPreview: actual.charLootPreview,
    };
});
jest.mock("../../src/web/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../src/web/raidEventStore", () => ({ listRaidEvents: jest.fn(() => []) }));
jest.mock("../../src/web/raidEventScan", () => ({ scanRaidEvents: jest.fn(() => Promise.resolve({ error: null })) }));
jest.mock("../../src/web/eventSheetStore", () => ({ getEventSheet: jest.fn(() => null) }));
jest.mock("../../src/web/eventSoftresStore", () => ({ getEventSoftres: jest.fn(() => null) }));
jest.mock("../../src/web/logStore", () => ({ listLogs: jest.fn(() => []) }));
jest.mock("../../src/web/recentEvents", () => ({
    buildRecentEvents: jest.fn(() => []),
    matchLogsForEvent: jest.fn(() => []),
    pendingLogsForEvent: jest.fn(() => []),
}));
jest.mock("../../src/web/logAutoLink", () => ({ autoLinkLogs: jest.fn(() => Promise.resolve()) }));
jest.mock("../../src/web/reportList", () => ({ logPostedAt: jest.fn(() => 0) }));
jest.mock("../../src/utils/raidhelperClient", () => ({ createRaidhelperClient: jest.fn() }));
jest.mock("../../src/web/discord", () => ({ getChannelCategoryMap: jest.fn(() => ({})) }));

const lootStore = require("../../src/web/lootStore");
const settingsStore = require("../../src/web/settingsStore");
const { loadTopLoot } = require("../../src/web/dashboardData");

// A loot row as lootStore.listAll() hands it out (already decorated).
const lootRow = (over = {}) => ({
    itemId: 30883, itemName: "Kalter Fels", itemIconUrl: "https://x/i.jpg", itemQuality: 4,
    itemLink: "https://www.wowhead.com/tbc/item=30883", character: "Kilrogg", realm: "Thunderstrike",
    response: "BiS", offspec: false, reason: "bis", reasonLabel: "BiS", reasonTone: "good",
    contentId: "ssc", boss: "Hydross", categoryId: "cat1", eventId: "e1", eventLabel: "Montagsraid",
    awardedAt: 1000, source: "gargul", ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    settingsStore.getConfig.mockReturnValue({});
    lootStore.listAll.mockReturnValue([]);
});

describe("web/dashboardData loadTopLoot", () => {
    it("returns nothing and reports no configuration when no top items are defined", () => {
        lootStore.listAll.mockReturnValue([lootRow()]);
        expect(loadTopLoot()).toEqual({ items: [], configured: 0 });
    });

    it("keeps only the awards of configured top items", () => {
        settingsStore.getConfig.mockReturnValue({ topItems: [{ id: 30883 }, { id: 32235 }] });
        lootStore.listAll.mockReturnValue([
            lootRow({ itemId: 12345, itemName: "Irgendwas" }),
            lootRow(),
            lootRow({ itemId: 32235, itemName: "Anderes Top-Item", character: "Shalya" }),
        ]);

        const { items, configured } = loadTopLoot();

        expect(configured).toBe(2);
        expect(items.map((it) => [it.itemId, it.character])).toEqual([[30883, "Kilrogg"], [32235, "Shalya"]]);
    });

    // The item id is the only field every export carries; a Gargul row may have
    // no name at all until the Wowhead backfill runs.
    it("matches by item id even when the id arrives as a string", () => {
        settingsStore.getConfig.mockReturnValue({ topItems: [{ id: 30883 }] });
        lootStore.listAll.mockReturnValue([lootRow({ itemId: "30883", itemName: "" })]);
        expect(loadTopLoot().items).toHaveLength(1);
    });

    it("carries the fields the dashboard row renders", () => {
        settingsStore.getConfig.mockReturnValue({ topItems: [{ id: 30883 }] });
        lootStore.listAll.mockReturnValue([lootRow()]);

        expect(loadTopLoot().items[0]).toMatchObject({
            itemId: 30883, itemName: "Kalter Fels", itemIconUrl: "https://x/i.jpg", itemQuality: 4,
            itemLink: "https://www.wowhead.com/tbc/item=30883",
            character: "Kilrogg", realm: "Thunderstrike", boss: "Hydross",
            response: "BiS", reasonLabel: "BiS", reasonTone: "good",
            eventId: "e1", eventLabel: "Montagsraid", awardedAt: 1000,
        });
    });

    // listAll() is already sorted newest-award-first, so the cap keeps the newest.
    it("caps the list at the requested limit", () => {
        settingsStore.getConfig.mockReturnValue({ topItems: [{ id: 30883 }] });
        lootStore.listAll.mockReturnValue([
            lootRow({ character: "A", awardedAt: 3000 }),
            lootRow({ character: "B", awardedAt: 2000 }),
            lootRow({ character: "C", awardedAt: 1000 }),
        ]);
        expect(loadTopLoot(2).items.map((it) => it.character)).toEqual(["A", "B"]);
    });

    it("ignores top-item entries without a usable id", () => {
        settingsStore.getConfig.mockReturnValue({ topItems: [{ id: 0 }, { name: "kaputt" }] });
        lootStore.listAll.mockReturnValue([lootRow()]);
        expect(loadTopLoot()).toEqual({ items: [], configured: 0 });
    });
});
