// What a Raid-Helper event's title says about its raid (src/web/raidplan/raidplanTitle.js): the safe title keywords only, the size from the title
// or the instance's default.
const { instancesFromTitle } = require("../../../src/web/raidplan/raidplanTitle");

describe("instancesFromTitle", () => {
    it.each([
        ["BT 25er Montag", ["bt"], 25],
        ["Black Temple - Farm", ["bt"], 25],
        ["Hyjal + BT", ["hyjal", "bt"], 25],
        ["SSC/TK Donnerstag", ["ssc", "tk"], 25],
        ["Kara 10er Gruppe 2", ["kara"], 10],
        ["Karazhan", ["kara"], 10],
        ["Gruul & Magtheridon", ["gruul", "mag"], 25],
        ["SWP (25)", ["swp"], 25],
        ["Sunwell Plateau", ["swp"], 25],
        ["Zul'Aman Speedrun", ["za"], 10],
        ["Kara + Gruul", ["kara", "gruul"], 25],
    ])("%s -> %j, %i", (title, ids, size) => {
        expect(instancesFromTitle(title)).toEqual({ instanceIds: ids, size, versionId: "tbc" });
    });

    it("never guesses from unsafe short words or inside other words", () => {
        for (const title of ["GL HF Raid", "Mag-Abend", "Tempest", "Serpent", "Abtei-Run", "Plateau", "MH", "Aman", "Gildenabend"]) {
            expect(instancesFromTitle(title).instanceIds).toEqual([]);
        }
        expect(instancesFromTitle("")).toEqual({ instanceIds: [], size: 0, versionId: "tbc" });
        expect(instancesFromTitle(null).instanceIds).toEqual([]);
    });

    it("a size named in the title wins; other versions are chosen by hand", () => {
        expect(instancesFromTitle("BT 10er Test").size).toBe(10);
        expect(instancesFromTitle("BT 25 man").size).toBe(25);
        expect(instancesFromTitle("MC 40er", "classic")).toEqual({ instanceIds: [], size: 0, versionId: "classic" });
        expect(instancesFromTitle("BT", "nope").versionId).toBe("tbc");
    });
});
