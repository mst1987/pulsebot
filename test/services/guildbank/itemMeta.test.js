// The item names of the guild bank stock: local tables at once, Wowhead in the
// background — one request per item and version, the store as the cache.
jest.mock("../../../src/utils/loot/wowhead", () => ({
    ...jest.requireActual("../../../src/utils/loot/wowhead"),
    lookupItemDetails: jest.fn(),
}));
jest.mock("../../../src/services/events/versionSettings", () => ({
    settingsForVersion: jest.fn((v) => ({ versionId: v, wowheadPath: v === "tbc" ? "tbc" : "" })),
}));

const wowhead = require("../../../src/utils/loot/wowhead");
const { settingsForVersion } = require("../../../src/services/events/versionSettings");
const store = require("../../../src/stores/guildBankStockStore");
const itemMeta = require("../../../src/services/guildbank/itemMeta");
const { parseGuildBankScan, GB_FORMAT } = require("../../../src/utils/guildbank/guildBankScan");
const { tempStoreFile } = require("../../helpers/tempStore");

const NOW = 1_800_000_000_000;

function record(itemIds, { guild = "Die Gilde", project = "tbc" } = {}) {
    const scan = parseGuildBankScan({
        format: GB_FORMAT, version: 1, client: { project }, guild: { name: guild, realm: "Spineshatter" },
        scannedAt: 1791000000, tabs: [{ index: 1, name: "A", items: itemIds.map((itemId) => ({ itemId, count: 1 })) }],
    });
    return { scan, ...store.recordScan(scan, { now: NOW }) };
}

const details = (id, name) => ({ id, name, icon: `icon_${id}`, quality: 1, classId: 0, subclassId: 3, className: "Verbrauchbar", subclassName: "Fläschchen" });
const itemOf = (key, id) => store.getBank(key).items.find((i) => i.itemId === id);

beforeAll(() => store.useFile(tempStoreFile("guild-bank-stock.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    jest.clearAllMocks();
    for (const b of store.listBanks()) store.removeBank(b.key);
    itemMeta.reset();
    itemMeta.configure({ gap: 0 });
    wowhead.lookupItemDetails.mockImplementation(async (id) => details(id, `Gegenstand ${id}`));
});

describe("services/guildbank/itemMeta", () => {
    it("asks Wowhead on the version's own path, Classic's for Forever until it has one", () => {
        expect(itemMeta.wowheadPathFor("tbc")).toBe("tbc");
        expect(itemMeta.wowheadPathFor("forever")).toBe("classic");
        expect(itemMeta.wowheadPathFor("classic")).toBe("classic");
        settingsForVersion.mockImplementationOnce(() => ({ versionId: "tbc", wowheadPath: "tbc" }));
        expect(itemMeta.wowheadPathFor("wotlk")).toBe("tbc");
        settingsForVersion.mockImplementationOnce(() => {
            throw new Error("no config");
        });
        expect(itemMeta.wowheadPathFor("forever")).toBe("classic");
    });

    it("knows TBC items from the WoWSims table and the raid loot names, nothing for other versions", () => {
        expect(itemMeta.localMeta("tbc", 944)).toEqual({ name: "Elemental Mage Staff", icon: "inv_staff_07", quality: 4 });
        expect(itemMeta.localMeta("tbc", 21882)).toEqual({ name: "Soul Essence", icon: "spell_shadow_soulleech_3", quality: 1 });
        expect(itemMeta.localMeta("tbc", 22854)).toBeNull();
        expect(itemMeta.localMeta("classic", 944)).toBeNull();
    });

    it("fills local names at once, only where nothing is there yet", () => {
        const { scan } = record([944, 22854]);
        expect(itemMeta.applyLocalMeta("tbc", [944, 22854], { now: NOW })).toBe(1);
        expect(itemOf(scan.key, 944)).toMatchObject({ name: "Elemental Mage Staff", metaSource: "local", quality: 4 });
        expect(itemOf(scan.key, 22854)).toMatchObject({ name: "", metaSource: "" });
        expect(itemMeta.applyLocalMeta("tbc", [944], { now: NOW })).toBe(0);
        expect(itemMeta.applyLocalMeta("tbc", undefined)).toBe(0);
    });

    it("looks every item up once in the background and keeps the German answer", async () => {
        const { scan } = record([22854, 24027]);
        expect(itemMeta.queueLookups("tbc", [22854, 24027, 22854, 0, "x"])).toBeGreaterThan(0);
        await itemMeta.idle();
        expect(wowhead.lookupItemDetails).toHaveBeenCalledTimes(2);
        expect(wowhead.lookupItemDetails).toHaveBeenCalledWith(22854, { path: "tbc", locale: "de" });
        expect(itemOf(scan.key, 22854)).toMatchObject({ name: "Gegenstand 22854", metaSource: "wowhead", subclassName: "Fläschchen", icon: "icon_22854" });
        expect(store.itemsWithoutWowheadMeta(scan.key)).toEqual([]);
    });

    it("replaces a local English name with the German Wowhead answer and keeps the local icon when Wowhead has none", async () => {
        const { scan } = record([944]);
        itemMeta.applyLocalMeta("tbc", [944], { now: NOW });
        expect(store.itemsWithoutWowheadMeta(scan.key)).toEqual([944]);
        wowhead.lookupItemDetails.mockResolvedValueOnce({ id: 944, name: "Elementarmagierstab", icon: "", quality: null, classId: 2, subclassId: 10, className: "Waffe", subclassName: "Stab" });
        itemMeta.queueLookups("tbc", store.itemsWithoutWowheadMeta(scan.key));
        await itemMeta.idle();
        expect(itemOf(scan.key, 944)).toMatchObject({ name: "Elementarmagierstab", icon: "inv_staff_07", quality: 4, metaSource: "wowhead", className: "Waffe" });
    });

    it("takes an answer another bank of the version already has, without a request", async () => {
        record([22854]);
        itemMeta.queueLookups("tbc", [22854]);
        await itemMeta.idle();
        const other = record([22854], { guild: "Andere" });
        itemMeta.queueLookups("tbc", [22854]);
        await itemMeta.idle();
        expect(wowhead.lookupItemDetails).toHaveBeenCalledTimes(1);
        expect(itemOf(other.scan.key, 22854)).toMatchObject({ name: "Gegenstand 22854", metaSource: "wowhead" });
    });

    it("does not repeat a failed lookup for a while, then tries again", async () => {
        const { scan } = record([5]);
        wowhead.lookupItemDetails.mockResolvedValueOnce(null);
        itemMeta.queueLookups("tbc", [5]);
        await itemMeta.idle();
        expect(itemOf(scan.key, 5).metaSource).toBe("");
        expect(itemMeta.queueLookups("tbc", [5])).toBe(0);
        itemMeta.queueLookups("tbc", [5], { now: Date.now() + itemMeta.RETRY_AFTER_MS + 1 });
        await itemMeta.idle();
        expect(wowhead.lookupItemDetails).toHaveBeenCalledTimes(2);
        expect(itemOf(scan.key, 5).name).toBe("Gegenstand 5");
    });

    it("survives a lookup that throws and goes on with the rest", async () => {
        const { scan } = record([6, 7]);
        wowhead.lookupItemDetails.mockRejectedValueOnce(new Error("boom"));
        itemMeta.queueLookups("tbc", [6, 7]);
        await itemMeta.idle();
        expect(itemOf(scan.key, 6).metaSource).toBe("");
        expect(itemOf(scan.key, 7).metaSource).toBe("wowhead");
    });

    it("pauses between two requests", async () => {
        record([8, 9]);
        itemMeta.configure({ gap: 30 });
        const started = Date.now();
        itemMeta.queueLookups("tbc", [8, 9]);
        await itemMeta.idle();
        expect(Date.now() - started).toBeGreaterThanOrEqual(25);
        expect(wowhead.lookupItemDetails).toHaveBeenCalledTimes(2);
    });

    it("is idle with nothing queued", async () => {
        await expect(itemMeta.idle()).resolves.toBeUndefined();
        expect(itemMeta.queueLookups("tbc", [])).toBe(0);
    });
});
