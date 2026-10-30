// Items created by hand: a row for an item the bank does not hold.
const store = require("../../../src/stores/loot/guildBankStockStore");
const { tempStoreFile } = require("../../helpers/tempStore");

const KEY = "tbc:spineshatter:die gilde";

beforeAll(() => store.useFile(tempStoreFile("guild-bank-stock.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    for (const b of store.listBanks()) store.removeBank(b.key);
    store.recordScan({
        key: KEY, gameVersion: "tbc", realm: "Spineshatter", guild: "Die Gilde", faction: "Horde", scannedAt: 1,
        tabs: [{ index: 1, name: "A" }], items: { 22854: { count: 3, tabs: { 1: 3 } } },
    }, { now: 1, guildId: "g1" });
});

describe("stores/loot/guildBankStockStore addItem", () => {
    it("creates a row with stock 0 on give, marked as made by hand", () => {
        const result = store.addItem(KEY, 32227, { now: 500 });
        expect(result.created).toBe(true);
        expect(result.item).toMatchObject({ itemId: 32227, count: 0, status: "give", addedByHand: true, addedAt: 500, firstSeenAt: 500 });
        expect(store.getBank(KEY).items.map((i) => i.itemId)).toContain(32227);
        expect(store.getBank(KEY).counts).toMatchObject({ items: 2, give: 1, inStock: 1 });
    });

    it("leaves a known item alone and only sets the status", () => {
        store.setItemSettings(KEY, 22854, { reserve: 1, category: "Tränke" });
        const result = store.addItem(KEY, 22854, { status: "show" });
        expect(result.created).toBe(false);
        expect(result.item).toMatchObject({ count: 3, status: "show", reserve: 1, category: "Tränke", addedByHand: false });
    });

    it("keeps the row when a scan later shows the item", () => {
        store.addItem(KEY, 32227, { now: 500 });
        store.recordScan({
            key: KEY, gameVersion: "tbc", realm: "Spineshatter", guild: "Die Gilde", faction: "Horde", scannedAt: 2,
            tabs: [{ index: 1, name: "A" }], items: { 32227: { count: 2, tabs: { 1: 2 } } },
        }, { now: 2 });
        const item = store.getBank(KEY).items.find((i) => i.itemId === 32227);
        expect(item).toMatchObject({ count: 2, status: "give", addedByHand: true });
    });

    it("refuses an unknown bank, a bad id and a status the orga cannot set", () => {
        expect(store.addItem("nope", 5)).toEqual({ error: "Gildenbank nicht gefunden." });
        expect(store.addItem(KEY, 0)).toEqual({ error: "Ungültige Item-ID." });
        expect(store.addItem(KEY, "abc")).toEqual({ error: "Ungültige Item-ID." });
        expect(store.addItem(KEY, 5, { status: "new" })).toEqual({ error: "Unbekannte Einordnung." });
        expect(store.getBank(KEY).counts.items).toBe(1);
    });
});
