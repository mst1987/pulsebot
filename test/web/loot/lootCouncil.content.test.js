// The council of a version without content data (#748): no BiS list, no TBC item
// table, no simulation - but needs, received loot and weighting stay. TBC unchanged.
const mockListAll = jest.fn(() => []);
const mockAnnotated = jest.fn(() => []);
const mockGearByCharacter = jest.fn(() => new Map());

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

const { councilRoster, filterOptions } = require("../../../src/web/loot/lootCouncil");
const { itemClass } = require("../../../src/services/loot/itemWeights");
const { lootRow, gearOf, item } = require("../../helpers/lootCouncil");

function setup() {
    mockListAll.mockReturnValue([lootRow(), lootRow({ itemId: 28830, itemName: "Dragonspine Trophy", contentId: "bt" })]);
    mockAnnotated.mockReturnValue([{ key: "devihra", name: "Devihra", className: "Priest", spec: "Shadow" }]);
    mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([item(0, 31064)])]]));
}

// No hand lists (#760, manualBisStore) in these cases: an empty scratch file.
const manualBisStore = require("../../../src/stores/loot/manualBisStore");
const { tempStoreFile } = require("../../helpers/tempStore");

beforeAll(() => manualBisStore.useFile(tempStoreFile("council-manual-bis.json")));
afterAll(() => manualBisStore.useFile(null));
beforeEach(() => { jest.clearAllMocks(); setup(); });

describe("councilRoster per version content", () => {
    it("TBC keeps its BiS list, tier and item table", () => {
        const { rows, bisTier } = councilRoster({ versionId: "tbc" });
        expect(bisTier).toBe("t6");
        expect(rows).toHaveLength(1);
        expect(rows[0].bis.total).toBeGreaterThan(0);
        expect(rows[0].simSupported).toBe(true);
        expect(rows[0].gear.items[0].stats).not.toEqual({});
    });

    it("a version without content data has no BiS list, no tier, no simulation and no TBC item data", () => {
        const { rows, bisTier } = councilRoster({ versionId: "forever" });
        expect(bisTier).toBe("");
        expect(rows).toHaveLength(1);
        const row = rows[0];
        expect(row.bis).toEqual(expect.objectContaining({ total: 0, owned: 0, items: [], tier: "" }));
        expect(row.simSupported).toBe(false);
        expect(row.gear.items[0]).toEqual(expect.objectContaining({ stats: {}, contentId: "", bisSpecs: [], isBis: false }));
    });

    it("keeps needs and received loot for a version without content data", () => {
        const { rows } = councilRoster({ versionId: "forever" });
        expect(rows[0].lootCount).toBe(2);
        expect(typeof rows[0].needScore).toBe("number");
        // Every award is a plain item: the TBC loot table is not consulted.
        expect(rows[0].items.every((it) => it.weightClass === "normal")).toBe(true);
    });

    it("ignores the tier/raid filter without content data", () => {
        const { rows } = councilRoster({ versionId: "forever", tierIds: ["t4"] });
        expect(rows[0].lootCount).toBe(2);
        expect(councilRoster({ versionId: "tbc", tierIds: ["t4"] }).rows[0].lootCount).toBe(0);
    });

    it("offers no filter options without content data", () => {
        expect(filterOptions({ bis: false, sim: false, tiers: false, itemTable: false })).toEqual(expect.objectContaining({ tiers: [], contents: [], bisTiers: [] }));
        expect(filterOptions().tiers.length).toBeGreaterThan(0);
    });
});

describe("itemClass without an item table", () => {
    it("is a plain item, except for an exception of the council", () => {
        expect(itemClass(28830, { items: {} }, { noTable: true })).toBe("normal");
        expect(itemClass(28830, { items: { 28830: { weight: 2 } } }, { noTable: true })).toBe("override");
    });
});
