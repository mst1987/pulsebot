// The worn gear a council looks at: the item view, gear in the roster payload,
// what a candidate would replace and the slot on an awarded item.
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

jest.mock("../../../src/stores/lootStore", () => ({ listAll: (...a) => mockListAll(...a) }));
jest.mock("../../../src/services/characters/characterInfo", () => ({ annotatedCharacters: (...a) => mockAnnotated(...a) }));
jest.mock("../../../src/services/loot/charGear", () => ({ gearByCharacter: (...a) => mockGearByCharacter(...a) }));
jest.mock("../../../src/stores/characterStore", () => ({ characterMap: (...a) => mockCharacterMap(...a) }));
jest.mock("../../../src/stores/raiderCharactersStore", () => ({ getCategoryAssignments: (...a) => mockAssignments(...a) }));
jest.mock("../../../src/stores/councilStore", () => ({
    excludedKeys: (...a) => mockExcludedKeys(...a),
    plannedRoles: (...a) => mockPlannedRoles(...a),
}));
jest.mock("../../../src/stores/raidEventStore", () => ({ listRaidEvents: (...a) => mockRaidEvents(...a) }));
// The own events (#254) reach the council through the real adapter (eventSources.js).
const mockOwnEvents = jest.fn(() => []);
jest.mock("../../../src/stores/eventStore", () => ({
    listEvents: (...a) => mockOwnEvents(...a), getEvent: () => null, isOwnEventId: (id) => String(id || "").startsWith("eh-"),
}));
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: () => [] }));
jest.mock("../../../src/stores/logStore", () => ({ listLogs: (...a) => mockLogs(...a) }));
jest.mock("../../../src/stores/reportStore", () => ({
    listReports: (...a) => mockListReports(...a),
    getReport: (...a) => mockGetReport(...a),
}));

const {
    councilRoster,
    _internal: {
        candidatesForItem, wornItemView, firstSlotFor, slotNameFor,
    },
} = require("../../../src/web/loot/lootCouncil");
const wowsims = require("../../../src/config/wowsims");
const { DAY, now, lootRow, gearOf, item } = require("../../helpers/lootCouncil");

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

describe("web/loot/lootCouncil — the worn gear a council looks at", () => {
    const bisIds = () => new Set(wowsims.bisFor("Priest-Shadow", "t6").items.map((e) => e.id));

    function shadowPriestWearing(items) {
        mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
        mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf(items)]]));
        return councilRoster({ bisTier: "t6" }).rows[0];
    }

    const worn = (over = {}) => ({
        slot: 0, slotName: "Kopf", itemId: 31064, itemName: "Hood of Absolution",
        iconUrl: "https://wow.zamimg.com/images/wow/icons/large/inv_helmet_99.jpg",
        quality: 4, itemLevel: 146, gems: [25893, 0], emptySockets: 1, enchantId: 3002,
        enchantStatus: "ok", ...over,
    });

    describe("wornItemView", () => {
        it("keeps the log's own name and icon", () => {
            // The log saw what the raider actually wears, including items the
            // generated table does not carry.
            const view = wornItemView(worn(), new Set());
            expect(view.itemName).toBe("Hood of Absolution");
            expect(view.iconUrl).toContain("inv_helmet_99");
        });

        it("names an item the log left blank from the item table", () => {
            const view = wornItemView(worn({ itemName: "" }), new Set());
            expect(view.itemName).toBe("Hood of Absolution");
        });

        it("carries the gem and enchant ids for the Wowhead tooltip, empty sockets left out", () => {
            const view = wornItemView(worn({ gems: [25893, 0, 30600], enchantId: 3002 }), new Set());
            expect(view.gemIds).toEqual([25893, 30600]);
            expect(view.enchantId).toBe(3002);
            const bare = wornItemView(worn({ gems: [], enchantId: 0 }), new Set());
            expect(bare.gemIds).toEqual([]);
            expect(bare.enchantId).toBe(0);
        });

        it("falls back to the id for an item neither source knows", () => {
            const view = wornItemView(worn({ itemId: 999999, itemName: "" }), new Set());
            expect(view.itemName).toBe("Item 999999");
        });

        it("adds the stats the item table knows", () => {
            const view = wornItemView(worn(), new Set());
            expect(view.stats.spellPower).toBeGreaterThan(0);
            expect(view.itemLevel).toBeGreaterThan(0);
        });

        it("leaves the raid empty for an item no single raid drops", () => {
            // Tier tokens and badge gear are deliberately absent from the
            // content table (see config/tbcContent.js) — filing them under
            // whichever raid came first would be a wrong answer, not a gap.
            expect(wornItemView(worn(), new Set()).contentId).toBe("");
            // ...while a plain boss drop resolves.
            expect(wornItemView(worn({ itemId: 32235 }), new Set()).contentId).toBeTruthy();
        });

        it("marks a piece that is on this raider's BiS list", () => {
            const bisId = wowsims.bisFor("Priest-Shadow", "t6").items[0].id;
            expect(wornItemView(worn({ itemId: bisId }), bisIds()).isBis).toBe(true);
            expect(wornItemView(worn({ itemId: 29352 }), bisIds()).isBis).toBe(false);
        });

        it("carries the flags the page marks an icon with", () => {
            const view = wornItemView(worn({ enchantStatus: "missing" }), new Set());
            expect(view.enchantStatus).toBe("missing");
            expect(view.emptySockets).toBe(1);
            // Only real gems count — a 0 is an empty socket, not a gem.
            expect(view.gemCount).toBe(1);
        });

        it("passes on that a slot only counts against certain bosses", () => {
            const sit = { note: "wirkt nur gegen Untote und Dämonen" };
            expect(wornItemView(worn({ situational: sit }), new Set()).situational).toEqual(sit);
            expect(wornItemView(worn(), new Set()).situational).toBeNull();
        });

        it("passes on which piece stands in for which", () => {
            const sub = { itemId: 23207, itemName: "Mark of the Champion", iconUrl: "", note: "…", seenAt: 1, reportTitle: "Alt" };
            expect(wornItemView(worn({ replacedSituational: sub }), new Set()).replacedSituational).toEqual(sub);
            expect(wornItemView(worn(), new Set()).replacedSituational).toBeNull();
        });
    });

    describe("gear in the roster payload", () => {
        it("hands out every worn piece", () => {
            const row = shadowPriestWearing([item(0, 31064), item(4, 31065)]);
            expect(row.gear.items).toHaveLength(2);
            expect(row.gear.itemCount).toBe(2);
        });

        it("is null for a raider no report has seen", () => {
            mockListAll.mockReturnValue([lootRow()]);
            mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
            mockGearByCharacter.mockReturnValue(new Map());
            expect(councilRoster().rows[0].gear).toBeNull();
        });
    });

    describe("what a candidate would replace", () => {
        it("is the full item view, not just a name", () => {
            mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
            mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([item(0, 29352)])]]));
            const rows = councilRoster({ bisTier: "t6" }).rows;
            const [candidate] = candidatesForItem(32525, rows);
            expect(candidate.replaces).toMatchObject({
                itemId: 29352,
                slot: 0,
                itemName: expect.any(String),
                iconUrl: expect.any(String),
            });
        });

        it("stays null for a free slot, and names the slot anyway", () => {
            mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
            mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([])]]));
            const [candidate] = candidatesForItem(31064, councilRoster().rows);
            expect(candidate.replaces).toBeNull();
            expect(candidate.slotName).toBe("Kopf");
        });
    });

    describe("the fairness numbers on a candidate", () => {
        it("are the same ones the roster row shows", () => {
            // A raider must not read as overdue in one view and satisfied in
            // the other.
            mockListAll.mockReturnValue([lootRow({ awardedAt: now - 20 * DAY })]);
            mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
            mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([])]]));
            const row = councilRoster().rows[0];
            const [candidate] = candidatesForItem(31064, [row]);
            expect(candidate.needScore).toBe(row.needScore);
            expect(candidate.needParts).toEqual(row.needParts);
            expect(candidate.daysSinceLoot).toBe(row.daysSinceLoot);
            expect(candidate.lootCount).toBe(row.lootCount);
            expect(candidate.bisOwned).toBe(row.bis.owned);
            expect(candidate.bisTotal).toBe(row.bis.total);
        });
    });
});

describe("web/loot/lootCouncil — the slot on an awarded item (for the comparison matrix)", () => {
    it("names the slot so the matrix can order its rows like a character sheet", () => {
        // 31064 is a helm, 29305 a ring, 28770 a one-handed weapon.
        expect(firstSlotFor(31064)).toBe(0);
        expect(slotNameFor(31064)).toBe("Kopf");
        // A doubled slot is named without its number — which finger a ring
        // ends up on is nobody's business here.
        expect(firstSlotFor(29305)).toBe(10);
        expect(slotNameFor(29305)).toBe("Ring");
        expect(slotNameFor(28770)).toBe("Waffe");
    });

    it("does not guess a slot for an item the table does not know", () => {
        expect(firstSlotFor(1)).toBe(-1);
        expect(slotNameFor(1)).toBe("");
    });

    it("carries slot and slot name on every item of a roster row", () => {
        mockListAll.mockReturnValue([lootRow(), lootRow({ itemId: 29305, itemName: "Band of the Eternal Sage" })]);
        mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
        mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([])]]));
        const [row] = councilRoster().rows;
        expect(row.items.map((i) => [i.slot, i.slotName])).toEqual([[0, "Kopf"], [10, "Ring"]]);
    });
});
