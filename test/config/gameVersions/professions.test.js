// The main professions of a version for "Mein Profil" (config/gameVersions
// professionsOf, data in gameVersions/professions.js): TBC's ten up to 375,
// Classic Era the same without Jewelcrafting up to 300, WoW Forever none yet.
const { professionsOf } = require("../../../src/config/gameVersions");
const { TBC_PROFESSIONS, CLASSIC_PROFESSIONS } = require("../../../src/config/gameVersions/professions");

describe("professionsOf", () => {
    it("gives TBC its ten main professions up to 375, with German and English names and an icon", () => {
        const tbc = professionsOf("tbc");
        expect(tbc.skillMax).toBe(375);
        expect(tbc.professions.map((p) => p.id)).toEqual([
            "alchemy", "blacksmithing", "enchanting", "engineering", "herbalism", "jewelcrafting", "leatherworking", "mining", "skinning", "tailoring",
        ]);
        expect(tbc.professions.find((p) => p.id === "herbalism")).toEqual({ id: "herbalism", label: "Kräuterkunde", labelEn: "Herbalism", icon: "trade_herbalism" });
        for (const p of TBC_PROFESSIONS) expect(p.icon).toMatch(/^[a-z0-9_]+$/);
    });

    it("gives Classic Era the same without Jewelcrafting, up to 300", () => {
        const classic = professionsOf("classic");
        expect(classic.skillMax).toBe(300);
        expect(classic.professions.map((p) => p.id)).toEqual(CLASSIC_PROFESSIONS.map((p) => p.id));
        expect(classic.professions.map((p) => p.id)).not.toContain("jewelcrafting");
        expect(classic.professions).toHaveLength(9);
    });

    it("has no list for WoW Forever yet (decision open) and none for an unknown version", () => {
        expect(professionsOf("forever")).toEqual({ professions: [], skillMax: null });
        expect(professionsOf("nope")).toEqual({ professions: [], skillMax: null });
    });
});
