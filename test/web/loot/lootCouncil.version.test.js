// Only the loot of the council's version counts (#741): a raider who plays TBC
// and Forever under one name is ranked in the Forever council by the Forever
// items alone - also in "Alle Raid-Kategorien" and in a category switched from
// TBC to Forever, whose TBC raids keep their version (#737).
const mockListAll = jest.fn(() => []);
const mockAnnotated = jest.fn(() => []);
const mockGearByCharacter = jest.fn(() => new Map());
const mockStored = jest.fn(() => "");

jest.mock("../../../src/stores/loot/lootStore", () => ({ listAll: (...a) => mockListAll(...a) }));
jest.mock("../../../src/services/characters/characterInfo", () => ({ annotatedCharacters: (...a) => mockAnnotated(...a) }));
jest.mock("../../../src/services/loot/charGear", () => ({ gearByCharacter: (...a) => mockGearByCharacter(...a) }));
jest.mock("../../../src/stores/roster/characterStore", () => ({ characterMap: () => ({}) }));
jest.mock("../../../src/stores/roster/raiderCharactersStore", () => ({ getCategoryAssignments: () => ({}) }));
jest.mock("../../../src/stores/loot/councilStore", () => ({ excludedKeys: () => new Set(), plannedRoles: () => new Map() }));
jest.mock("../../../src/stores/events/raidEventStore", () => ({ listRaidEvents: () => [] }));
jest.mock("../../../src/stores/events/eventStore", () => ({ listEvents: () => [], getEvent: () => null, isOwnEventId: () => false }));
jest.mock("../../../src/stores/events/signupStore", () => ({ listSignups: () => [] }));
jest.mock("../../../src/stores/loot/logStore", () => ({ listLogs: () => [] }));
jest.mock("../../../src/stores/loot/reportStore", () => ({ listReports: () => [], getReport: () => null, getReportRoster: () => null }));
jest.mock("../../../src/services/versions/storedVersion", () => ({ storedVersionOf: (...a) => mockStored(...a), versionOfLog: () => "" }));

const { councilRoster } = require("../../../src/web/loot/lootCouncil");
const { lootRow, gearOf, item } = require("../../helpers/lootCouncil");

beforeEach(() => {
    jest.clearAllMocks();
    // two TBC items and one Forever item, all in the same category (switched TBC -> Forever)
    mockListAll.mockReturnValue([
        lootRow({ eventId: "tbc1" }),
        lootRow({ eventId: "tbc2", itemId: 28830, itemName: "Dragonspine Trophy" }),
        lootRow({ eventId: "fo1", itemId: 50001, itemName: "Forever Hood", contentId: "" }),
    ]);
    mockStored.mockImplementation((id) => ({ tbc1: "tbc", tbc2: "tbc", fo1: "forever" }[id] || ""));
    mockAnnotated.mockReturnValue([{ key: "devihra", name: "Devihra", className: "Priest", spec: "Shadow" }]);
    mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([item(0, 31064)])]]));
});

describe("councilRoster counts only the loot of its version", () => {
    it("Forever council: the Forever item only - every category and one category", () => {
        const all = councilRoster({ versionId: "forever", charVersion: "forever" });
        expect(all.rows).toHaveLength(1);
        expect(all.rows[0].lootCount).toBe(1);
        const one = councilRoster({ versionId: "forever", charVersion: "forever", categoryId: "cat-mo" });
        expect(one.rows[0].lootCount).toBe(1);
    });

    it("TBC council: the TBC items only", () => {
        const { rows } = councilRoster({ versionId: "tbc", charVersion: "tbc" });
        expect(rows[0].lootCount).toBe(2);
    });

    it("the character still belongs to both versions: the cut decides what counts, not who is listed", () => {
        expect(councilRoster({ versionId: "forever", charVersion: "forever" }).rows.map((r) => r.character)).toEqual(["Devihra"]);
        expect(councilRoster({ versionId: "tbc", charVersion: "tbc" }).rows.map((r) => r.character)).toEqual(["Devihra"]);
    });

    it("without a version filter (the sync tool's old \"all\" views) everything counts, as before", () => {
        expect(councilRoster({ versionId: "tbc", charVersion: "" }).rows[0].lootCount).toBe(3);
    });
});
