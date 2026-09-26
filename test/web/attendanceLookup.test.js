jest.mock("../../src/web/rosterAttendance", () => ({ buildAttendanceContext: jest.fn(() => ({ ctx: true })), attendanceFor: jest.fn() }));
jest.mock("../../src/stores/raiderCharactersStore", () => ({ listAllAssignments: jest.fn() }));
jest.mock("../../src/web/characterInfo", () => ({ annotatedCharacters: jest.fn() }));
jest.mock("../../src/web/categoryNames", () => ({ listKnownCategories: jest.fn() }));

const { buildAttendanceContext, attendanceFor } = require("../../src/web/rosterAttendance");
const { listAllAssignments } = require("../../src/stores/raiderCharactersStore");
const { annotatedCharacters } = require("../../src/web/characterInfo");
const { listKnownCategories } = require("../../src/web/categoryNames");
const { knownCharacterNames, characterAttendance, overall, attendanceFields } = require("../../src/web/attendanceLookup");

beforeEach(() => {
    jest.clearAllMocks();
    listAllAssignments.mockReturnValue({ mon: { u1: "Elesham", u2: "Dorn" }, thu: { u1: "elesham" } });
    annotatedCharacters.mockReturnValue([{ character: "Elesham", categoryIds: ["pug"] }, { character: "Brokk", categoryIds: [] }]);
    listKnownCategories.mockReturnValue([{ id: "mon", name: "Montag" }, { id: "thu", name: "Donnerstag" }]);
    attendanceFor.mockImplementation((ctx, id) => ({
        attended: id === "mon" ? 8 : 1, total: id === "mon" ? 10 : 2, pct: id === "mon" ? 80 : 50, raids: [],
        missed: [{ startTime: 1726000000, reason: "abgemeldet" }],
    }));
});

describe("web/attendanceLookup", () => {
    it("knows every character from loot and assignments once, sorted", () => {
        expect(knownCharacterNames()).toEqual(["Brokk", "Dorn", "Elesham"]);
    });

    it("counts a character in every category it is assigned to or got loot in", () => {
        const result = characterAttendance("g1", "elesham");
        expect(buildAttendanceContext).toHaveBeenCalledWith("g1");
        expect(attendanceFor).toHaveBeenCalledWith({ ctx: true }, "mon", "elesham", ["u1"]);
        expect(attendanceFor).toHaveBeenCalledWith({ ctx: true }, "thu", "elesham", ["u1"]);
        expect(attendanceFor).toHaveBeenCalledWith({ ctx: true }, "pug", "elesham", []);
        expect(result.character).toBe("Elesham");
        expect(result.categories.map((c) => c.name)).toEqual(["Montag", "Donnerstag", "Unbekannte Kategorie"]);
    });

    it("reuses a given context and answers nothing for no name", () => {
        characterAttendance("g1", "Dorn", { ctx: { own: 1 } });
        expect(buildAttendanceContext).not.toHaveBeenCalled();
        expect(characterAttendance("g1", "").categories).toEqual([]);
    });

    it("sums the categories and turns them into fields", () => {
        const cats = [
            { name: "Montag", attended: 8, total: 10, pct: 80, missed: [{ startTime: 1726000000, reason: "abgemeldet" }] },
            { name: "Leer", attended: 0, total: 0, pct: null, missed: [] },
        ];
        expect(overall(cats)).toEqual({ attended: 8, total: 10, pct: 80 });
        expect(overall([])).toEqual({ attended: 0, total: 0, pct: null });
        expect(attendanceFields(cats)).toEqual([
            { name: "Montag", value: "**8/10** · 80 %\n❌ <t:1726000000:d> abgemeldet", inline: false },
            { name: "Leer", value: "keine gezählten Raids", inline: false },
        ]);
    });
});
