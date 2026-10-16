// The main professions of a version for "Mein Profil" (config/gameVersions
// professionsOf): from the rule set only - none carries a list yet.
const { professionsOf, VERSIONS } = require("../../../src/config/gameVersions");

describe("professionsOf", () => {
    it("has no list in any rule set yet, so no version offers the part", () => {
        for (const v of VERSIONS) expect(professionsOf(v.id)).toEqual({ professions: [], skillMax: null });
    });

    it("answers an empty list for an unknown version", () => {
        expect(professionsOf("nope")).toEqual({ professions: [], skillMax: null });
    });
});
