// The BiS lists the orga keeps by hand (#760): per version, spec and slot,
// written whole per slot, the shape kept sound whatever the file holds.
const fs = require("fs");
const store = require("../../../src/stores/loot/manualBisStore");
const { tempStoreFile } = require("../../helpers/tempStore");

let file = "";
beforeEach(() => {
    file = tempStoreFile("council-manual-bis.json");
    store.useFile(file);
});
afterAll(() => store.useFile(null));

describe("stores/loot/manualBisStore", () => {
    it("starts empty: nothing is ever filled by the code", () => {
        expect(store.listsFor("forever")).toEqual({});
        expect(store.hasLists("forever")).toBe(false);
    });

    it("keeps a slot whole, in order, per version and spec, with who and when", () => {
        const list = store.setSlot("forever", "Priest-Shadow", 0, [
            { id: 101, name: "Kapuze", icon: "INV_Helmet_01", quality: 4 },
            { id: 102 },
        ], { by: "Orga", now: 5 });
        expect(list).toEqual({
            slots: { 0: [{ id: 101, name: "Kapuze", icon: "inv_helmet_01", quality: 4 }, { id: 102, name: "", icon: "", quality: null }] },
            at: 5, by: "Orga",
        });
        expect(store.hasLists("forever")).toBe(true);
        // another version is untouched
        expect(store.listsFor("classic")).toEqual({});
        expect(JSON.parse(fs.readFileSync(file, "utf8")).versions.forever["Priest-Shadow"].slots["0"]).toHaveLength(2);
    });

    it("drops bad ids and doubles, and keeps at most MAX_PER_SLOT", () => {
        const list = store.setSlot("forever", "Mage-Fire", 10, [0, -3, "x", 7, 7, 8, 9, 10]);
        expect(list.slots[10].map((i) => i.id)).toEqual([7, 8, 9]);
        expect(store.MAX_PER_SLOT).toBe(3);
    });

    it("an empty slot clears it, the last one the spec, the last spec the version", () => {
        store.setSlot("forever", "Mage-Fire", 0, [1]);
        store.setSlot("forever", "Mage-Fire", 1, [2]);
        expect(store.setSlot("forever", "Mage-Fire", 0, []).slots).toEqual({ 1: [{ id: 2, name: "", icon: "", quality: null }] });
        expect(store.setSlot("forever", "Mage-Fire", 1, [])).toBeNull();
        expect(store.listsFor("forever")).toEqual({});
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ versions: {} });
    });

    it("refuses a slot outside the character sheet, a blank version or spec", () => {
        expect(store.setSlot("forever", "Mage-Fire", 3, [1])).toBeNull(); // shirt
        expect(store.setSlot("forever", "Mage-Fire", 18, [1])).toBeNull(); // tabard
        expect(store.setSlot("", "Mage-Fire", 0, [1])).toBeNull();
        expect(store.setSlot("forever", "", 0, [1])).toBeNull();
        expect(store.listsFor("forever")).toEqual({});
    });

    it("reads a hand-edited file into the sound shape", () => {
        fs.writeFileSync(file, JSON.stringify({
            versions: {
                forever: {
                    "Priest-Shadow": { slots: { 0: [{ id: 5, quality: 9 }], 3: [{ id: 6 }], 1: [] }, at: "x", by: 3 },
                    "Mage-Fire": { slots: {} },
                    "Druid-Balance": "junk",
                },
                classic: [],
            },
        }));
        expect(store.listsFor("forever")).toEqual({
            "Priest-Shadow": { slots: { 0: [{ id: 5, name: "", icon: "", quality: null }] }, at: 0, by: "3" },
        });
        expect(store.listsFor("classic")).toEqual({});
    });

    it("lists the character-sheet slots without shirt and tabard", () => {
        expect(store.MANUAL_SLOTS).toEqual([0, 1, 2, 14, 4, 8, 9, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17]);
    });
});
