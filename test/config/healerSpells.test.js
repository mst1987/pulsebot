// The healer analysis' spell tables: every rank of a tank aura and every mana
// source must be found by the id the log carries, whatever its type.
const { TANK_AURAS, ABSORB_IDS, MANA_REGEN, tankAuraById, manaRegenById } = require("../../src/config/healerSpells");

describe("config/healerSpells", () => {
    it("finds a tank aura by any of its rank ids, as number or string", () => {
        expect(tankAuraById(974).key).toBe("earthShield");
        expect(tankAuraById("32594").key).toBe("earthShield");
        expect(tankAuraById(25218).key).toBe("pws");
        expect(tankAuraById(33763)).toMatchObject({ key: "lifebloom", stacks: 3, provider: "Druid" });
    });

    it("finds a mana source by the energize id the log credits", () => {
        expect(manaRegenById(28499)).toMatchObject({ key: "superMana", kind: "potion" });
        expect(manaRegenById("16191")).toMatchObject({ key: "manaTide", kind: "cooldown" });
        expect(manaRegenById(29166)).toMatchObject({ key: "innervate", kind: "external" });
    });

    it("answers undefined for an id it does not know", () => {
        expect(tankAuraById(1)).toBeUndefined();
        expect(manaRegenById("")).toBeUndefined();
    });

    it("counts only the Power Word: Shield ranks as absorbs, as strings", () => {
        const pws = TANK_AURAS.find((a) => a.key === "pws");
        expect([...ABSORB_IDS]).toEqual(pws.ids.map(String));
        expect(ABSORB_IDS.has("17")).toBe(true);
        expect(ABSORB_IDS.has("774")).toBe(false);
    });

    it("keeps keys unique and gives every entry an icon and at least one id", () => {
        for (const table of [TANK_AURAS, MANA_REGEN]) {
            const keys = table.map((e) => e.key);
            expect(new Set(keys).size).toBe(keys.length);
            for (const e of table) {
                expect(e.ids.length).toBeGreaterThan(0);
                expect(e.icon).toMatch(/^[a-z0-9_]+$/);
            }
        }
    });
});
