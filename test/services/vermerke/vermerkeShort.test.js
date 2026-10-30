// The short form of the Vermerke (docs/vermerke.md, #979): the highest active
// level and the reasons with their counts - never the text, the author or the raids.
const fs = require("fs");
const path = require("path");
const { tempStoreFile } = require("../../helpers/tempStore");
const notes = require("../../../src/stores/userNotesStore");
const { shortOf, shortFor, activeLevelFor, shadowbannedAmong } = require("../../../src/services/vermerke/vermerkeShort");

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

    it("reads the store once for many persons", () => {
        const file = tempStoreFile("user-notes.json");
        notes.useFile(file);
        notes.addEntry("A", U, { level: "warning", reason: "behavior" }, by);
        notes.addEntry("A", V, { level: "hint", reason: "loot" }, by);
        const spy = jest.spyOn(fs, "readFileSync");
        try {
            const out = shortFor("A", [U, V, W, "444444444444444444", "555555555555555555"], { now: 3000 });
            expect(Object.keys(out).sort()).toEqual([U, V].sort());
            const reads = spy.mock.calls.filter(([p]) => path.resolve(String(p)) === path.resolve(file));
            expect(reads).toHaveLength(1);
        } finally {
            spy.mockRestore();
        }
    });

    it("names the shadowbanned only: own and shared, not expired, not hidden, warnings and hints never (#981)", () => {
        const X = "444444444444444444";
        const Y = "555555555555555555";
        const Z = "666666666666666666";
        notes.addEntry("A", U, { level: "shadowban", reason: "behavior" }, by);
        notes.addEntry("A", V, { level: "warning", reason: "no_show" }, by);
        notes.addEntry("A", W, { level: "hint", reason: "loot" }, by);
        notes.addEntry("A", X, { level: "shadowban", reason: "other", expiresAt: 2000 }, by);
        // a shadowban server B shares: counts on A, unless A hid it
        notes.addEntry("B", Y, { level: "shadowban", reason: "behavior", shared: true }, by);
        const hidden = notes.addEntry("B", Z, { level: "shadowban", reason: "behavior", shared: true }, by);
        notes.hideShared("A", hidden.id, { by: "9" });
        expect(shadowbannedAmong("A", [U, V, W, X, Y, Z], { now: 3000 }).sort()).toEqual([U, Y].sort());
        // A's own unshared one does not reach B; hiding on A does not hide it on B
        expect(shadowbannedAmong("B", [U, Y, Z], { now: 3000 }).sort()).toEqual([Y, Z].sort());
        expect(shadowbannedAmong("A", [], { now: 3000 })).toEqual([]);
    });
});
