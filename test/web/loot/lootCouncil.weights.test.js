// The weighted need score (#668): four parts with the council's weights, the
// drought with a partial reset per award, loot points by item class, and
// belonging ("dabei seit") from the roster, the first raid and the first loot.
// Every data source is mocked; lootCouncil.js, itemWeights.js and
// councilTenure.js run for real on top of them.
const mockListAll = jest.fn(() => []);
const mockAnnotated = jest.fn(() => []);
const mockGearByCharacter = jest.fn(() => new Map());
const mockRaidEvents = jest.fn(() => []);
const mockLogs = jest.fn(() => []);
const mockGetReport = jest.fn(() => null);
const mockRosters = jest.fn(() => []);

jest.mock("../../../src/stores/lootStore", () => ({ listAll: (...a) => mockListAll(...a) }));
jest.mock("../../../src/services/characters/characterInfo", () => ({ annotatedCharacters: (...a) => mockAnnotated(...a) }));
jest.mock("../../../src/services/loot/charGear", () => ({ gearByCharacter: (...a) => mockGearByCharacter(...a) }));
jest.mock("../../../src/stores/characterStore", () => ({ characterMap: () => ({}) }));
jest.mock("../../../src/stores/raiderCharactersStore", () => ({ getCategoryAssignments: () => ({}) }));
jest.mock("../../../src/stores/councilStore", () => ({ excludedKeys: () => new Set(), plannedRoles: () => new Map() }));
jest.mock("../../../src/stores/raidEventStore", () => ({ listRaidEvents: (...a) => mockRaidEvents(...a) }));
jest.mock("../../../src/stores/eventStore", () => ({ listEvents: () => [], getEvent: () => null, isOwnEventId: () => false }));
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: () => [] }));
jest.mock("../../../src/stores/logStore", () => ({ listLogs: (...a) => mockLogs(...a) }));
jest.mock("../../../src/stores/reportStore", () => ({
    listReports: () => [],
    getReport: (...a) => mockGetReport(...a),
    getReportRoster: (...a) => mockGetReport(...a),
}));
jest.mock("../../../src/stores/rosterStore", () => ({
    listRosters: (...a) => mockRosters(...a),
    rosterForCategory: (id) => mockRosters().find((r) => r.categoryId === id) || null,
}));

const {
    councilRoster, candidateSplit,
    _internal: { needScore, droughtDays, resolveWeights, NEED_WEIGHTS },
} = require("../../../src/web/loot/lootCouncil");
const councilWeights = require("../../../src/stores/councilWeightsStore");
const { tempStoreFile } = require("../../helpers/tempStore");
const { DAY, now, lootRow, gearOf } = require("../../helpers/lootCouncil");

const TRINKET = 28789; // Eye of Magtheridon
const SET = 31064; // Hood of Absolution (T6 set piece)
const FREQUENT = 30021; // Wildfury Greatstaff, SSC trash
const BIS_STAFF = 32374; // Zhar'doom — on the shadow priest's T6 list
const OTHER_WEAPON = 30910; // Tempest of Chaos — a weapon, not on that list

const iso = (ms) => new Date(ms).toISOString();
const shadow = (key = "devihra") => ({ key, className: "Priest", spec: "Shadow" });

beforeAll(() => councilWeights.useFile(tempStoreFile("council-weights.json")));
afterAll(() => councilWeights.useFile(null));
beforeEach(() => {
    jest.clearAllMocks();
    councilWeights.resetWeights("");
    councilWeights.resetWeights("cat-mo");
    mockListAll.mockReturnValue([]);
    mockAnnotated.mockReturnValue([shadow()]);
    mockGearByCharacter.mockReturnValue(new Map());
    mockRaidEvents.mockReturnValue([]);
    mockLogs.mockReturnValue([]);
    mockGetReport.mockReturnValue(null);
    mockRosters.mockReturnValue([]);
});

describe("needScore", () => {
    it("is made of four visible parts", () => {
        const { score, parts } = needScore({ droughtDays: 15, lootPoints: 1, avgLootPoints: 2, bisOwned: 5, bisTotal: 10, tenureDays: 45 });
        expect(parts).toEqual({ drought: 0.5, share: 0.5, need: 0.5, tenure: 0.5 });
        expect(score).toBeCloseTo(0.5, 5);
    });

    it("weighs wait 45, share 30, belonging 15 and the BiS gap 10 by default", () => {
        expect(NEED_WEIGHTS).toEqual({ drought: 0.45, share: 0.3, need: 0.1, tenure: 0.15 });
        const only = (over) => needScore({ droughtDays: 0, lootPoints: 5, avgLootPoints: 1, bisOwned: 10, bisTotal: 10, tenureDays: 0, ...over }).score;
        expect(only({ droughtDays: 30 })).toBeCloseTo(0.45, 5);
        expect(only({ lootPoints: 0, avgLootPoints: 4 })).toBeCloseTo(0.3, 5);
        expect(only({ bisOwned: 0 })).toBeCloseTo(0.1, 5);
        expect(only({ tenureDays: 90 })).toBeCloseTo(0.15, 5);
    });

    it("takes the council's weights and tenure saturation", () => {
        const input = { droughtDays: 0, lootPoints: 5, avgLootPoints: 1, bisOwned: 10, bisTotal: 10, tenureDays: 30 };
        const { score, parts } = needScore(input, { drought: 0.5, share: 0, need: 0, tenure: 0.5 }, 60);
        expect(parts.tenure).toBe(0.5);
        expect(score).toBeCloseTo(0.25, 5);
    });

    it("grows belonging linearly up to the saturation and no further", () => {
        const tenure = (days) => needScore({ droughtDays: 0, lootPoints: 0, avgLootPoints: 0, bisOwned: 0, bisTotal: 0, tenureDays: days }).parts.tenure;
        expect(tenure(0)).toBe(0);
        expect(tenure(9)).toBe(0.1);
        expect(tenure(90)).toBe(1);
        expect(tenure(900)).toBe(1);
    });

    it("caps the drought at 30 days and treats 'never' as the full drought", () => {
        expect(needScore({ droughtDays: 900, lootPoints: 0, avgLootPoints: 0, bisOwned: 0, bisTotal: 0 }).parts.drought).toBe(1);
        expect(needScore({ droughtDays: null, lootPoints: 0, avgLootPoints: 1, bisOwned: 0, bisTotal: 1 }).parts.drought).toBe(1);
    });

    it("gives a raider above the average no negative share and stays in 0..1", () => {
        expect(needScore({ droughtDays: 1, lootPoints: 10, avgLootPoints: 2, bisOwned: 0, bisTotal: 0 }).parts.share).toBe(0);
        for (const input of [
            { droughtDays: 0, lootPoints: 99, avgLootPoints: 1, bisOwned: 10, bisTotal: 10, tenureDays: 0 },
            { droughtDays: 999, lootPoints: 0, avgLootPoints: 9, bisOwned: 0, bisTotal: 10, tenureDays: 9999 },
        ]) {
            const { score } = needScore(input);
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(1);
        }
    });
});

describe("droughtDays — a small item resets the wait only partly", () => {
    const at = (daysAgo) => now - daysAgo * DAY;

    it("is the full drought without any award", () => {
        expect(droughtDays([], null)).toBe(30);
    });

    it("equals the days since the last item when every weight is 1 or more", () => {
        expect(droughtDays([{ awardedAt: at(40), weight: 1 }, { awardedAt: at(12), weight: 2 }], 12)).toBe(12);
        expect(droughtDays([{ awardedAt: at(50), weight: 1 }], 50)).toBe(30);
    });

    it("halves a full wait for an item of weight 0.5", () => {
        // never got anything (30) → halved to 15 → plus the 4 days since
        expect(droughtDays([{ awardedAt: at(4), weight: 0.5 }], 4)).toBe(19);
    });

    it("leaves the wait alone for an item of weight 0", () => {
        expect(droughtDays([{ awardedAt: at(2), weight: 0 }], 2)).toBe(30);
    });

    it("walks the awards oldest first, whatever order they come in", () => {
        // weight 1 twenty days ago → 0; 16 days later at 16 → × 0.5 = 8; + 4 days = 12
        expect(droughtDays([{ awardedAt: at(4), weight: 0.5 }, { awardedAt: at(20), weight: 1 }], 4)).toBe(12);
    });
});

describe("resolveWeights", () => {
    it("normalises the need weights to shares of 1", () => {
        const w = resolveWeights({ classes: {}, items: {}, need: { drought: 30, share: 30, need: 30, tenure: 10 }, tenureDays: 90 });
        expect(w.needShares).toEqual({ drought: 0.3, share: 0.3, need: 0.3, tenure: 0.1 });
        const same = resolveWeights({ classes: {}, items: {}, need: { drought: 3, share: 3, need: 3, tenure: 1 }, tenureDays: 90 });
        expect(same.needShares).toEqual(w.needShares);
    });
});

describe("councilRoster — loot points", () => {
    it("counts a trinket double and a set piece once: 2 items · 3 points", () => {
        mockListAll.mockReturnValue([
            lootRow({ itemId: TRINKET, awardedAt: now - 2 * DAY }),
            lootRow({ itemId: SET, awardedAt: now - 5 * DAY }),
        ]);
        const row = councilRoster({}).rows[0];
        expect(row.lootCount).toBe(2);
        expect(row.lootPoints).toBe(3);
        expect(row.items.map((i) => [i.itemId, i.weightClass, i.weight])).toEqual([[TRINKET, "trinket", 2], [SET, "set", 1]]);
    });

    it("tells a weapon on the raider's BiS list from any other weapon", () => {
        mockListAll.mockReturnValue([
            lootRow({ itemId: BIS_STAFF, awardedAt: now - 2 * DAY }),
            lootRow({ itemId: OTHER_WEAPON, awardedAt: now - 3 * DAY }),
        ]);
        const row = councilRoster({ bisTier: "t6" }).rows[0];
        expect(row.items.map((i) => i.weightClass)).toEqual(["bisWeapon", "weapon"]);
        expect(row.lootPoints).toBe(3.5);
    });

    it("knows a fury warrior's BiS weapon from his own list (#669)", () => {
        mockAnnotated.mockReturnValue([{ key: "hauer", className: "Warrior", spec: "Fury" }]);
        mockListAll.mockReturnValue([
            lootRow({ characterKey: "hauer", character: "Hauer", itemId: 32837, itemName: "Warglaive of Azzinoth", awardedAt: now - 2 * DAY }),
            lootRow({ characterKey: "hauer", character: "Hauer", itemId: BIS_STAFF, awardedAt: now - 3 * DAY }),
        ]);
        const row = councilRoster({ bisTier: "t6" }).rows[0];
        expect(row.role).toBe("melee");
        expect(row.items.map((i) => i.weightClass)).toEqual(["bisWeapon", "weapon"]);
    });

    it("lets an item exception beat its class", () => {
        mockListAll.mockReturnValue([lootRow({ itemId: TRINKET })]);
        const weights = { ...councilWeights.defaults(), items: { [TRINKET]: { weight: 0.3, name: "Eye" } } };
        const row = councilRoster({ weights }).rows[0];
        expect(row.items[0]).toMatchObject({ weightClass: "override", weight: 0.3 });
        expect(row.lootPoints).toBe(0.3);
    });

    it("compares the share by points: one trinket weighs like two set pieces", () => {
        mockAnnotated.mockReturnValue([shadow("a"), shadow("b"), shadow("c")]);
        mockListAll.mockReturnValue([
            lootRow({ characterKey: "a", character: "A", itemId: TRINKET, awardedAt: now - 40 * DAY }),
            lootRow({ characterKey: "b", character: "B", itemId: SET, awardedAt: now - 40 * DAY }),
            lootRow({ characterKey: "c", character: "C", itemId: SET, awardedAt: now - 40 * DAY }),
        ]);
        const built = councilRoster({});
        const by = Object.fromEntries(built.rows.map((r) => [r.key, r]));
        expect(built.avgLootPoints).toBeCloseTo(1.3, 1);
        expect(by.a.needParts.share).toBe(0);
        expect(by.b.needParts.share).toBeGreaterThan(0);
        expect(by.b.needScore).toBeGreaterThan(by.a.needScore);
    });

    it("resets the wait only partly for a frequent drop", () => {
        mockListAll.mockReturnValue([lootRow({ itemId: FREQUENT, awardedAt: now - 4 * DAY - 1000 })]);
        const row = councilRoster({}).rows[0];
        expect(row.items[0]).toMatchObject({ weightClass: "frequent", weight: 0.5 });
        expect(row.daysSinceLoot).toBe(4);
        expect(row.droughtDays).toBe(19);
        expect(row.needParts.drought).toBeCloseTo(19 / 30, 3);
    });

    it("sends the weighting it computed with", () => {
        const built = councilRoster({});
        expect(built.weights).toMatchObject({
            scope: "global",
            need: { drought: 45, share: 30, need: 10, tenure: 15 },
            needShares: { drought: 0.45, share: 0.3, need: 0.1, tenure: 0.15 },
            tenureDays: 90,
            droughtDays: 30,
        });
    });

    it("uses a category's own weighting from the store", () => {
        councilWeights.setWeights("cat-mo", { classes: { trinket: 4 } });
        mockListAll.mockReturnValue([lootRow({ itemId: TRINKET })]);
        const built = councilRoster({ categoryId: "cat-mo" });
        expect(built.weights.scope).toBe("category");
        expect(built.rows[0].lootPoints).toBe(4);
        expect(councilRoster({}).rows[0].lootPoints).toBe(2);
    });

    it("carries points and belonging onto a candidate", () => {
        mockListAll.mockReturnValue([lootRow({ itemId: TRINKET })]);
        mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([])]]));
        const rows = councilRoster({}).rows;
        const [candidate] = candidateSplit(SET, rows, new Map([["devihra", gearOf([])]])).candidates;
        expect(candidate).toMatchObject({ lootCount: 1, lootPoints: 2, droughtDays: rows[0].droughtDays, tenureDays: rows[0].tenureDays });
        expect(candidate.needParts).toHaveProperty("tenure");
    });
});

describe("councilRoster — belonging (dabei seit)", () => {
    const roster = (members, history = []) => ({ id: "r1", categoryId: "cat-mo", members, history });

    it("takes the roster's date and counts it for the person's characters", () => {
        mockRosters.mockReturnValue([roster({ u1: { status: "core", since: iso(now - 120 * DAY), chars: ["devihra"], charNames: {} } })]);
        mockListAll.mockReturnValue([lootRow({ awardedAt: now - 3 * DAY })]);
        const listed = councilRoster({ categoryId: "cat-mo" }).rows[0];
        expect(listed.joinedFrom).toBe("roster");
        expect(listed.tenureDays).toBe(120);
        expect(listed.needParts.tenure).toBe(1);
    });

    it("prefers the first raid when it is earlier than a migrated roster date", () => {
        mockRosters.mockReturnValue([roster({ u1: { status: "core", since: iso(now - 5 * DAY), chars: ["devihra"] } })]);
        mockRaidEvents.mockReturnValue([{ id: "e1", categoryId: "cat-mo", startTime: Math.floor((now - 60 * DAY) / 1000), signUps: [] }]);
        mockLogs.mockReturnValue([{ eventId: "e1", reportRefId: "abc123" }]);
        mockGetReport.mockReturnValue({ id: "abc123", roster: [{ name: "Devihra-Thunderstrike" }] });
        mockListAll.mockReturnValue([lootRow({ awardedAt: now - 3 * DAY })]);
        const row = councilRoster({ categoryId: "cat-mo" }).rows[0];
        expect(row.joinedFrom).toBe("raid");
        expect(row.tenureDays).toBe(60);
    });

    it("uses the oldest roster history line about the person", () => {
        mockRosters.mockReturnValue([roster(
            { u1: { status: "core", since: iso(now - 5 * DAY), chars: ["devihra"] } },
            [{ at: iso(now - 70 * DAY), userId: "u1", what: "add" }],
        )]);
        mockListAll.mockReturnValue([lootRow({ awardedAt: now - 3 * DAY })]);
        expect(councilRoster({ categoryId: "cat-mo" }).rows[0].tenureDays).toBe(70);
    });

    it("counts a signup of the person's account as a raid", () => {
        mockRosters.mockReturnValue([roster({ u1: { status: "core", since: iso(now - 5 * DAY), chars: ["devihra"] } })]);
        mockRaidEvents.mockReturnValue([{
            id: "e1", categoryId: "cat-mo", startTime: Math.floor((now - 30 * DAY) / 1000),
            signUps: [{ userId: "u1", status: "signed" }, { userId: "u2", status: "absence" }],
        }]);
        mockListAll.mockReturnValue([lootRow({ awardedAt: now - 3 * DAY })]);
        const row = councilRoster({ categoryId: "cat-mo" }).rows[0];
        expect(row).toMatchObject({ joinedFrom: "raid", tenureDays: 30 });
    });

    it("falls back to the first loot without a roster, and to nothing without data", () => {
        mockListAll.mockReturnValue([
            lootRow({ awardedAt: now - 3 * DAY }),
            lootRow({ reason: "offspec", awardedAt: now - 50 * DAY }),
        ]);
        const row = councilRoster({}).rows[0];
        expect(row).toMatchObject({ joinedFrom: "loot", tenureDays: 50 });

        mockListAll.mockReturnValue([]);
        mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([])]]));
        const fresh = councilRoster({}).rows[0];
        expect(fresh).toMatchObject({ joinedAt: 0, joinedFrom: "", tenureDays: 0 });
        expect(fresh.needParts.tenure).toBe(0);
    });

    it("leaves stand-ins outside the roster out of the share's average (#667)", () => {
        mockAnnotated.mockReturnValue([shadow(), shadow("fremd")]);
        mockRosters.mockReturnValue([roster({ u1: { status: "core", since: iso(now - 20 * DAY), chars: ["devihra"] } })]);
        mockListAll.mockReturnValue([
            lootRow({ itemId: SET, awardedAt: now - 3 * DAY }),
            lootRow({ characterKey: "fremd", character: "Fremd", itemId: TRINKET, awardedAt: now - 3 * DAY }),
            lootRow({ characterKey: "fremd", character: "Fremd", itemId: TRINKET, awardedAt: now - 4 * DAY }),
        ]);
        const built = councilRoster({ categoryId: "cat-mo" });
        expect(built.rows.map((r) => r.key)).toEqual(["devihra"]);
        expect(built.avgLootPoints).toBe(1);
        const outsider = (built.outsiders || []).find((o) => o.key === "fremd");
        expect(outsider).toMatchObject({ lootPoints: 4 });
        expect(outsider.needScore).toBeUndefined();
    });

    it("only counts the category's own raids and loot", () => {
        mockListAll.mockReturnValue([
            lootRow({ awardedAt: now - 3 * DAY }),
            lootRow({ categoryId: "cat-do", awardedAt: now - 80 * DAY }),
        ]);
        expect(councilRoster({ categoryId: "cat-mo" }).rows[0].tenureDays).toBe(3);
        expect(councilRoster({}).rows[0].tenureDays).toBe(80);
    });
});
