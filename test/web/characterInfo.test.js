// Every store and the WCL client are mocked: this tests the resolution ORDER
// (export -> stored evaluation -> Warcraft Log) and what gets cached, not I/O.
const mockLootCharacters = jest.fn(() => []);
const mockListByCharacter = jest.fn(() => []);
jest.mock("../../src/web/lootStore", () => ({
    characters: (...a) => mockLootCharacters(...a),
    listByCharacter: (...a) => mockListByCharacter(...a),
}));

const mockListReports = jest.fn(() => []);
const mockGetReport = jest.fn(() => null);
jest.mock("../../src/web/reportStore", () => ({
    listReports: (...a) => mockListReports(...a),
    getReport: (...a) => mockGetReport(...a),
}));

const mockListLogsForEvent = jest.fn(() => []);
jest.mock("../../src/web/logStore", () => ({
    listLogsForEvent: (...a) => mockListLogsForEvent(...a),
}));

const mockGetFights = jest.fn();
const mockGetSummary = jest.fn();
let mockWclConfigured = true;
jest.mock("../../src/classes/warcraftlogs", () => jest.fn().mockImplementation(() => {
    if (!mockWclConfigured) throw new Error("WARCRAFTLOGS_API_KEY is not set in the environment.");
    return { getFights: mockGetFights, getSummary: mockGetSummary };
}));

// The store keeps real behaviour (merge rules matter here) but in memory.
jest.mock("../../src/web/characterStore", () => {
    const { characterKey } = jest.requireActual("../../src/utils/lootImport");
    const actual = jest.requireActual("../../src/web/characterStore");
    let rows = [];
    return {
        __reset: () => { rows = []; },
        __rows: () => rows,
        characterMap: () => Object.fromEntries(rows.map((r) => [r.key, r])),
        getCharacter: (name) => rows.find((r) => r.key === characterKey(name)) || null,
        listCharacters: () => rows.slice(),
        saveCharacter: (name, data) => {
            const key = characterKey(name);
            if (!key || (!data.className && !data.spec)) return null;
            const existing = rows.find((r) => r.key === key);
            if (!existing) {
                const row = { key, character: String(name).split("-")[0], className: data.className || "", spec: data.spec || "", source: data.source || "export", reportId: data.reportId || "" };
                rows.push(row);
                return row;
            }
            const before = JSON.stringify(existing);
            if (data.className) existing.className = data.className;
            if (data.spec) existing.spec = data.spec;
            if (data.source) existing.source = data.source;
            if (data.reportId) existing.reportId = data.reportId;
            return JSON.stringify(existing) === before ? null : existing;
        },
        SOURCES: actual.SOURCES,
    };
});

const charStore = require("../../src/web/characterStore");
const {
    annotatedCharacters, rememberFromLoot, resolveMissing, normalizeClassName, reportIdsForCharacter,
} = require("../../src/web/characterInfo");

const lootChar = (character, count = 1) => ({ key: character.toLowerCase(), character, realm: "", count });

beforeEach(() => {
    jest.clearAllMocks();
    charStore.__reset();
    mockWclConfigured = true;
    mockLootCharacters.mockReturnValue([]);
    mockListByCharacter.mockReturnValue([]);
    mockListReports.mockReturnValue([]);
    mockListLogsForEvent.mockReturnValue([]);
});

describe("web/characterInfo", () => {
    describe("normalizeClassName", () => {
        it("maps export spellings onto the class names WCL uses", () => {
            expect(normalizeClassName("WARRIOR")).toBe("Warrior");
            expect(normalizeClassName("paladin")).toBe("Paladin");
            expect(normalizeClassName("Death Knight")).toBe("");
            expect(normalizeClassName("")).toBe("");
        });
    });

    describe("rememberFromLoot", () => {
        it("stores the class an RCLootcouncil export carries", () => {
            const saved = rememberFromLoot([
                { character: "Gemli", class: "WARRIOR" },
                { character: "Nwek", class: "" }, // Gargul: no class in the export
            ]);
            expect(saved).toBe(1);
            expect(charStore.getCharacter("Gemli")).toMatchObject({ className: "Warrior", source: "export" });
            expect(charStore.getCharacter("Nwek")).toBeNull();
        });

        it("tolerates an empty import", () => {
            expect(rememberFromLoot(null)).toBe(0);
        });
    });

    describe("annotatedCharacters", () => {
        it("merges the known class/spec into the loot character list", () => {
            mockLootCharacters.mockReturnValue([lootChar("Gemli", 6), lootChar("Nwek", 2)]);
            charStore.saveCharacter("Gemli", { className: "Warrior", spec: "Fury", source: "wcl" });
            expect(annotatedCharacters()).toEqual([
                expect.objectContaining({ character: "Gemli", count: 6, className: "Warrior", spec: "Fury", source: "wcl" }),
                expect.objectContaining({ character: "Nwek", className: "", spec: "", source: "" }),
            ]);
        });
    });

    describe("reportIdsForCharacter", () => {
        it("collects the reports of the logs assigned to the character's events", () => {
            mockListByCharacter.mockReturnValue([{ eventId: "e1" }, { eventId: "e2" }, { eventId: "e1" }]);
            mockListLogsForEvent.mockImplementation((id) => (id === "e1"
                ? [{ reportId: "RPT1" }, { reportId: "" }]
                : [{ reportId: "RPT2" }]));
            expect(reportIdsForCharacter("Gemli").sort()).toEqual(["RPT1", "RPT2"]);
        });
    });

    describe("resolveMissing", () => {
        it("takes the class from the loot export first, without touching WCL", async () => {
            mockLootCharacters.mockReturnValue([lootChar("Gemli")]);
            mockListByCharacter.mockReturnValue([{ eventId: "e1", class: "WARRIOR" }]);
            const r = await resolveMissing();
            expect(r.fromExport).toBe(1);
            expect(mockGetFights).not.toHaveBeenCalled();
            expect(charStore.getCharacter("Gemli")).toMatchObject({ className: "Warrior", source: "export" });
        });

        it("falls back to the roster of an already evaluated report (no API call)", async () => {
            mockLootCharacters.mockReturnValue([lootChar("Nwek")]);
            mockListByCharacter.mockReturnValue([{ eventId: "e1", class: "" }]);
            mockListReports.mockReturnValue([{ id: "rep1" }]);
            mockGetReport.mockReturnValue({ roster: [{ name: "Nwek", type: "Mage" }] });
            const r = await resolveMissing();
            expect(r.fromReports).toBe(1);
            expect(mockGetFights).not.toHaveBeenCalled();
            expect(charStore.getCharacter("Nwek")).toMatchObject({ className: "Mage", source: "report" });
        });

        it("reads class AND spec from the event's Warcraft-Logs report", async () => {
            mockLootCharacters.mockReturnValue([lootChar("Keslight")]);
            mockListByCharacter.mockReturnValue([{ eventId: "e1", class: "" }]);
            mockListLogsForEvent.mockReturnValue([{ reportId: "RPT1" }]);
            mockGetFights.mockResolvedValue({
                end: 100, friendlies: [{ name: "Keslight", type: "Paladin", icon: "Paladin-Holy" }],
            });
            mockGetSummary.mockResolvedValue({
                entries: [{ name: "Keslight", type: "Paladin", talents: [{ name: "Holy", points: 41 }] }],
            });
            const r = await resolveMissing();
            expect(mockGetFights).toHaveBeenCalledWith("RPT1");
            expect(r.checkedReports).toBe(1);
            expect(charStore.getCharacter("Keslight")).toMatchObject({ className: "Paladin", spec: "Holy", source: "wcl", reportId: "RPT1" });
        });

        it("caches everyone in that report, not just the character asked for", async () => {
            mockLootCharacters.mockReturnValue([lootChar("Keslight")]);
            mockListByCharacter.mockReturnValue([{ eventId: "e1" }]);
            mockListLogsForEvent.mockReturnValue([{ reportId: "RPT1" }]);
            mockGetFights.mockResolvedValue({
                friendlies: [
                    { name: "Keslight", type: "Paladin", icon: "Paladin-Holy" },
                    { name: "Gemli", type: "Warrior", icon: "Warrior-Fury" },
                ],
            });
            mockGetSummary.mockResolvedValue({ entries: [] });
            await resolveMissing();
            expect(charStore.getCharacter("Gemli")).toMatchObject({ className: "Warrior", spec: "Fury" });
        });

        it("still uses the fights payload when the summary call fails", async () => {
            mockLootCharacters.mockReturnValue([lootChar("Keslight")]);
            mockListByCharacter.mockReturnValue([{ eventId: "e1" }]);
            mockListLogsForEvent.mockReturnValue([{ reportId: "RPT1" }]);
            mockGetFights.mockResolvedValue({ friendlies: [{ name: "Keslight", type: "Paladin" }] });
            mockGetSummary.mockRejectedValue(new Error("429"));
            const r = await resolveMissing();
            expect(r.checkedReports).toBe(1);
            expect(charStore.getCharacter("Keslight")).toMatchObject({ className: "Paladin", spec: "" });
        });

        it("skips a report that cannot be read and keeps going", async () => {
            mockLootCharacters.mockReturnValue([lootChar("Keslight")]);
            mockListByCharacter.mockReturnValue([{ eventId: "e1" }]);
            mockListLogsForEvent.mockReturnValue([{ reportId: "RPT1" }]);
            mockGetFights.mockRejectedValue(new Error("report is private"));
            const r = await resolveMissing();
            expect(r.checkedReports).toBe(0);
            expect(r.missing).toEqual(["Keslight"]);
        });

        it("reports characters whose events have no log assigned", async () => {
            mockLootCharacters.mockReturnValue([lootChar("Ohkami")]);
            mockListByCharacter.mockReturnValue([{ eventId: "e1" }]);
            mockListLogsForEvent.mockReturnValue([]);
            const r = await resolveMissing();
            expect(r.unlinked).toEqual(["Ohkami"]);
            expect(mockGetFights).not.toHaveBeenCalled();
        });

        it("counts only a missing CLASS as missing, not a missing spec", async () => {
            mockLootCharacters.mockReturnValue([lootChar("Gemli"), lootChar("Ohkami")]);
            charStore.saveCharacter("Gemli", { className: "Warrior", source: "export" }); // spec unknown
            mockListByCharacter.mockReturnValue([{ eventId: "e1" }]);
            mockListLogsForEvent.mockReturnValue([]); // nothing to read a spec from
            const r = await resolveMissing();
            expect(r.unlinked).toEqual(["Gemli", "Ohkami"]);
            expect(r.missing).toEqual(["Ohkami"]);
        });

        it("caps the Warcraft-Logs calls per run and says how many are left", async () => {
            mockLootCharacters.mockReturnValue([lootChar("A"), lootChar("B"), lootChar("C")]);
            mockListByCharacter.mockImplementation((name) => [{ eventId: `e${name}` }]);
            mockListLogsForEvent.mockImplementation((id) => [{ reportId: `RPT-${id}` }]);
            mockGetFights.mockResolvedValue({ friendlies: [] });
            mockGetSummary.mockResolvedValue({ entries: [] });
            const r = await resolveMissing({ maxReports: 2 });
            expect(mockGetFights).toHaveBeenCalledTimes(2);
            expect(r.checkedReports).toBe(2);
            expect(r.pendingReports).toBe(1);
        });

        it("explains a missing WCL API key instead of failing silently", async () => {
            mockWclConfigured = false;
            mockLootCharacters.mockReturnValue([lootChar("Keslight")]);
            mockListByCharacter.mockReturnValue([{ eventId: "e1" }]);
            mockListLogsForEvent.mockReturnValue([{ reportId: "RPT1" }]);
            const r = await resolveMissing();
            expect(r.error).toContain("WCL-API-Key");
        });

        it("does nothing when every character is already known", async () => {
            mockLootCharacters.mockReturnValue([lootChar("Gemli")]);
            charStore.saveCharacter("Gemli", { className: "Warrior", spec: "Fury", source: "wcl" });
            const r = await resolveMissing();
            expect(r).toMatchObject({ fromExport: 0, fromReports: 0, fromWcl: 0, checkedReports: 0 });
            expect(mockGetFights).not.toHaveBeenCalled();
        });
    });
});
