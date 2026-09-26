// Which BiS list the council judges against (tier from the guild's own loot)
// and how a raider's class and spec are settled at all.
// Every data source is mocked; lootCouncil.js aggregates on top of them for real.
const mockListAll = jest.fn(() => []);
const mockAnnotated = jest.fn(() => []);
const mockGearByCharacter = jest.fn(() => new Map());
const mockCharacterMap = jest.fn(() => ({}));
const mockAssignments = jest.fn(() => ({}));
const mockExcludedKeys = jest.fn(() => new Set());
const mockPlannedRoles = jest.fn(() => new Map());
const mockRaidEvents = jest.fn(() => []);
const mockLogs = jest.fn(() => []);
const mockListReports = jest.fn(() => []);
const mockGetReport = jest.fn(() => null);

jest.mock("../../src/stores/lootStore", () => ({ listAll: (...a) => mockListAll(...a) }));
jest.mock("../../src/web/characterInfo", () => ({ annotatedCharacters: (...a) => mockAnnotated(...a) }));
jest.mock("../../src/web/charGear", () => ({ gearByCharacter: (...a) => mockGearByCharacter(...a) }));
jest.mock("../../src/stores/characterStore", () => ({ characterMap: (...a) => mockCharacterMap(...a) }));
jest.mock("../../src/stores/raiderCharactersStore", () => ({ getCategoryAssignments: (...a) => mockAssignments(...a) }));
jest.mock("../../src/stores/councilStore", () => ({
    excludedKeys: (...a) => mockExcludedKeys(...a),
    plannedRoles: (...a) => mockPlannedRoles(...a),
}));
jest.mock("../../src/stores/raidEventStore", () => ({ listRaidEvents: (...a) => mockRaidEvents(...a) }));
// The own events (#254) reach the council through the real adapter (eventSources.js).
const mockOwnEvents = jest.fn(() => []);
jest.mock("../../src/stores/eventStore", () => ({
    listEvents: (...a) => mockOwnEvents(...a), getEvent: () => null, isOwnEventId: (id) => String(id || "").startsWith("eh-"),
}));
jest.mock("../../src/stores/signupStore", () => ({ listSignups: () => [] }));
jest.mock("../../src/stores/logStore", () => ({ listLogs: (...a) => mockLogs(...a) }));
jest.mock("../../src/stores/reportStore", () => ({
    listReports: (...a) => mockListReports(...a),
    getReport: (...a) => mockGetReport(...a),
}));

const {
    councilRoster,
    _internal: {
        currentTier,
    },
} = require("../../src/web/lootCouncil");
const wowsims = require("../../src/config/wowsims");
const { now, lootRow, gearOf, item } = require("../helpers/lootCouncil");

beforeEach(() => {
    jest.clearAllMocks();
    mockListAll.mockReturnValue([]);
    mockAnnotated.mockReturnValue([]);
    mockGearByCharacter.mockReturnValue(new Map());
    mockCharacterMap.mockReturnValue({});
    mockAssignments.mockReturnValue({});
    mockExcludedKeys.mockReturnValue(new Set());
    mockPlannedRoles.mockReturnValue(new Map());
    mockRaidEvents.mockReturnValue([]);
    mockOwnEvents.mockReturnValue([]);
    mockLogs.mockReturnValue([]);
    mockListReports.mockReturnValue([]);
    mockGetReport.mockReturnValue(null);
});

describe("web/lootCouncil — which BiS list, and who is on the list at all", () => {
    const DAY2 = 24 * 60 * 60 * 1000;

    describe("currentTier", () => {
        it("takes the tier the newest loot comes from", () => {
            expect(currentTier([
                { contentId: "bt" }, { contentId: "hyjal" }, { contentId: "ssc" },
            ])).toBe("t6");
        });

        it("follows the majority, not the single newest row", () => {
            // One straggler kill in an old raid must not move the whole council
            // back a tier.
            expect(currentTier([
                { contentId: "kara" }, { contentId: "bt" }, { contentId: "bt" }, { contentId: "hyjal" },
            ])).toBe("t6");
        });

        it("ignores rows whose raid could not be resolved", () => {
            expect(currentTier([{ contentId: "" }, { contentId: "ssc" }])).toBe("t5");
        });

        it("falls back to the newest tier without any loot to learn from", () => {
            expect(currentTier([])).toBe("t65");
            expect(currentTier(null)).toBe("t65");
        });
    });

    describe("the default BiS tier", () => {
        it("is derived from the guild's own loot, not 'whatever is newest'", () => {
            // A T6 guild measured against the Sunwell list would look equally far
            // from BiS across the board, which says nothing.
            const bisT6 = wowsims.bisFor("Warlock-Destruction", "t6").items;
            mockListAll.mockReturnValue([
                lootRow({ characterKey: "lock", character: "Lock", contentId: "bt" }),
                lootRow({ characterKey: "lock", character: "Lock", contentId: "hyjal", awardedAt: now - 2 * DAY2 }),
            ]);
            mockAnnotated.mockReturnValue([{ key: "lock", className: "Warlock", spec: "Destruction" }]);
            mockGearByCharacter.mockReturnValue(new Map([["lock", gearOf([], { key: "lock", character: "Lock", className: "Warlock" })]]));

            const result = councilRoster();
            expect(result.bisTier).toBe("t6");
            expect(result.rows[0].bis.total).toBe(bisT6.length);
        });

        it("still lets an explicit pick win", () => {
            mockListAll.mockReturnValue([lootRow({ characterKey: "lock", character: "Lock", contentId: "bt" })]);
            mockAnnotated.mockReturnValue([{ key: "lock", className: "Warlock", spec: "Destruction" }]);
            expect(councilRoster({ bisTier: "t4" }).bisTier).toBe("t4");
        });
    });

    describe("class and spec sources", () => {
        it("finds a raider who has never won an item through the character store", () => {
            // characterInfo only annotates raiders that appear in the loot
            // history, so without the character store the one raider the council
            // is looking for would be dropped as "not a caster".
            mockListAll.mockReturnValue([]);
            mockAnnotated.mockReturnValue([]);
            mockCharacterMap.mockReturnValue({
                neu: { key: "neu", character: "Neu", className: "Druid", spec: "Balance" },
            });
            mockGearByCharacter.mockReturnValue(new Map([
                ["neu", gearOf([item(0, 31064)], { key: "neu", character: "Neu", className: "Druid" })],
            ]));

            const { rows } = councilRoster();
            expect(rows.map((r) => r.specKey)).toEqual(["Druid-Balance"]);
            expect(rows[0].lootCount).toBe(0);
        });

        it("lets the loot annotation win over the store", () => {
            mockListAll.mockReturnValue([lootRow({ characterKey: "x", character: "X" })]);
            mockAnnotated.mockReturnValue([{ key: "x", className: "Mage", spec: "Fire" }]);
            mockCharacterMap.mockReturnValue({ x: { key: "x", className: "Mage", spec: "Frost" } });
            expect(councilRoster().rows[0].specKey).toBe("Mage-Fire");
        });

        it("still drops a class whose spec nothing settles", () => {
            mockCharacterMap.mockReturnValue({ p: { key: "p", character: "P", className: "Priest", spec: "" } });
            mockGearByCharacter.mockReturnValue(new Map([
                ["p", gearOf([item(0, 31064)], { key: "p", character: "P", className: "Priest" })],
            ]));
            expect(councilRoster().rows).toEqual([]);
        });
    });
});
