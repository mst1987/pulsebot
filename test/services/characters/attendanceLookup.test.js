jest.mock("../../../src/services/characters/rosterAttendance", () => ({ buildAttendanceContext: jest.fn(() => ({ ctx: true })), attendanceFor: jest.fn() }));
jest.mock("../../../src/stores/roster/raiderCharactersStore", () => ({ listAllAssignments: jest.fn() }));
jest.mock("../../../src/services/characters/characterInfo", () => ({ annotatedCharacters: jest.fn() }));
jest.mock("../../../src/services/categories/categoryNames", () => ({ listKnownCategories: jest.fn() }));
jest.mock("../../../src/services/categories/categoryLifecycle", () => ({ isCategoryActive: jest.fn(() => true) }));
jest.mock("../../../src/stores/loot/lootStore", () => ({ listAll: jest.fn(() => []) }));
jest.mock("../../../src/services/loot/lootServer", () => ({ lootOfGuild: jest.fn((rows) => rows) }));
// #1073: the categories "far" and "farloot" belong to server g2, every other one to g1
jest.mock("../../../src/services/events/eventServer", () => ({ guildOfCategory: jest.fn((id) => (String(id).startsWith("far") ? "g2" : "g1")) }));

const { buildAttendanceContext, attendanceFor } = require("../../../src/services/characters/rosterAttendance");
const { listAllAssignments } = require("../../../src/stores/roster/raiderCharactersStore");
const { annotatedCharacters } = require("../../../src/services/characters/characterInfo");
const { listKnownCategories } = require("../../../src/services/categories/categoryNames");
jest.mock("../../../src/services/characters/characterVersions", () => ({
    buildVersionContext: jest.fn(() => ({})),
    // Brokk and the "pug" category are Forever; everything else TBC
    versionsOfCharacter: jest.fn((ctx, { name, categoryIds = [] }) => (name === "Brokk" || categoryIds.includes("fcat") ? ["forever"] : ["tbc"])),
}));
const { knownCharacterNames, characterAttendance, overall, attendanceFields } = require("../../../src/services/characters/attendanceLookup");

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

describe("services/characters/attendanceLookup", () => {
    it("knows every character from loot and assignments once, sorted", () => {
        expect(knownCharacterNames({ guildId: "g1" })).toEqual(["Brokk", "Dorn", "Elesham"]);
    });

    it("lists only the characters that play the version when one is asked (#741), each name judged once", () => {
        listAllAssignments.mockReturnValue({ mon: { u1: "Elesham", u2: "Dorn" }, fcat: { u3: "Neu", u4: "Brokk" } });
        expect(knownCharacterNames({ versionId: "forever", guildId: "g1" })).toEqual(["Brokk", "Neu"]);
        expect(knownCharacterNames({ versionId: "tbc", guildId: "g1" })).toEqual(["Dorn", "Elesham"]);
    });

    it("counts a character in every category it is assigned to or got loot in", () => {
        const result = characterAttendance("g1", "elesham", { versionId: "tbc" });
        expect(buildAttendanceContext).toHaveBeenCalledWith("g1", { versionId: "tbc" });
        expect(attendanceFor).toHaveBeenCalledWith({ ctx: true }, "mon", "elesham", ["u1"]);
        expect(attendanceFor).toHaveBeenCalledWith({ ctx: true }, "thu", "elesham", ["u1"]);
        expect(attendanceFor).toHaveBeenCalledWith({ ctx: true }, "pug", "elesham", []);
        expect(result.character).toBe("Elesham");
        expect(result.categories.map((c) => c.name)).toEqual(["Montag", "Donnerstag", "Unbekannte Kategorie"]);
    });

    it("leaves out a deactivated category (#744): /anwesenheit lists only active ones", () => {
        const { isCategoryActive } = require("../../../src/services/categories/categoryLifecycle");
        isCategoryActive.mockImplementation((id) => id !== "thu");
        try {
            const result = characterAttendance("g1", "elesham", { versionId: "tbc" });
            expect(result.categories.map((c) => c.id)).toEqual(["mon", "pug"]);
        } finally {
            isCategoryActive.mockImplementation(() => true);
        }
    });

    // #919: only the loot of the asked server is evidence (names and categories).
    it("reads the loot of the asked server only", () => {
        const { listAll } = require("../../../src/stores/loot/lootStore");
        const { lootOfGuild } = require("../../../src/services/loot/lootServer");
        listAll.mockReturnValue([{ id: "r1" }]);
        lootOfGuild.mockReturnValueOnce([{ id: "r1" }]);
        characterAttendance("g1", "elesham", { versionId: "tbc" });
        expect(lootOfGuild).toHaveBeenCalledWith([{ id: "r1" }], "g1");
        expect(annotatedCharacters).toHaveBeenLastCalledWith({ rows: [{ id: "r1" }] });
        lootOfGuild.mockClear();
        knownCharacterNames({ guildId: "g2" });
        expect(lootOfGuild).toHaveBeenCalledWith([{ id: "r1" }], "g2");
        lootOfGuild.mockClear();
        annotatedCharacters.mockClear();
        listAllAssignments.mockClear();
        // #1073: no server, nothing at all - neither loot nor assignments
        expect(knownCharacterNames()).toEqual([]);
        expect(characterAttendance("", "elesham", { versionId: "tbc" }).categories).toEqual([]);
        expect(lootOfGuild).not.toHaveBeenCalled();
        expect(annotatedCharacters).not.toHaveBeenCalled();
        expect(listAllAssignments).not.toHaveBeenCalled();
    });

    // #1073: two servers - the roster of the other one is neither a name nor a category
    describe("two servers (#1073)", () => {
        beforeEach(() => {
            listAllAssignments.mockReturnValue({ mon: { u1: "Elesham" }, far: { u9: "Fremdling", u1: "Elesham" } });
            annotatedCharacters.mockReturnValue([{ character: "Elesham", categoryIds: ["mon", "farloot"] }]);
        });

        it("autocomplete offers only the names of the asked server's categories", () => {
            expect(knownCharacterNames({ guildId: "g1" })).toEqual(["Elesham"]);
            expect(knownCharacterNames({ guildId: "g2" })).toEqual(["Elesham", "Fremdling"]);
        });

        it("the query counts only the asked server's categories, from assignments and loot", () => {
            const mine = characterAttendance("g1", "elesham", { versionId: "tbc" });
            expect(mine.categories.map((c) => c.id)).toEqual(["mon"]);
            expect(attendanceFor).not.toHaveBeenCalledWith(expect.anything(), "far", expect.anything(), expect.anything());
            expect(attendanceFor).not.toHaveBeenCalledWith(expect.anything(), "farloot", expect.anything(), expect.anything());

            attendanceFor.mockClear();
            const theirs = characterAttendance("g2", "fremdling", { versionId: "tbc" });
            expect(theirs.categories.map((c) => c.id)).toEqual(["far"]);
            expect(characterAttendance("g1", "fremdling", { versionId: "tbc" }).categories).toEqual([]);
        });

        it("stays empty and calm on missing data (no store, loot without categories, null server)", () => {
            listAllAssignments.mockReturnValue(null);
            annotatedCharacters.mockReturnValue([{ character: "Elesham" }, { character: "" }]);
            expect(knownCharacterNames({ guildId: "g1" })).toEqual(["Elesham"]);
            expect(characterAttendance("g1", "elesham", { versionId: "tbc" }).categories).toEqual([]);
            expect(knownCharacterNames({ guildId: null })).toEqual([]);
            expect(characterAttendance(null, undefined).categories).toEqual([]);
        });
    });

    it("reuses a given context and answers nothing for no name", () => {
        characterAttendance("g1", "Dorn", { ctx: { own: 1 } });
        expect(buildAttendanceContext).not.toHaveBeenCalled();
        expect(characterAttendance("g1", "", { versionId: "tbc" }).categories).toEqual([]);
    });

    it("lists only the categories of the counted version: nights of it, or playing it today (#740)", () => {
        const configStore = require("../../../src/stores/settings/configStore");
        const spy = jest.spyOn(configStore, "getConfig").mockReturnValue({ categoryVersion: { thu: "forever" } });
        try {
            // Forever: "mon" has Forever nights, "thu" was switched to Forever (none yet), "pug" plays TBC
            const ctx = { versionId: "forever", raidsByCategory: new Map([["mon", []]]) };
            const result = characterAttendance("g1", "elesham", { ctx });
            expect(result.versionId).toBe("forever");
            expect(result.categories.map((c) => c.id).sort()).toEqual(["mon", "thu"]);
        } finally {
            spy.mockRestore();
        }
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
