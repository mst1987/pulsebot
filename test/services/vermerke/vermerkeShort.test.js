// The short form of the Vermerke (docs/vermerke.md, #979): the highest active
// level and the reasons with their counts - never the text, the author or the raids.
const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");
const notes = require("../../../src/stores/userNotesStore");
const { shortOf, shortFor, activeLevelFor } = require("../../../src/services/vermerke/vermerkeShort");

const U = "111111111111111111";
const V = "222222222222222222";
const W = "333333333333333333";
const by = { by: "9", byName: "Orga Name", now: 1000 };

beforeEach(() => {
    const file = tempStoreFile("user-notes.json");
    if (fs.existsSync(file)) fs.unlinkSync(file);
    notes.useFile(file);
});
afterAll(() => notes.useFile(null));

describe("services/vermerke/vermerkeShort", () => {
    it("gives the highest level and the reasons with their counts, nothing else", () => {
        notes.addEntry("A", U, { level: "hint", reason: "no_show", text: "SECRET-1", eventIds: ["e1"] }, by);
        notes.addEntry("A", U, { level: "warning", reason: "no_show", text: "SECRET-2" }, by);
        notes.addEntry("A", U, { level: "hint", reason: "loot", text: "SECRET-3" }, by);
        const s = shortOf("A", U);
        expect(s).toEqual({ level: "warning", reasons: { no_show: 2, loot: 1 } });
        expect(JSON.stringify(s)).not.toMatch(/SECRET|Orga Name|e1/);
        expect(activeLevelFor("A", U)).toBe("warning");
    });

    it("leaves out who has nothing active, and counts per server", () => {
        notes.addEntry("A", U, { level: "warning", reason: "behavior" }, by);
        notes.addEntry("A", V, { level: "shadowban", reason: "other", expiresAt: 2000 }, by);
        notes.addEntry("A", W, { level: "hint", reason: "loot", shared: true }, by);
        expect(shortFor("A", [U, V, W, "", U, null], { now: 3000 })).toEqual({
            [U]: { level: "warning", reasons: { behavior: 1 } },
            [W]: { level: "hint", reasons: { loot: 1 } },
        });
        // server B sees the shared entry of A only
        expect(shortFor("B", [U, V, W], { now: 3000 })).toEqual({ [W]: { level: "hint", reasons: { loot: 1 } } });
        expect(shortOf("B", U)).toBe(null);
        expect(shortFor("A", "nope")).toEqual({});
    });
});
