// Wish items of a character (services/characters/wishItems.js): only in a
// Loot-Council roster of the character's version, only items its Wowhead knows.
const rosterStore = require("../../../src/stores/rosterStore");
const { tempStoreFile } = require("../../helpers/tempStore");
const { wishItemsAllowed, resolveWishItems, searchWishItems, wishItemView } = require("../../../src/services/characters/wishItems");

const ME = "100000000000000001";
const OTHER = "100000000000000002";
const LC = { categoryLootSystem: { catLc: "lootcouncil", catSr: "softres" } };
const BORKA = { key: "borka", name: "Borka", versionId: "tbc", wishItems: [] };

beforeAll(() => rosterStore.useFile(tempStoreFile("wish-rosters.json")));
afterAll(() => rosterStore.useFile(null));

describe("wishItemsAllowed", () => {
    beforeAll(() => {
        const lc = rosterStore.createRoster({ name: "SSC LC", categoryId: "catLc", versionId: "tbc" });
        rosterStore.upsertMember(lc.id, ME, { chars: ["Borka"] });
        rosterStore.upsertMember(lc.id, OTHER, { chars: ["Other"] });
        const sr = rosterStore.createRoster({ name: "Kara SR", categoryId: "catSr", versionId: "tbc" });
        rosterStore.upsertMember(sr.id, ME, { chars: ["Frosti"] });
        const forever = rosterStore.createRoster({ name: "Forever LC", categoryId: "catLc", versionId: "forever" });
        rosterStore.upsertMember(forever.id, ME, { chars: ["Borka"] });
    });

    it("allows a character listed for the raider in a Loot-Council roster of its version", () => {
        expect(wishItemsAllowed(ME, BORKA, { config: LC })).toBe(true);
    });

    it("refuses a Softres roster, another raider's entry, and another version's roster", () => {
        expect(wishItemsAllowed(ME, { key: "frosti", versionId: "tbc" }, { config: LC })).toBe(false);
        expect(wishItemsAllowed(OTHER, BORKA, { config: LC })).toBe(false);
        // the Forever roster lists "forever~borka", not the TBC Borka
        expect(wishItemsAllowed(ME, { key: "forever~devi res", versionId: "forever" }, { config: LC })).toBe(false);
        expect(wishItemsAllowed(ME, BORKA, { config: {} })).toBe(false);
    });
});

describe("resolveWishItems", () => {
    const config = { versionSettings: { tbc: { wowheadPath: "tbc" } } };

    it("takes name, icon and quality from the version's Wowhead and keeps stored items as they are", async () => {
        const lookup = jest.fn(async (id, { path }) => (id === 2 ? { id, name: "Neu", icon: "inv_x", quality: 3, path } : null));
        const stored = { ...BORKA, wishItems: [{ itemId: 1, name: "Alt", icon: "inv_a", quality: 4 }] };
        const r = await resolveWishItems(stored, [1, { itemId: 2, name: "Fake" }, 2], { config, lookup });
        expect(r.items).toEqual([{ itemId: 1, name: "Alt", icon: "inv_a", quality: 4 }, { itemId: 2, name: "Neu", icon: "inv_x", quality: 3 }]);
        expect(lookup).toHaveBeenCalledTimes(1);
        expect(lookup).toHaveBeenCalledWith(2, { path: "tbc" });
    });

    it("refuses an item the version's Wowhead does not know, and a version without Wowhead", async () => {
        expect(await resolveWishItems(BORKA, [99], { config, lookup: async () => null })).toMatchObject({ code: "unknown_item" });
        const off = { versionSettings: { tbc: { wowheadPath: "tbc", disabled: ["wowheadLinks"] } } };
        expect(await resolveWishItems(BORKA, [1], { config: off, lookup: async () => ({ name: "x" }) })).toMatchObject({ code: "no_wowhead" });
    });
});

describe("searchWishItems / wishItemView", () => {
    it("searches the version's Wowhead path, nothing for a short query", async () => {
        const search = jest.fn(async () => [{ id: 1, name: "Helm" }]);
        const config = { versionSettings: { tbc: { wowheadPath: "tbc" } } };
        expect(await searchWishItems("tbc", "He", { config, search })).toEqual([{ id: 1, name: "Helm" }]);
        expect(search).toHaveBeenCalledWith("He", { path: "tbc", limit: 12 });
        expect(await searchWishItems("tbc", "H", { config, search })).toEqual([]);
    });

    it("adds the icon url and the version's item link", () => {
        const view = wishItemView({ itemId: 30236, name: "Helm", icon: "inv_helmet_01", quality: 4 }, "tbc", { config: { versionSettings: { tbc: { wowheadPath: "tbc" } } } });
        expect(view.iconUrl).toMatch(/inv_helmet_01\.jpg$/);
        expect(view.link).toMatch(/wowhead\.com\/tbc\/item=/);
    });
});
