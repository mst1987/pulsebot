const { formatSpecs, formatSignUps } = require("../../src/utils/format");
const { mockInteraction } = require("../helpers/mockInteraction.js");
const { entryFor } = require("../../src/config/classlist.js");

describe("utils/format", () => {
    describe("formatSpecs", () => {
        it("maps known spec keys to className/specName", () => {
            const result = formatSpecs("Holy1", "10");
            expect(result).toEqual([{ className: "Paladin", specName: "Holy1" }]);
        });

        it("uses the role for template 40", () => {
            expect(formatSpecs("Holy1", "40")[0].className).toBe("healer");
            expect(formatSpecs("TankRogue", "40")[0].className).toBe("tank");
            expect(formatSpecs("PALADIN", "40")[0].className).toBeUndefined();
        });

        it("sends Raid-Helper's own \"Tank\" class for its tank entries", () => {
            expect(formatSpecs("ProtPala", "10")).toEqual([{ className: "Tank", specName: "Protection1" }]);
            expect(formatSpecs("Guardian", "10")).toEqual([{ className: "Druid", specName: "Guardian" }]);
        });

        it("skips unknown spec keys and caps at 10", () => {
            expect(formatSpecs("NotAReal Spec", "10")).toEqual([]);
            expect(formatSpecs(undefined, "10")).toEqual([]);
            expect(formatSpecs(Array(12).fill("Holy1").join(","), "10")).toHaveLength(10);
        });
    });

    describe("formatSignUps", () => {
        it("joins the class icons of the specs", () => {
            const icon = entryFor("Holy1").icon;
            const interaction = mockInteraction({ emojis: [[icon, { name: icon, toString: () => `<:${icon}:1>` }]] });
            expect(formatSignUps(interaction, [{ specName: "Holy1" }, { specName: "Holy1" }])).toBe(`<:${icon}:1><:${icon}:1>`);
        });
    });
});
