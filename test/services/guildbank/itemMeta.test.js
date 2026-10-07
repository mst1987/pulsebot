// The item names of the guild bank stock: local tables at once, Wowhead in the
// background — one request per item and version, the store as the cache. Names
// are English; German meta stored before (meta version 1) is refreshed, and the
// pending requests of an item take its new name.
jest.mock("../../../src/utils/loot/wowhead", () => ({
    ...jest.requireActual("../../../src/utils/loot/wowhead"),
    lookupItemDetails: jest.fn(),
}));
jest.mock("../../../src/services/events/versionSettings", () => ({
    settingsForVersion: jest.fn((v) => ({ versionId: v, wowheadPath: v === "tbc" ? "tbc" : "" })),
}));

const wowhead = require("../../../src/utils/loot/wowhead");
const { settingsForVersion } = require("../../../src/services/events/versionSettings");
const fs = require("fs");
const store = require("../../../src/stores/guildBankStockStore");
const requestStore = require("../../../src/stores/guildBankStore");
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

const details = (id, name) => ({ id, name, icon: `icon_${id}`, quality: 1, classId: 0, subclassId: 3, className: "Consumables", subclassName: "Flasks" });
const itemOf = (key, id) => store.getBank(key).items.find((i) => i.itemId === id);

const FILE = tempStoreFile("guild-bank-stock.json");
const REQUESTS = tempStoreFile("guild-bank.json");

/** Turn an item's stored meta into what #636 stored: a German Wowhead answer, no meta version. */
function makeStale(key, id, german) {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const item = data.banks.find((b) => b.key === key).items[String(id)];
    Object.assign(item, { name: german, className: "Edelsteine", subclassName: "Rot", metaSource: "wowhead" });
    delete item.metaVersion;
    fs.writeFileSync(FILE, JSON.stringify(data));
    store.useFile(FILE);
}

beforeAll(() => {
    store.useFile(FILE);
    requestStore.useFile(REQUESTS);
});
afterAll(() => {
    store.useFile(null);
    requestStore.useFile(null);
});
beforeEach(() => {
    jest.clearAllMocks();
    for (const b of store.listBanks()) store.removeBank(b.key);
    for (const r of requestStore.listRequests()) requestStore.removeRequest(r.id);
    itemMeta.reset();
    itemMeta.configure({ gap: 0 });
    wowhead.lookupItemDetails.mockImplementation(async (id) => details(id, `Item ${id}`));
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

    it("looks every item up once in the background, in English", async () => {
        const { scan } = record([22854, 24027]);
        expect(itemMeta.queueLookups("tbc", [22854, 24027, 22854, 0, "x"])).toBeGreaterThan(0);
        await itemMeta.idle();
        expect(wowhead.lookupItemDetails).toHaveBeenCalledTimes(2);
        expect(wowhead.lookupItemDetails).toHaveBeenCalledWith(22854, { path: "tbc", locale: "en" });
        expect(itemOf(scan.key, 22854)).toMatchObject({
            name: "Item 22854", metaSource: "wowhead", metaVersion: store.META_VERSION, subclassId: 3, subclassName: "Flasks", icon: "icon_22854",
        });
        expect(store.itemsWithoutWowheadMeta(scan.key)).toEqual([]);
    });

    it("keeps the local English name's icon when Wowhead has none, and takes the class from Wowhead", async () => {
        const { scan } = record([944]);
        itemMeta.applyLocalMeta("tbc", [944], { now: NOW });
        expect(store.itemsWithoutWowheadMeta(scan.key)).toEqual([944]);
        wowhead.lookupItemDetails.mockResolvedValueOnce({ id: 944, name: "Elemental Mage Staff", icon: "", quality: null, classId: 2, subclassId: 10, className: "Weapon", subclassName: "Staff" });
        itemMeta.queueLookups("tbc", store.itemsWithoutWowheadMeta(scan.key));
        await itemMeta.idle();
        expect(itemOf(scan.key, 944)).toMatchObject({ name: "Elemental Mage Staff", icon: "inv_staff_07", quality: 4, metaSource: "wowhead", classId: 2 });
    });

    it("refreshes German names stored before: the local name at once, then the English lookup", async () => {
        const { scan } = record([944, 24027]);
        itemMeta.queueLookups("tbc", [944, 24027]);
        await itemMeta.idle();
        makeStale(scan.key, 944, "Elementarmagierstab");
        makeStale(scan.key, 24027, "Klobiger lebendiger Rubin");
        expect(store.itemsWithoutWowheadMeta(scan.key)).toEqual([944, 24027]);
        expect(store.knownMeta("tbc", 24027)).toBeNull();
        wowhead.lookupItemDetails.mockClear();
        wowhead.lookupItemDetails.mockImplementation(async (id) => (id === 24027
            ? { id, name: "Bold Living Ruby", icon: "inv_jewelcrafting_livingruby_03", quality: 3, classId: 3, subclassId: 0, className: "Gems", subclassName: "Red" }
            : null));

        expect(itemMeta.refreshStaleMeta({ now: NOW })).toEqual({ banks: 1, items: 2 });
        // the local table knows the staff: English at once, before Wowhead answers
        expect(itemOf(scan.key, 944)).toMatchObject({ name: "Elemental Mage Staff", metaSource: "local", classId: 0 });
        await itemMeta.idle();
        expect(itemOf(scan.key, 24027)).toMatchObject({ name: "Bold Living Ruby", metaSource: "wowhead", metaVersion: store.META_VERSION, classId: 3 });
        expect(wowhead.lookupItemDetails).toHaveBeenCalledTimes(2);
        expect(store.itemsWithoutWowheadMeta(scan.key)).toEqual([944]);
        expect(itemMeta.refreshStaleMeta({ now: NOW })).toEqual({ banks: 1, items: 1 });
    });

    it("gives the open and confirmed requests of an item its new name, not the handled ones", async () => {
        const { scan } = record([24027]);
        const ask = (status) => {
            const { request } = requestStore.addRequest({
                userId: `u-${status}`, item: "Klobiger lebendiger Rubin", amount: 1, bankKey: scan.key, itemId: 24027,
            }, { now: NOW });
            if (status === "confirmed") requestStore.confirmRequest(request.id, { by: "o" }, { now: NOW });
            if (status === "rejected") requestStore.resolveRequest(request.id, { status: "rejected", by: "o" }, { now: NOW });
            return request.id;
        };
        const open = ask("open");
        const confirmed = ask("confirmed");
        const rejected = ask("rejected");
        const other = requestStore.addRequest({ userId: "u-other", item: "Klobiger lebendiger Rubin", amount: 1, bankKey: "tbc:x:y", itemId: 24027 }).request.id;
        wowhead.lookupItemDetails.mockResolvedValueOnce({ id: 24027, name: "Bold Living Ruby", icon: "", quality: 3, classId: 3, subclassId: 0 });
        itemMeta.queueLookups("tbc", [24027]);
        await itemMeta.idle();
        const name = (id) => requestStore.getRequest(id).item;
        expect([name(open), name(confirmed), name(rejected), name(other)])
            .toEqual(["Bold Living Ruby", "Bold Living Ruby", "Klobiger lebendiger Rubin", "Klobiger lebendiger Rubin"]);
    });

    it("sweeps once a little after the start, and can be stopped before", () => {
        jest.useFakeTimers();
        try {
            const { scan } = record([944]);
            itemMeta.startMetaRefresh({ delayMs: 1000 });
            expect(itemMeta.startMetaRefresh({ delayMs: 1000 })).toBeTruthy();
            expect(itemOf(scan.key, 944).metaSource).toBe("");
            jest.advanceTimersByTime(1000);
            expect(itemOf(scan.key, 944)).toMatchObject({ name: "Elemental Mage Staff", metaSource: "local" });
            itemMeta.reset();

            const other = record([21882], { guild: "Andere" });
            itemMeta.startMetaRefresh({ delayMs: 1000 });
            itemMeta.stopMetaRefresh();
            itemMeta.stopMetaRefresh();
            jest.advanceTimersByTime(2000);
            expect(itemOf(other.scan.key, 21882).metaSource).toBe("");
        } finally {
            itemMeta.reset();
            jest.useRealTimers();
        }
    });

    it("takes an answer another bank of the version already has, without a request", async () => {
        record([22854]);
        itemMeta.queueLookups("tbc", [22854]);
        await itemMeta.idle();
        const other = record([22854], { guild: "Andere" });
        itemMeta.queueLookups("tbc", [22854]);
        await itemMeta.idle();
        expect(wowhead.lookupItemDetails).toHaveBeenCalledTimes(1);
        expect(itemOf(other.scan.key, 22854)).toMatchObject({ name: "Item 22854", metaSource: "wowhead" });
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
        expect(itemOf(scan.key, 5).name).toBe("Item 5");
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
