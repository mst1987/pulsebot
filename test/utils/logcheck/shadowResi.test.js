// Gear shadow resistance for Mother Shahraz: base item SR + enchant + gems,
// lowest first, and null when the report has no Shahraz pull.
const { analyzeShadowResi } = require("../../../src/utils/logcheck/shadowResi");
const { fight, fights } = require("../../factories/wcl");

// 1168 carries 10 base SR, 8367 carries 12 (config/claData.js SHADOW_RESISTANCE).
const SHAHRAZ = fight({ id: 7, boss: 100607, name: "Mother Shahraz" });
const withShahraz = { end: 0, fights: [...fights(2).fights, SHAHRAZ] };

const player = (name, type, gear, total = 100) => ({ name, type, total, gear });

describe("analyzeShadowResi", () => {
    it("returns null without a Shahraz fight or without fights at all", () => {
        expect(analyzeShadowResi({ entries: [] }, fights(3))).toBeNull();
        expect(analyzeShadowResi({ entries: [] }, null)).toBeNull();
        expect(analyzeShadowResi({ entries: [] }, { fights: [{ id: 1, boss: 0 }] })).toBeNull();
    });

    it("adds base, enchant and gem SR per item and sorts the lowest first", () => {
        const table = {
            entries: [
                player("Tanky", "Warrior", [
                    { id: 1168, name: "Skullflame Shield", icon: "inv_shield.jpg", slot: 16 },
                    { id: 5000, name: "Cloak", slot: 14, permanentEnchant: 1441 },
                    { id: 5001, name: "Helm", slot: 0, gems: [{ id: 22459 }, { id: 22460 }, { id: 1 }] },
                ]),
                player("Squishy", "Mage", [
                    { id: 8367, name: "Dragonmaw Helm", slot: 0 },
                ]),
                player("Naked", "Priest", [{ id: 5002, name: "Plain Robe", slot: 4 }]),
            ],
        };
        const out = analyzeShadowResi(table, withShahraz);
        expect(out.boss).toBe("Mother Shahraz");
        expect(out.note).toMatch(/Buffs nicht eingerechnet/);
        expect(out.players).toEqual([
            { name: "Naked", type: "Priest", sr: 0, items: [] },
            { name: "Squishy", type: "Mage", sr: 12, items: [{ itemId: "8367", itemName: "Dragonmaw Helm", icon: null, sr: 12 }] },
            {
                name: "Tanky",
                type: "Warrior",
                sr: 10 + 15 + 7,
                items: [
                    { itemId: "1168", itemName: "Skullflame Shield", icon: "inv_shield.jpg", sr: 10 },
                    { itemId: "5000", itemName: "Cloak", icon: null, sr: 15 },
                    { itemId: "5001", itemName: "Helm", icon: null, sr: 7 },
                ],
            },
        ]);
    });

    it("skips empty slots, the shirt (3) and the tabard (18)", () => {
        const table = {
            entries: [
                player("Skipper", "Rogue", [
                    null,
                    { name: "no id" },
                    { id: null },
                    { id: 0, permanentEnchant: 1441 },
                    { id: 1168, slot: 3 },
                    { id: 1168, slot: "18" },
                    { id: 1168, slot: 1, name: "Counted" },
                ]),
            ],
        };
        expect(analyzeShadowResi(table, withShahraz).players).toEqual([
            { name: "Skipper", type: "Rogue", sr: 10, items: [{ itemId: "1168", itemName: "Counted", icon: null, sr: 10 }] },
        ]);
    });

    it("only rates real players (a known class with activity)", () => {
        const table = {
            entries: [
                player("Pet", "Pet", [{ id: 1168 }]),
                player("Idle", "Mage", [{ id: 1168 }], 5),
                { name: "NoGear", type: "Druid", total: 50 },
            ],
        };
        expect(analyzeShadowResi(table, withShahraz).players).toEqual([
            { name: "NoGear", type: "Druid", sr: 0, items: [] },
        ]);
    });
});
