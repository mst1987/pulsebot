// Wish items of a character (services/characters/wishItems.js): only in a
// Loot-Council roster of the character's version, only items its Wowhead knows.
const rosterStore = require("../../../src/stores/roster/rosterStore");
const { tempStoreFile } = require("../../helpers/tempStore");
const { wishItemsAllowed, anyWishItemsAllowed, resolveWishItems, searchWishItems, wishItemView } = require("../../../src/services/characters/wishItems");

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
    const config = { ...LC, versionSettings: { tbc: { wowheadPath: "tbc" } } };
    const off = { ...LC, versionSettings: { tbc: { wowheadPath: "tbc", disabled: ["wowheadLinks"] } } };
    const ALT = { itemId: 1, name: "Alt", icon: "inv_a", quality: 4 };
    const OLD = { itemId: 3, name: "Drei", icon: "inv_c", quality: 3 };

    it("takes a new item's name, icon and quality from the version's Wowhead and keeps stored items as they are", async () => {
        const lookup = jest.fn(async (id, { path }) => (id === 2 ? { id, name: "Neu", icon: "inv_x", quality: 3, path } : null));
        const r = await resolveWishItems(ME, { ...BORKA, wishItems: [ALT] }, [1, { itemId: 2, name: "Fake" }, 2], { config, lookup });
        expect(r.items).toEqual([ALT, { itemId: 2, name: "Neu", icon: "inv_x", quality: 3 }]);
        expect(lookup).toHaveBeenCalledTimes(1);
        expect(lookup).toHaveBeenCalledWith(2, { path: "tbc", strict: true });
    });

    it("refuses a new item Wowhead does not know (400), and Wowhead not answering is its own 502", async () => {
        expect(await resolveWishItems(ME, BORKA, [99], { config, lookup: async () => null })).toMatchObject({ status: 400, code: "unknown_item" });
        const down = async () => { throw new Error("timeout"); };
        expect(await resolveWishItems(ME, BORKA, [99], { config, lookup: down })).toMatchObject({ status: 502, code: "wowhead_unavailable" });
    });

    it("needs Wowhead and a Loot-Council roster only for NEW items: taking out, reordering, emptying always pass", async () => {
        const lookup = jest.fn();
        const stored = { ...BORKA, wishItems: [ALT, OLD] };
        // without Wowhead links ...
        expect(await resolveWishItems(ME, stored, [], { config: off, lookup })).toEqual({ items: [] });
        expect(await resolveWishItems(ME, stored, [3, 1], { config: off, lookup })).toEqual({ items: [OLD, ALT] });
        // ... and outside a Loot-Council roster (the items stayed after the character left it)
        const orphan = { key: "frosti", versionId: "tbc", wishItems: [ALT] };
        expect(await resolveWishItems(ME, orphan, [], { config, lookup })).toEqual({ items: [] });
        expect(await resolveWishItems(ME, orphan, [2], { config, lookup })).toMatchObject({ status: 403, code: "not_loot_council" });
        expect(await resolveWishItems(ME, stored, [1, 2], { config: off, lookup })).toMatchObject({ status: 400, code: "no_wowhead" });
        expect(lookup).not.toHaveBeenCalled();
    });

    it("counts the ten after taking out doubles", async () => {
        const stored = { ...BORKA, wishItems: Array.from({ length: 10 }, (_, i) => ({ itemId: i + 1, name: `I${i}`, icon: "", quality: null })) };
        const doubled = [...stored.wishItems.map((w) => w.itemId), 1, 2];
        expect((await resolveWishItems(ME, stored, doubled, { config })).items).toHaveLength(10);
        expect(await resolveWishItems(ME, stored, [...doubled, 11], { config, lookup: async () => ({ name: "x" }) })).toMatchObject({ status: 400, code: "too_many" });
    });
});

describe("anyWishItemsAllowed", () => {
    it("is true when one of the raider's characters of the version is in a Loot-Council roster", () => {
        expect(anyWishItemsAllowed(ME, [{ key: "frosti", versionId: "tbc" }, BORKA], "tbc", { config: LC })).toBe(true);
        expect(anyWishItemsAllowed(ME, [{ key: "frosti", versionId: "tbc" }], "tbc", { config: LC })).toBe(false);
        expect(anyWishItemsAllowed(ME, [BORKA], "forever", { config: LC })).toBe(false);
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
