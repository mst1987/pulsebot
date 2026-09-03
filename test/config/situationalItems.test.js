// The list of items whose worth depends on the boss, and the reason it exists:
// they carry no caster stats, so every comparison reads such a slot as empty.
const { SITUATIONAL_ITEMS, situationalItem, isSituational } = require("../../src/config/situationalItems");
const wowsims = require("../../src/config/wowsims");

describe("config/situationalItems", () => {
    it("knows both halves of Mark of the Champion", () => {
        expect(isSituational(23206)).toBe(true);
        expect(isSituational(23207)).toBe(true);
        expect(situationalItem(23207).name).toBe("Mark of the Champion");
    });

    it("takes a string id too — a log row carries ids as strings", () => {
        expect(isSituational("23207")).toBe(true);
    });

    it("leaves ordinary gear alone", () => {
        expect(isSituational(31064)).toBe(false);
        expect(situationalItem(0)).toBeNull();
        expect(situationalItem(undefined)).toBeNull();
    });

    it("says why every entry does not count, not just that it does not", () => {
        for (const [id, entry] of Object.entries(SITUATIONAL_ITEMS)) {
            expect(entry.name).toBeTruthy();
            // The note is shown to the council, so it has to read as a reason.
            expect(entry.note.length).toBeGreaterThan(20);
            expect(String(Number(id))).toBe(id);
        }
    });

    it("lists only items the caster table does not carry — which is the point", () => {
        // Such an item has no caster stats at all, so the stat weights score it
        // at 0 and WoWSims sims it as an empty slot (measured: 1758 DPS with
        // Mark of the Champion, 1758 with the trinket slot empty, 1813 with a
        // real trinket). An entry the table *does* know would be valued
        // normally, and flagging it would mislead rather than warn.
        for (const id of Object.keys(SITUATIONAL_ITEMS)) {
            expect(wowsims.item(id)).toBeNull();
        }
    });
});
