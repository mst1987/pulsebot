// Ein Charakter wird umbenannt (availabilityStore.renameCharacter): Anwesenheits-
// Einträge des Raiders mit ihm melden die Raids ab jetzt mit dem neuen Namen an.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const store = require("../../src/stores/availabilityStore");

beforeEach(() => fs.__store.clear());

const presence = (over = {}) => store.addEntry({
    userId: "u1", kind: "presence", from: "2030-04-01", to: "2030-04-02", character: "Gentle", spec: "Druid-Restoration", versionId: "tbc", ...over,
}).entry;

describe("stores/availabilityStore renameCharacter", () => {
    it("benennt die Einträge des Raiders in der Version des Charakters um", () => {
        const mine = presence();
        const forever = presence({ versionId: "forever" });
        const other = presence({ userId: "u2" });
        const absence = store.addEntry({ userId: "u1", kind: "absence", from: "2030-04-01", to: "2030-04-02" }).entry;

        expect(store.renameCharacter("u1", "gentle", "Blattwerk", { versionId: "tbc" })).toBe(1);
        expect(store.getEntry(mine.id).character).toBe("Blattwerk");
        expect(store.getEntry(forever.id).character).toBe("Gentle");
        expect(store.getEntry(other.id).character).toBe("Gentle");
        expect(store.getEntry(absence.id).character).toBe("");
    });

    it("ohne Version alle, ohne Treffer nichts", () => {
        presence();
        presence({ versionId: "forever" });
        expect(store.renameCharacter("u1", "gentle", "Blattwerk")).toBe(2);
        expect(store.renameCharacter("u1", "niemand", "X")).toBe(0);
    });
});
