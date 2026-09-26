// Which players of the approved setup are the visitor's: their own account and the characters of their
// raider profile (case and realm ignored), also under another account.
const raidplan = require("../../../src/web/raidplan/raidplan");

describe("identify", () => {
    const roster = [
        { userId: "u1", character: "Heilbert" }, { userId: "u2", character: "Schleich-Thunderstrike" },
        { userId: "u3", character: "Bolzen" }, { userId: "u4", character: "SCHLEICHER" },
    ];
    const key = (c) => c.toLowerCase().split("-")[0];
    it("the account's own player first, then the characters of the profile", () => {
        expect(raidplan.identify("u3", [key("Schleich"), key("Heilbert")], roster)).toEqual(["u3", "u1", "u2"]);
    });
    it("case and realm do not matter, a name that only starts alike does not count", () => {
        expect(raidplan.identify("x", [key("schleich-Kelthuzad")], roster)).toEqual(["u2"]);
    });
    it("nobody recognised gives nothing, and no login gives nothing", () => {
        expect(raidplan.identify("nobody", [], roster)).toEqual([]);
        expect(raidplan.identify("", [], roster)).toEqual([]);
        expect(raidplan.identify("u1", undefined, roster)).toEqual(["u1"]);
    });
});
