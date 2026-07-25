const {
    classOf, specOf, specFromIcon, specFromSpecs, specFromTalents,
    rosterFromFights, rosterFromTable, mergeRosters,
} = require("../../src/utils/wclRoster");

describe("utils/wclRoster", () => {
    describe("classOf", () => {
        it("takes the class from the entry type", () => {
            expect(classOf({ type: "Warrior" })).toBe("Warrior");
        });

        it("falls back to the icon's class part", () => {
            expect(classOf({ type: "", icon: "Priest-Shadow" })).toBe("Priest");
        });

        it("returns nothing for NPCs, pets and unknown types", () => {
            expect(classOf({ type: "NPC" })).toBe("");
            expect(classOf({ type: "Pet", icon: "Pet" })).toBe("");
            expect(classOf({})).toBe("");
            expect(classOf(null)).toBe("");
        });
    });

    describe("specFromIcon", () => {
        it("reads the spec behind the class", () => {
            expect(specFromIcon("Warrior-Fury")).toBe("Fury");
            expect(specFromIcon("Druid-Restoration")).toBe("Restoration");
        });

        it("ignores icons without a real spec suffix", () => {
            expect(specFromIcon("Warrior")).toBe("");
            expect(specFromIcon("Warrior-bw")).toBe("");
            expect(specFromIcon("")).toBe("");
            expect(specFromIcon(null)).toBe("");
        });
    });

    describe("specFromSpecs", () => {
        it("takes the first named spec", () => {
            expect(specFromSpecs([{ spec: "Fury", role: "dps" }])).toBe("Fury");
            expect(specFromSpecs(["Holy"])).toBe("Holy");
            expect(specFromSpecs([{ spec: "" }, { spec: "Arms" }])).toBe("Arms");
        });

        it("tolerates a missing/empty list", () => {
            expect(specFromSpecs([])).toBe("");
            expect(specFromSpecs(null)).toBe("");
        });
    });

    describe("specFromTalents", () => {
        it("picks the tree with the most points", () => {
            expect(specFromTalents([
                { name: "Arms", points: 17 }, { name: "Fury", points: 44 }, { name: "Protection", points: 0 },
            ])).toBe("Fury");
        });

        it("accepts a single unambiguous tree without point counts", () => {
            expect(specFromTalents([{ name: "Shadow" }])).toBe("Shadow");
        });

        it("does not guess between several trees without points", () => {
            expect(specFromTalents([{ name: "Arms" }, { name: "Fury" }])).toBe("");
        });

        it("returns nothing when no tree has points at all", () => {
            expect(specFromTalents([{ name: "Arms", points: 0 }, { name: "Fury", points: 0 }])).toBe("");
            expect(specFromTalents([])).toBe("");
            expect(specFromTalents(null)).toBe("");
        });
    });

    describe("specOf", () => {
        it("prefers specs over talents over the icon", () => {
            expect(specOf({
                specs: [{ spec: "Holy" }], talents: [{ name: "Discipline", points: 40 }], icon: "Priest-Shadow",
            })).toBe("Holy");
            expect(specOf({ talents: [{ name: "Discipline", points: 40 }], icon: "Priest-Shadow" })).toBe("Discipline");
            expect(specOf({ icon: "Priest-Shadow" })).toBe("Shadow");
            expect(specOf({ type: "Priest" })).toBe("");
        });
    });

    describe("rosterFromFights / rosterFromTable", () => {
        it("reads the raiders out of a fights payload", () => {
            const roster = rosterFromFights({
                friendlies: [
                    { name: "Keslight", type: "Paladin", icon: "Paladin-Holy" },
                    { name: "Bossmob", type: "NPC" },
                    { name: "", type: "Mage" },
                ],
            });
            expect(roster).toEqual([{ name: "Keslight", className: "Paladin", spec: "Holy" }]);
        });

        it("reads the raiders out of a table payload", () => {
            const roster = rosterFromTable({
                entries: [{ name: "Gemli", type: "Warrior", talents: [{ name: "Fury", points: 41 }] }],
            });
            expect(roster).toEqual([{ name: "Gemli", className: "Warrior", spec: "Fury" }]);
        });

        it("tolerates empty/missing payloads", () => {
            expect(rosterFromFights(null)).toEqual([]);
            expect(rosterFromTable({})).toEqual([]);
        });
    });

    describe("mergeRosters", () => {
        it("merges by name and keeps the entry that knows more", () => {
            const fights = [{ name: "Gemli", className: "Warrior", spec: "" }];
            const table = [{ name: "gemli", className: "Warrior", spec: "Fury" }];
            expect(mergeRosters(fights, table)).toEqual([{ name: "Gemli", className: "Warrior", spec: "Fury" }]);
        });

        it("never downgrades a known spec to an empty one", () => {
            const withSpec = [{ name: "Gemli", className: "Warrior", spec: "Fury" }];
            const without = [{ name: "Gemli", className: "Warrior", spec: "" }];
            expect(mergeRosters(withSpec, without)[0].spec).toBe("Fury");
        });

        it("returns one sorted list across all inputs", () => {
            const merged = mergeRosters(
                [{ name: "Zwilin", className: "Mage", spec: "Fire" }],
                [{ name: "Crimed", className: "Rogue", spec: "" }],
                null,
            );
            expect(merged.map((e) => e.name)).toEqual(["Crimed", "Zwilin"]);
        });
    });
});
