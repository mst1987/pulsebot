// The TBC tables the log-check analyzers read (#747: moved out of the
// analyzers, contents unchanged) — and the analyzers still hand out the same objects.
const tables = require("../../../src/config/data/logcheckTables");

describe("config/logcheckTables", () => {
    it("lists every potion once, in one of the three report groups", () => {
        const keys = tables.POTION_TYPES.map((t) => t.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const t of tables.POTION_TYPES) {
            expect(["destruction", "haste", "mana"]).toContain(t.group);
            expect(t.ids.length).toBeGreaterThan(0);
        }
        expect(keys.slice(0, 3)).toEqual(["destruction", "haste", "superMana"]);
    });

    it("knows the four drums in both issues, Bloodlust and Heroism, the shadow-resistance enchants and the zone tags", () => {
        expect(new Set(Object.values(tables.DRUM_TYPE))).toEqual(new Set(["Battle", "War", "Restoration", "Speed"]));
        expect(Object.keys(tables.DRUM_TYPE)).toHaveLength(8);
        expect([...tables.LUST_IDS]).toEqual(["2825", "32182"]);
        expect(tables.LUST_MS).toBe(40000);
        expect(tables.SR_ENCHANT[3009]).toBe(20);
        expect(tables.SR_GEM[22459]).toBe(4);
        expect(tables.ZONE_TAGS[1011]).toEqual(["BT", "MH"]);
    });

    it("is what the analyzers export under their old names", () => {
        expect(require("../../../src/utils/logcheck/potions").POTION_TYPES).toBe(tables.POTION_TYPES);
        expect(require("../../../src/utils/logcheck/drums").DRUM_TYPE).toBe(tables.DRUM_TYPE);
        expect(require("../../../src/utils/logcheck/cooldownTimeline").LUST_IDS).toBe(tables.LUST_IDS);
        expect(require("../../../src/utils/logcheck/shadowResi").SR_ENCHANT).toBe(tables.SR_ENCHANT);
        expect(require("../../../src/utils/logcheck/rpb/validate").ZONE_TAGS).toBe(tables.ZONE_TAGS);
    });
});
