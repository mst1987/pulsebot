// "Automatisch verteilen" (docs/kaderplaner.md): a deterministic start for the
// groups, not an optimiser.
const { autoAssign, GROUP_SIZE } = require("../../../src/services/kader/kaderAutoAssign");

const p = (userId, role, classKey, rate = 0.5) => ({ userId, role, classKey, rate });

describe("services/kader/kaderAutoAssign", () => {
    it("puts one tank per group first and spreads the healers", () => {
        const { groups } = autoAssign([
            p("t1", "tank", "Warrior"), p("t2", "tank", "Druid"),
            p("h1", "healer", "Priest"), p("h2", "healer", "Priest"),
        ], 2);
        expect(groups.map((g) => g.filter(Boolean))).toEqual([["t1", "h1"], ["t2", "h2"]]);
        expect(groups.every((g) => g.length === GROUP_SIZE)).toBe(true);
    });

    it("spreads shamans and sends melee to them, casters to the healers", () => {
        const { groups } = autoAssign([
            p("h1", "healer", "Priest"),
            p("s1", "melee", "Shaman"), p("s2", "ranged", "Shaman"),
            p("m1", "melee", "Rogue"), p("r1", "ranged", "Mage"),
        ], 2);
        const groupOf = (id) => groups.findIndex((g) => g.includes(id));
        expect(groupOf("s1")).not.toBe(groupOf("s2"));
        expect(groups.flat().filter(Boolean)).toHaveLength(5);
    });

    it("places the best attendance first and reports what does not fit", () => {
        const members = Array.from({ length: 7 }, (_, i) => p(`m${i}`, "melee", "Rogue", i / 10));
        const { groups, unassigned } = autoAssign(members, 1);
        expect(groups[0]).toEqual(["m6", "m5", "m4", "m3", "m2"]);
        expect(unassigned).toEqual(["m1", "m0"]);
    });
});
