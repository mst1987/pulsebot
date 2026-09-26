// Who ends up on the council roster: the content filter, the roster rows,
// the category filter that picks the raiders, and raiders the council set aside.
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
    councilRoster, resolveContentFilter,
    _internal: {
        candidatesForItem,
    },
} = require("../../src/web/lootCouncil");
const wowsims = require("../../src/config/wowsims");
const { DAY, now, lootRow, gearOf, item } = require("../helpers/lootCouncil");

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

describe("web/lootCouncil", () => {
    describe("resolveContentFilter", () => {
        it("expands a tier into its raids", () => {
            const filter = resolveContentFilter({ tierIds: ["t6"] });
            expect(filter.has("hyjal")).toBe(true);
            expect(filter.has("bt")).toBe(true);
            expect(filter.has("kara")).toBe(false);
        });

        it("combines tiers and single raids", () => {
            const filter = resolveContentFilter({ tierIds: ["t5"], contentIds: ["hyjal"] });
            expect(filter.has("ssc")).toBe(true);
            expect(filter.has("hyjal")).toBe(true);
        });

        it("treats an empty filter as everything, never as nothing", () => {
            expect(resolveContentFilter({})).toBeNull();
            expect(resolveContentFilter({ tierIds: [], contentIds: [] })).toBeNull();
        });
    });

    describe("councilRoster", () => {
        it("keeps casters and drops everyone else", () => {
            mockListAll.mockReturnValue([
                lootRow(),
                lootRow({ characterKey: "hauer", character: "Hauer" }),
            ]);
            mockAnnotated.mockReturnValue([
                { key: "devihra", className: "Priest", spec: "Shadow" },
                { key: "hauer", className: "Warrior", spec: "Fury" },
            ]);
            const { rows } = councilRoster();
            expect(rows.map((r) => r.character)).toEqual(["Devihra"]);
            expect(rows[0].specKey).toBe("Priest-Shadow");
        });

        it("filters by role", () => {
            mockListAll.mockReturnValue([
                lootRow(),
                lootRow({ characterKey: "heala", character: "Heala" }),
            ]);
            mockAnnotated.mockReturnValue([
                { key: "devihra", className: "Priest", spec: "Shadow" },
                { key: "heala", className: "Druid", spec: "Restoration" },
            ]);
            expect(councilRoster({ role: "caster" }).rows.map((r) => r.character)).toEqual(["Devihra"]);
            expect(councilRoster({ role: "healer" }).rows.map((r) => r.character)).toEqual(["Heala"]);
            expect(councilRoster({ role: "" }).rows).toHaveLength(2);
        });

        it("counts only loot from the filtered content, but keeps the total", () => {
            mockListAll.mockReturnValue([
                lootRow({ contentId: "bt" }),
                lootRow({ contentId: "kara", awardedAt: now - 40 * DAY }),
            ]);
            mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
            const row = councilRoster({ tierIds: ["t6"] }).rows[0];
            expect(row.lootCount).toBe(1);
            expect(row.lootTotal).toBe(2);
        });

        it("filters by raid category, so the Monday raid can be looked at alone", () => {
            mockListAll.mockReturnValue([
                lootRow({ categoryId: "cat-mo" }),
                lootRow({ categoryId: "cat-do" }),
            ]);
            mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
            expect(councilRoster({ categoryId: "cat-mo" }).rows[0].lootTotal).toBe(1);
            expect(councilRoster({}).rows[0].lootTotal).toBe(2);
        });

        it("includes a raider who has never won anything but is known from a log", () => {
            // They are exactly the case a council is looking for, so leaving
            // them out would defeat the point of the page.
            mockGearByCharacter.mockReturnValue(new Map([["neu", gearOf([item(0, 31064)], { key: "neu", character: "Neu", className: "Mage" })]]));
            mockAnnotated.mockReturnValue([{ key: "neu", className: "Mage", spec: "Arcane" }]);
            const row = councilRoster().rows[0];
            expect(row.character).toBe("Neu");
            expect(row.lootCount).toBe(0);
            expect(row.daysSinceLoot).toBeNull();
        });

        it("marks a spec that was assumed from the class", () => {
            mockListAll.mockReturnValue([lootRow({ characterKey: "magier", character: "Magier" })]);
            mockAnnotated.mockReturnValue([{ key: "magier", className: "Mage", spec: "" }]);
            expect(councilRoster().rows[0].specAssumed).toBe(true);
        });

        it("counts BiS pieces the raider actually wears", () => {
            const bis = wowsims.bisFor("Priest-Shadow", "t6").items;
            mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
            mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([
                item(0, bis[0].id), item(4, bis[1].id), item(5, 99999),
            ])]]));
            const row = councilRoster({ bisTier: "t6" }).rows[0];
            expect(row.bis.total).toBe(bis.length);
            expect(row.bis.owned).toBe(2);
        });

        it("sorts by need, so the most overdue raider is on top", () => {
            mockListAll.mockReturnValue([
                // Satt: three recent items.
                lootRow({ characterKey: "satt", character: "Satt", awardedAt: now - 1 * DAY }),
                lootRow({ characterKey: "satt", character: "Satt", awardedAt: now - 2 * DAY }),
                lootRow({ characterKey: "satt", character: "Satt", awardedAt: now - 3 * DAY }),
                // Duerr: one item, long ago.
                lootRow({ characterKey: "duerr", character: "Duerr", awardedAt: now - 60 * DAY }),
            ]);
            mockAnnotated.mockReturnValue([
                { key: "satt", className: "Mage", spec: "Arcane" },
                { key: "duerr", className: "Warlock", spec: "Destruction" },
            ]);
            const { rows } = councilRoster();
            expect(rows[0].character).toBe("Duerr");
            expect(rows[0].needScore).toBeGreaterThan(rows[1].needScore);
        });
    });
});

describe("web/lootCouncil — the category filter picks the raiders, not just the loot", () => {
    // Filtering only the loot left every other raid's casters standing there
    // with "0 Items" and a maximum drought — on top of the very ranking the
    // page exists for.
    function twoRaids() {
        mockListAll.mockReturnValue([
            lootRow({ characterKey: "montag", character: "Montag", categoryId: "cat-mo" }),
            lootRow({ characterKey: "donnerstag", character: "Donnerstag", categoryId: "cat-do" }),
        ]);
        mockAnnotated.mockReturnValue([
            { key: "montag", className: "Priest", spec: "Shadow" },
            { key: "donnerstag", className: "Mage", spec: "Arcane" },
        ]);
    }

    it("drops raiders of another category entirely", () => {
        twoRaids();
        const { rows, skipped } = councilRoster({ categoryId: "cat-mo" });
        expect(rows.map((r) => r.character)).toEqual(["Montag"]);
        expect(skipped.category).toBe(1);
    });

    it("keeps everyone when no category is picked", () => {
        twoRaids();
        expect(councilRoster({}).rows).toHaveLength(2);
        expect(councilRoster({}).skipped.category).toBe(0);
    });

    it("keeps a raider the assignment names even though they never won anything there", () => {
        // Exactly the raider a council is looking for — invisible to a filter
        // that only knows who was awarded loot.
        mockListAll.mockReturnValue([lootRow({ characterKey: "montag", character: "Montag", categoryId: "cat-mo" })]);
        mockAnnotated.mockReturnValue([
            { key: "montag", className: "Priest", spec: "Shadow" },
            { key: "neuling", className: "Mage", spec: "Arcane" },
        ]);
        mockGearByCharacter.mockReturnValue(new Map([
            ["neuling", gearOf([item(0, 31064)], { key: "neuling", character: "Neuling", className: "Mage" })],
        ]));
        mockAssignments.mockReturnValue({ "user-1": "Neuling" });

        const { rows, categorySources } = councilRoster({ categoryId: "cat-mo" });
        expect(rows.map((r) => r.character).sort()).toEqual(["Montag", "Neuling"]);
        expect(categorySources.assigned).toBe(1);
    });

    it("reports what each source contributed", () => {
        // So an unexpectedly short list can be explained rather than looking
        // like a bug.
        twoRaids();
        mockAssignments.mockReturnValue({});
        const { categorySources } = councilRoster({ categoryId: "cat-mo" });
        expect(categorySources).toEqual({ reports: 0, loot: 1, assigned: 0 });
    });

    it("finds the raiders of a category through its evaluated logs", () => {
        // The strongest source, because nobody has to maintain it: whoever
        // stands in the log of a Monday raid raids on Mondays. It is also the
        // only one that works when loot was imported without a category.
        mockListAll.mockReturnValue([]);
        mockAnnotated.mockReturnValue([
            { key: "montag", className: "Priest", spec: "Shadow" },
            { key: "donnerstag", className: "Mage", spec: "Arcane" },
        ]);
        mockGearByCharacter.mockReturnValue(new Map([
            ["montag", gearOf([item(0, 31064)], { key: "montag", character: "Montag", className: "Priest" })],
            ["donnerstag", gearOf([item(0, 31064)], { key: "donnerstag", character: "Donnerstag", className: "Mage" })],
        ]));
        mockRaidEvents.mockReturnValue([{ id: "ev-1", categoryId: "cat-mo" }]);
        mockLogs.mockReturnValue([{ eventId: "ev-1", reportRefId: "rep-1" }]);
        mockListReports.mockReturnValue([{ id: "rep-1" }]);
        mockGetReport.mockReturnValue({ id: "rep-1", roster: [{ name: "Montag" }] });

        const { rows, categorySources } = councilRoster({ categoryId: "cat-mo" });
        expect(rows.map((r) => r.character)).toEqual(["Montag"]);
        expect(categorySources.reports).toBe(1);
    });

    it("finds them through the logs of an own EventHelper event too (#291)", () => {
        mockListAll.mockReturnValue([]);
        mockAnnotated.mockReturnValue([{ key: "montag", className: "Priest", spec: "Shadow" }, { key: "donnerstag", className: "Mage", spec: "Arcane" }]);
        mockGearByCharacter.mockReturnValue(new Map([
            ["montag", gearOf([item(0, 31064)], { key: "montag", character: "Montag", className: "Priest" })],
            ["donnerstag", gearOf([item(0, 31064)], { key: "donnerstag", character: "Donnerstag", className: "Mage" })],
        ]));
        mockOwnEvents.mockReturnValue([{ id: "eh-mo", guildId: "g1", categoryId: "cat-mo", channelId: "c", title: "Montag", startTime: 1 }]);
        mockLogs.mockReturnValue([{ eventId: "eh-mo", reportRefId: "rep-1" }]);
        mockListReports.mockReturnValue([{ id: "rep-1" }]);
        mockGetReport.mockReturnValue({ id: "rep-1", roster: [{ name: "Donnerstag" }] });

        const { rows, categorySources } = councilRoster({ categoryId: "cat-mo" });
        expect(rows.map((r) => r.character)).toEqual(["Donnerstag"]);
        expect(categorySources.reports).toBe(1);
    });

    it("still filters when it finds nobody, rather than falling back to everyone", () => {
        // ⚠️ The bug this replaced: picking a category changed nothing, because
        // an unknown category silently switched the filter off. An empty list
        // plus the source counts says what to fix; a full list says nothing.
        twoRaids();
        mockAssignments.mockReturnValue({});
        const { rows, categorySources } = councilRoster({ categoryId: "cat-unbekannt" });
        expect(rows).toEqual([]);
        expect(categorySources).toEqual({ reports: 0, loot: 0, assigned: 0 });
    });
});

describe("web/lootCouncil — raiders the council set aside", () => {
    it("leaves them out of the roster and counts them", () => {
        mockListAll.mockReturnValue([
            lootRow({ characterKey: "aktiv", character: "Aktiv" }),
            lootRow({ characterKey: "weg", character: "Weg" }),
        ]);
        mockAnnotated.mockReturnValue([
            { key: "aktiv", className: "Priest", spec: "Shadow" },
            { key: "weg", className: "Mage", spec: "Arcane" },
        ]);
        mockExcludedKeys.mockReturnValue(new Set(["weg"]));

        const { rows, skipped } = councilRoster({});
        expect(rows.map((r) => r.character)).toEqual(["Aktiv"]);
        expect(skipped.excluded).toBe(1);
    });

    it("leaves them out of the candidate lists too", () => {
        mockAnnotated.mockReturnValue([{ key: "weg", className: "Priest", spec: "Shadow" }]);
        mockGearByCharacter.mockReturnValue(new Map([["weg", gearOf([])]]));
        mockExcludedKeys.mockReturnValue(new Set(["weg"]));
        expect(candidatesForItem(31064, councilRoster({}).rows)).toEqual([]);
    });

    it("does not touch the loot history — the numbers stay whole", () => {
        // Excluding is a planning decision, not a deletion.
        mockListAll.mockReturnValue([lootRow({ characterKey: "weg", character: "Weg" })]);
        mockAnnotated.mockReturnValue([{ key: "weg", className: "Priest", spec: "Shadow" }]);
        mockExcludedKeys.mockReturnValue(new Set(["weg"]));
        councilRoster({});
        expect(mockListAll).toHaveBeenCalled();
        // ...and taking them back in restores the row.
        mockExcludedKeys.mockReturnValue(new Set());
        expect(councilRoster({}).rows.map((r) => r.character)).toEqual(["Weg"]);
    });
});
