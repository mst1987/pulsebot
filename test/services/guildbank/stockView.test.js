// The stock as the page reads it: available = count - reserved - reserve, the
// group an item is listed under, and which bank of a server is shown.
jest.mock("../../../src/services/guildbank/reservations", () => ({
    reservedByItem: jest.fn(() => ({})),
    reservedRequestCount: jest.fn(() => 0),
}));

const { reservedByItem, reservedRequestCount } = require("../../../src/services/guildbank/reservations");
const store = require("../../../src/stores/guildBankStockStore");
const view = require("../../../src/services/guildbank/stockView");
const { parseGuildBankScan, GB_FORMAT } = require("../../../src/utils/guildbank/guildBankScan");
const { tempStoreFile } = require("../../helpers/tempStore");

function record(guild, guildId, project = "tbc") {
    const scan = parseGuildBankScan({
        format: GB_FORMAT, version: 1, client: { project }, guild: { name: guild, realm: "Spineshatter" },
        scannedAt: 1791000000, tabs: [{ index: 1, name: "A", items: [{ itemId: 22854, count: 10 }] }],
    });
    return store.recordScan(scan, { now: 1, guildId }).bank;
}

beforeAll(() => store.useFile(tempStoreFile("guild-bank-stock.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    jest.clearAllMocks();
    for (const b of store.listBanks()) store.removeBank(b.key);
});

describe("services/guildbank/stockView", () => {
    it("groups by the orga's category, else the subclass of consumables and trade goods, else the class", () => {
        expect(view.itemGroup({ category: "Raid", classId: 0, subclassName: "Fläschchen" })).toBe("Raid");
        expect(view.itemGroup({ category: "", classId: 0, className: "Verbrauchbar", subclassName: "Fläschchen" })).toBe("Fläschchen");
        expect(view.itemGroup({ category: "", classId: 7, className: "Handwerkswaren", subclassName: "Stoff" })).toBe("Stoff");
        expect(view.itemGroup({ category: "", classId: 3, className: "Edelsteine", subclassName: "Rot" })).toBe("Edelsteine");
        expect(view.itemGroup({ category: "", classId: 0, className: "Verbrauchbar", subclassName: "" })).toBe("Verbrauchbar");
        expect(view.itemGroup({ category: "", classId: null, className: "", subclassName: "" })).toBe("");
        expect(view.itemGroup(null)).toBe("");
    });

    it("never lets available go below zero", () => {
        expect(view.availableOf(10, 3, 2)).toBe(5);
        expect(view.availableOf(3, 3, 2)).toBe(0);
        expect(view.availableOf(undefined, 0, 0)).toBe(0);
    });

    it("names a version short, the id for an unknown one", () => {
        expect(view.versionShort("tbc")).toBe("TBC");
        expect(view.versionShort("forever")).toBe("Forever");
        expect(view.versionShort("wotlk")).toBe("WOTLK");
    });

    it("shows nothing for a server without banks or without an id", () => {
        record("Alpha", "g2");
        expect(view.stockForServer("g1")).toEqual({ banks: [], bank: null });
        expect(view.stockForServer("")).toEqual({ banks: [], bank: null });
    });

    it("adds reserved and available to every item of the bank shown", () => {
        const bank = record("Alpha", "g1");
        store.setItemSettings(bank.key, 22854, { reserve: 2 });
        reservedByItem.mockReturnValue({ 22854: 3 });
        reservedRequestCount.mockReturnValue(2);
        const { bank: shown } = view.stockForServer("g1");
        expect(shown).toMatchObject({ key: bank.key, reservedRequests: 2, versionShort: "TBC", wowheadPath: "tbc" });
        expect(shown.items[0]).toMatchObject({ itemId: 22854, count: 10, reserved: 3, reserve: 2, available: 5, group: "" });
        expect(view.itemForPage(bank.key, null)).toBeNull();
    });

    it("counts only the visible tabs and marks an item whose whole stock is hidden", () => {
        const item = { itemId: 1, count: 12, tabs: { 1: 10, 2: 2 }, reserve: 0 };
        expect(view.withAvailability(item, {}, new Set(["2"]))).toMatchObject({ count: 10, totalCount: 12, tabs: { 1: 10 }, tabHidden: false, available: 10 });
        expect(view.withAvailability(item, {}, new Set(["1", "2"]))).toMatchObject({ count: 0, tabHidden: true, available: 0 });
        expect(view.withAvailability({ ...item, count: 0, tabs: {} }, {}, new Set(["1"]))).toMatchObject({ count: 0, tabHidden: false });
        const bank = record("Alpha", "g1");
        store.setTabHidden(bank.key, 1, true);
        expect(view.hiddenTabsOf(store.getBank(bank.key))).toEqual(new Set(["1"]));
        expect(view.stockForServer("g1").bank.items[0]).toMatchObject({ tabHidden: true, count: 0 });
        expect(view.itemForPage(bank.key, store.getBank(bank.key).items[0])).toMatchObject({ tabHidden: true });
        expect(view.hiddenTabsOf(null)).toEqual(new Set());
    });

    it("finds a bank only on its own server", () => {
        const bank = record("Alpha", "g1");
        expect(view.bankOfServer(bank.key, "g1")).toMatchObject({ key: bank.key });
        expect(view.bankOfServer(bank.key, "g2")).toBeNull();
        expect(view.bankOfServer(bank.key, "")).toBeNull();
        expect(view.bankOfServer("nope", "g1")).toBeNull();
    });
});
