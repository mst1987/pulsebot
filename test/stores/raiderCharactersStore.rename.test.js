// Ein Charakter wird umbenannt (raiderCharactersStore.renameUserCharacter): die
// Kategorien ohne Roster (raider-characters.json) nennen beim Raider den neuen
// Namen. Kategorien mit Roster folgen über das Roster (rosterStore.rename.test.js).
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { setCategoryAssignments, getCategoryAssignments, renameUserCharacter } = require("../../src/stores/raiderCharactersStore");

beforeEach(() => fs.__store.clear());

describe("stores/raiderCharactersStore renameUserCharacter", () => {
    it("ersetzt den Namen des Raiders in jeder Kategorie, auch mit Realm, andere Raider bleiben", () => {
        setCategoryAssignments("mo", { u1: "Gentle", u2: "Gentle" });
        setCategoryAssignments("mi", { u1: "Gentle-Thunderstrike" });
        setCategoryAssignments("fr", { u1: "Nerathil" });

        expect(renameUserCharacter("u1", "gentle", "Blattwerk")).toBe(2);
        expect(getCategoryAssignments("mo")).toEqual({ u1: "Blattwerk", u2: "Gentle" });
        expect(getCategoryAssignments("mi")).toEqual({ u1: "Blattwerk" });
        expect(getCategoryAssignments("fr")).toEqual({ u1: "Nerathil" });
    });

    it("tut ohne Treffer oder mit leeren Angaben nichts", () => {
        setCategoryAssignments("mo", { u1: "Nerathil" });
        expect(renameUserCharacter("u1", "gentle", "Blattwerk")).toBe(0);
        expect(renameUserCharacter("", "nerathil", "X")).toBe(0);
        expect(renameUserCharacter("u1", "nerathil", "")).toBe(0);
    });
});
