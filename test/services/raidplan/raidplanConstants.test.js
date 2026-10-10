// The assignment types and class ids of a plan come from the version's rule set (#751).
const { ASSIGN_TYPES, ASSIGN_TYPE_VERSIONS, CLASS_IDS, typesOfVersion, classIdsOf } = require("../../../src/services/raidplan/raidplanConstants");

describe("services/raidplan/raidplanConstants", () => {
    it("offers every type to TBC and to a plan without a version", () => {
        expect(typesOfVersion("tbc")).toEqual(ASSIGN_TYPES);
        expect(typesOfVersion("")).toEqual(ASSIGN_TYPES);
    });

    it("drops only what the version truly does not have: Misdirection in Classic and Forever", () => {
        for (const v of ["classic", "forever"]) {
            const types = typesOfVersion(v);
            expect(types).not.toContain("md");
            // soulstone, thunderclap, demoralizing shout, fear ward, curse, totem, blessing, aura exist in Classic
            for (const t of ["ss", "thunderclap", "demoshout", "fearward", "curse", "totem", "blessing", "aura", "brez"]) expect(types).toContain(t);
        }
        expect(Object.keys(ASSIGN_TYPE_VERSIONS)).toEqual(["md"]);
    });

    it("reads the classes from the rule set", () => {
        expect(classIdsOf("forever")).toEqual(classIdsOf("tbc"));
        expect(classIdsOf("forever")).toHaveLength(9);
        expect(classIdsOf("nope")).toEqual([]);
        expect(CLASS_IDS).toEqual(classIdsOf("tbc"));
    });
});
