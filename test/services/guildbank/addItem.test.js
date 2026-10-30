// Create a guild bank item by hand: id, Wowhead link or name. Wowhead
// is mocked, the stores run on temp files.
jest.mock("../../../src/utils/loot/wowhead", () => ({
    ...jest.requireActual("../../../src/utils/loot/wowhead"),
    searchItems: jest.fn(),
    lookupItemDetails: jest.fn(),
}));

const wowhead = require("../../../src/utils/loot/wowhead");
const stockStore = require("../../../src/stores/loot/guildBankStockStore");
const requestStore = require("../../../src/stores/loot/guildBankStore");
const itemMeta = require("../../../src/services/guildbank/itemMeta");
const { parseQuery, pickHit, addByHand, search } = require("../../../src/services/guildbank/addItem");
const { tempStoreFile } = require("../../helpers/tempStore");

const KEY = "tbc:spineshatter:die gilde";
const SPINEL = { id: 32227, name: "Crimson Spinel", icon: "inv_jewelcrafting_crimsonspinel_01", quality: 4 };
const RUNED = { id: 32196, name: "Runed Crimson Spinel", icon: "x", quality: 4 };

beforeAll(() => {
    stockStore.useFile(tempStoreFile("guild-bank-stock.json"));
    requestStore.useFile(tempStoreFile("guild-bank.json"));
});
afterAll(() => {
    stockStore.useFile(null);
    requestStore.useFile(null);
});
beforeEach(async () => {
    await itemMeta.idle();
    itemMeta.reset();
    itemMeta.configure({ gap: 0 });
    jest.clearAllMocks();
    wowhead.lookupItemDetails.mockResolvedValue({ name: "Crimson Spinel", icon: "inv_jewelcrafting_crimsonspinel_01", quality: 4, classId: 3, subclassId: 0, className: "Gem", subclassName: "Red" });
    for (const b of stockStore.listBanks()) stockStore.removeBank(b.key);
    stockStore.recordScan({
        key: KEY, gameVersion: "tbc", realm: "Spineshatter", guild: "Die Gilde", faction: "Horde", scannedAt: 1, tabs: [], items: {},
    }, { now: 1, guildId: "g1" });
});

describe("addItem.parseQuery", () => {
    it("reads an id, a Wowhead link and a name", () => {
        expect(parseQuery("32227")).toEqual({ itemId: 32227 });
        expect(parseQuery(" https://www.wowhead.com/tbc/item=32227/crimson-spinel ")).toEqual({ itemId: 32227 });
        expect(parseQuery("https://www.wowhead.com/tbc/de/item=32231")).toEqual({ itemId: 32231 });
        expect(parseQuery("item=32227")).toEqual({ itemId: 32227 });
        expect(parseQuery("Crimson Spinel")).toEqual({ name: "Crimson Spinel" });
    });

    it("refuses nothing and links without an item", () => {
        expect(parseQuery("")).toBeNull();
        expect(parseQuery(null)).toBeNull();
        expect(parseQuery("https://example.com/foo")).toBeNull();
    });
});

describe("addItem.pickHit", () => {
    it("takes the one exact name, else the only hit", () => {
        expect(pickHit("crimson spinel", [RUNED, SPINEL])).toBe(SPINEL);
        expect(pickHit("Spinel", [SPINEL])).toBe(SPINEL);
        expect(pickHit("Spinel", [SPINEL, RUNED])).toBeNull();
    });
});

describe("addItem.addByHand", () => {
    it("adds Crimson Spinel (32227) by id with its meta from Wowhead, on give with stock 0", async () => {
        const result = await addByHand(KEY, { query: "32227" });
        expect(result.created).toBe(true);
        expect(result.item).toMatchObject({
            itemId: 32227, name: "Crimson Spinel", count: 0, status: "give", addedByHand: true, free: 0, available: 0,
        });
        expect(wowhead.lookupItemDetails).toHaveBeenCalledWith(32227, expect.objectContaining({ path: "tbc" }));
    });

    it("adds by Wowhead link and by an exact name", async () => {
        let result = await addByHand(KEY, { query: "https://www.wowhead.com/tbc/item=32227/crimson-spinel" });
        expect(result.item.itemId).toBe(32227);
        wowhead.searchItems.mockResolvedValue([RUNED, SPINEL]);
        result = await addByHand(KEY, { query: "Crimson Spinel" });
        expect(result.created).toBe(false);
        expect(wowhead.searchItems).toHaveBeenCalledWith("Crimson Spinel", expect.objectContaining({ path: "tbc" }));
    });

    it("hands back the hits when a name fits several items, and says so when none", async () => {
        wowhead.searchItems.mockResolvedValue([SPINEL, RUNED]);
        const many = await addByHand(KEY, { query: "Spinel" });
        expect(many).toEqual({ error: "Mehrere Treffer, bitte einen auswählen.", choices: [SPINEL, RUNED] });
        wowhead.searchItems.mockResolvedValue([]);
        expect((await addByHand(KEY, { query: "Nichts" })).error).toMatch(/nichts gefunden/);
        expect(stockStore.getBank(KEY).counts.items).toBe(0);
    });

    it("takes the item id the picker sent and answers without the name when Wowhead is slow or down", async () => {
        wowhead.lookupItemDetails.mockResolvedValue(null);
        const result = await addByHand(KEY, { itemId: 32231 }, { lookupWaitMs: 0 });
        expect(result.item).toMatchObject({ itemId: 32231, name: "", status: "give" });
    });

    it("refuses nonsense input and an unknown bank", async () => {
        expect((await addByHand(KEY, { query: "" })).error).toMatch(/Item-ID/);
        expect((await addByHand(KEY, { query: "https://example.com/x" })).error).toMatch(/Item-ID/);
        expect(await addByHand("nope", { query: "1" })).toEqual({ error: "Gildenbank nicht gefunden." });
        expect(await addByHand(KEY, { query: "12345678" })).toEqual({ error: "Ungültige Item-ID." });
    });

    it("searches Wowhead on the bank version's path", async () => {
        wowhead.searchItems.mockResolvedValue([SPINEL]);
        expect(await search("tbc", "Crimson")).toEqual([SPINEL]);
    });
});
