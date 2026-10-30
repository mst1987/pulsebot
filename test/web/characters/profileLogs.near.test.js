// Tippfehler finden: „Bearbeiten“ › aus den Logs schlägt die geloggten Namen
// zuerst vor, die nach einem Tippfehler des Charakters aussehen
// (profileLogs.typoDistance, logSuggestions({ near })).
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/stores/loot/reportStore", () => ({ listReports: () => [], getReportRoster: () => null }));
jest.mock("../../../src/stores/roster/characterStore", () => ({ listCharacters: () => [] }));

const fs = require("fs");
const profiles = require("../../../src/stores/roster/raiderProfileStore");
const { typoDistance, logSuggestions } = require("../../../src/web/characters/profileLogs");

const A = "100000000000000001";

beforeEach(() => fs.__store.clear());

function index(list) {
    return new Map(list.map(([name, className, lastSeen = 0]) => [name.toLowerCase(), {
        key: name.toLowerCase(), character: name, className, reports: 1, lastSeen, spec: "", specKey: "", specSource: "",
    }]));
}

describe("web/characters/profileLogs typoDistance", () => {
    it("zählt die Änderungen eines Tippfehlers, ein Name zu weit weg ist keiner", () => {
        expect(typoDistance("Nerathli", "Nerathil")).toBe(2);
        expect(typoDistance("Nerahtil", "Nerathil")).toBe(2);
        expect(typoDistance("Neratil", "Nerathil")).toBe(1);
        expect(typoDistance("Gent", "Gentle")).toBe(2);
        expect(typoDistance("gentle", "Gentle")).toBe(0);
        expect(typoDistance("Brando", "Nerathil")).toBe(-1);
        expect(typoDistance("Bo", "Bob")).toBe(1);
        expect(typoDistance("B", "Bob")).toBe(-1);
        expect(typoDistance("Anna", "Otto")).toBe(-1);
        expect(typoDistance("", "Bob")).toBe(-1);
    });
});

describe("web/characters/profileLogs logSuggestions near", () => {
    it("stellt ähnliche Namen nach Abstand und gleicher Klasse vorn an und markiert sie", () => {
        profiles.addCharacter(A, { name: "Nerathli", className: "Mage", source: "manual" });
        const idx = index([
            ["Zeta", "Warrior", 9],
            ["Nerathil", "Mage"],
            ["Neratil", "Priest"],
            ["Nerathli", "Mage"],
        ]);
        const list = logSuggestions({ id: A, name: "Anna" }, { near: { name: "Nerathli", className: "Mage" }, index: idx });
        expect(list.map((c) => [c.character, c.match])).toEqual([
            ["Nerathli", "similar"], ["Nerathil", "similar"], ["Neratil", "similar"], ["Zeta", ""],
        ]);
        // no helper fields leak into the answer
        expect(list[0]).not.toHaveProperty("distance");
    });

    it("ohne `near` bleibt es beim alten: eigene Charaktere fehlen, nichts ist „similar“", () => {
        profiles.addCharacter(A, { name: "Nerathli", className: "Mage", source: "manual" });
        const list = logSuggestions({ id: A, name: "Anna" }, { index: index([["Nerathli", "Mage"], ["Nerathil", "Mage"]]) });
        expect(list.map((c) => [c.character, c.match])).toEqual([["Nerathil", ""]]);
    });
});
