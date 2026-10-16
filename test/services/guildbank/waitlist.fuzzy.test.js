// The import forgives a typo in the item name: the one item within two
// letters (and a fifth of the name) is taken, the preview marks it `fuzzy`.
const stockStore = require("../../../src/stores/guildBankStockStore");
const store = require("../../../src/stores/guildBankStore");
const profiles = require("../../../src/stores/raiderProfileStore");
const waitlist = require("../../../src/services/guildbank/waitlist");
const { tempStoreFile } = require("../../helpers/tempStore");

const named = (itemId, name) => ({ itemId, name });
const ITEMS = [named(32227, "Crimson Spinel"), named(32231, "Pyrestone"), named(32228, "Empyrean Sapphire"), named(1, "Ore")];

describe("waitlist.findItem", () => {
    it("takes the exact name first, without the fuzzy flag", () => {
        expect(waitlist.findItem("crimson spinel", ITEMS)).toEqual({ item: ITEMS[0], fuzzy: false });
        expect(waitlist.findItem("32231", ITEMS)).toEqual({ item: ITEMS[1], fuzzy: false });
    });

    it("forgives a typo: Crimson Spinal finds Crimson Spinel", () => {
        expect(waitlist.findItem("Crimson Spinal", ITEMS)).toEqual({ item: ITEMS[0], fuzzy: true });
        expect(waitlist.findItem("  crimsn spinel ", ITEMS)).toEqual({ item: ITEMS[0], fuzzy: true });
        expect(waitlist.matchItem("Pyrestoen", ITEMS)).toBe(ITEMS[1]);
    });

    it("takes nothing when two items are equally close", () => {
        const twins = [named(1, "Bold Crimson Spinel"), named(2, "Bold Crimson Spinal")];
        expect(waitlist.findItem("Bold Crimson Spinul", twins)).toEqual({ item: null, fuzzy: false });
    });

    it("is not generous with short names or far-off ones", () => {
        expect(waitlist.findItem("Orc", ITEMS)).toEqual({ item: null, fuzzy: false });
        expect(waitlist.findItem("Ire", ITEMS)).toEqual({ item: null, fuzzy: false });
        expect(waitlist.findItem("Crimson Ruby", ITEMS)).toEqual({ item: null, fuzzy: false });
        expect(waitlist.findItem("Pyre", ITEMS)).toEqual({ item: null, fuzzy: false });
        expect(waitlist.findItem("", ITEMS)).toEqual({ item: null, fuzzy: false });
        expect(waitlist.findItem("99", ITEMS)).toEqual({ item: null, fuzzy: false });
    });

    it("measures the edit distance", () => {
        expect(waitlist.levenshtein("spinel", "spinal")).toBe(1);
        expect(waitlist.levenshtein("", "abc")).toBe(3);
        expect(waitlist.levenshtein("kitten", "sitting")).toBe(3);
    });
});

describe("waitlist.previewImport with a typo", () => {
    beforeAll(() => {
        store.useFile(tempStoreFile("guild-bank.json"));
        stockStore.useFile(tempStoreFile("guild-bank-stock.json"));
        profiles.useFile(tempStoreFile("profiles.json"));
    });
    afterAll(() => {
        store.useFile(null);
        stockStore.useFile(null);
        profiles.reset();
    });

    it("shows the real item and marks the row fuzzy", () => {
        const KEY = "tbc:spineshatter:die gilde";
        stockStore.recordScan({
            key: KEY, gameVersion: "tbc", realm: "Spineshatter", guild: "Die Gilde", faction: "Horde", scannedAt: 1, tabs: [], items: {},
        }, { now: 1, guildId: "g1" });
        stockStore.addItem(KEY, 32227, { now: 1 });
        stockStore.setItemMeta("tbc", 32227, { name: "Crimson Spinel", icon: "inv_x" }, { source: "wowhead" });
        const { rows } = waitlist.previewImport(KEY, "Anna\tCrimson Spinal\t1\nBob\tCrimson Spinel\t1");
        expect(rows[0]).toMatchObject({ ok: true, fuzzy: true, item: { itemId: 32227, name: "Crimson Spinel" } });
        expect(rows[1]).toMatchObject({ ok: true, fuzzy: false });
        const imported = waitlist.importLines(KEY, "Anna\tCrimson Spinal\t1");
        expect(imported.added).toHaveLength(1);
        expect(imported.added[0]).toMatchObject({ itemId: 32227, item: "Crimson Spinel" });
    });
});
