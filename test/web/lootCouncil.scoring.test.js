// How the need score is composed, how an upgrade is valued (especially
// around the hit cap) and which loot counts as having been given something.
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
        candidatesForItem, needScore, upgradeValue, gearSpellHit, NEED_WEIGHTS,
    },
} = require("../../src/web/lootCouncil");
const { specByKey, hitCapFor } = require("../../src/config/casterSpecs");
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
    describe("needScore", () => {
        it("is made of three visible parts", () => {
            const { score, parts } = needScore({ daysSinceLoot: 15, lootCount: 1, avgLootCount: 2, bisOwned: 5, bisTotal: 10 });
            expect(parts).toEqual({ drought: 0.5, share: 0.5, need: 0.5 });
            expect(score).toBeCloseTo(0.5, 5);
        });

        it("weighs the wait most, the loot share next and the BiS gap least", () => {
            expect(NEED_WEIGHTS).toEqual({ drought: 0.5, share: 0.4, need: 0.1 });
            const only = (over) => needScore({ daysSinceLoot: 0, lootCount: 5, avgLootCount: 1, bisOwned: 10, bisTotal: 10, ...over }).score;
            expect(only({ daysSinceLoot: 30 })).toBeCloseTo(0.5, 5);
            expect(only({ lootCount: 0, avgLootCount: 4 })).toBeCloseTo(0.4, 5);
            expect(only({ bisOwned: 0 })).toBeCloseTo(0.1, 5);
        });

        it("caps the drought at 30 days, so an ancient date cannot dominate", () => {
            const a = needScore({ daysSinceLoot: 30, lootCount: 0, avgLootCount: 0, bisOwned: 0, bisTotal: 0 });
            const b = needScore({ daysSinceLoot: 900, lootCount: 0, avgLootCount: 0, bisOwned: 0, bisTotal: 0 });
            expect(a.parts.drought).toBe(1);
            expect(b.parts.drought).toBe(1);
        });

        it("treats 'never got anything' as the full drought", () => {
            expect(needScore({ daysSinceLoot: null, lootCount: 0, avgLootCount: 1, bisOwned: 0, bisTotal: 1 }).parts.drought).toBe(1);
        });

        it("gives a raider above the average no negative share", () => {
            expect(needScore({ daysSinceLoot: 1, lootCount: 10, avgLootCount: 2, bisOwned: 0, bisTotal: 0 }).parts.share).toBe(0);
        });

        it("stays in 0..1", () => {
            const extremes = [
                { daysSinceLoot: 0, lootCount: 99, avgLootCount: 1, bisOwned: 10, bisTotal: 10 },
                { daysSinceLoot: 999, lootCount: 0, avgLootCount: 9, bisOwned: 0, bisTotal: 10 },
            ];
            for (const input of extremes) {
                const { score } = needScore(input);
                expect(score).toBeGreaterThanOrEqual(0);
                expect(score).toBeLessThanOrEqual(1);
            }
        });
    });

    describe("upgradeValue", () => {
        const shadow = specByKey("Priest-Shadow");

        it("is positive for a straight upgrade over an empty slot", () => {
            const gear = gearOf([]);
            expect(upgradeValue({ gear, specEntry: shadow, itemId: 31064, replaces: null })).toBeGreaterThan(0);
        });

        it("is zero when an item replaces itself", () => {
            const gear = gearOf([item(0, 31064)]);
            const replaces = { itemId: 31064 };
            expect(upgradeValue({ gear, specEntry: shadow, itemId: 31064, replaces })).toBe(0);
        });

        it("goes negative when the incoming item is worse", () => {
            const bis = wowsims.bisFor("Priest-Shadow", "t6").items;
            const strong = bis.find((b) => (wowsims.item(b.id) || { stats: {} }).stats.spellPower > 40);
            const gear = gearOf([item(0, strong.id)]);
            // Swapping a T6 piece for a much weaker one has to read as a loss.
            const weak = 29352;
            const value = upgradeValue({ gear, specEntry: shadow, itemId: weak, replaces: { itemId: strong.id } });
            expect(value).toBeLessThan(0);
        });

        it("stops counting hit once the raider is capped", () => {
            // The whole point: a capped raider must not be handed the hit item
            // over someone who still needs it.
            const cap = hitCapFor(shadow);
            const hitItem = Object.entries(require("../../src/config/generated/wowsims/items.json").items)
                .find(([, it]) => it.stats.spellHit >= 20 && it.slots.includes(12));
            expect(hitItem).toBeTruthy();
            const [hitId] = hitItem;

            // A raider far below the cap values the hit fully...
            const uncapped = gearOf([]);
            const gainUncapped = upgradeValue({ gear: uncapped, specEntry: shadow, itemId: Number(hitId), replaces: null });

            // ...one already at the cap does not.
            const cappedItems = [];
            let hit = 0;
            for (const [id, it] of Object.entries(require("../../src/config/generated/wowsims/items.json").items)) {
                if (hit >= cap) break;
                if (it.stats.spellHit > 0 && !it.slots.includes(12)) {
                    cappedItems.push(item(it.slots[0], Number(id)));
                    hit += it.stats.spellHit;
                }
            }
            const capped = gearOf(cappedItems);
            expect(gearSpellHit(capped)).toBeGreaterThanOrEqual(cap);
            const gainCapped = upgradeValue({ gear: capped, specEntry: shadow, itemId: Number(hitId), replaces: null });
            expect(gainCapped).toBeLessThan(gainUncapped);
        });

        it("returns 0 for an item the table does not know", () => {
            expect(upgradeValue({ gear: gearOf([]), specEntry: shadow, itemId: 999999, replaces: null })).toBe(0);
        });
    });
});

describe("web/lootCouncil — what counts as having been given something", () => {
    // A council weighs who is owed a drop. An off-spec roll, a shard or a bank
    // item did nothing for the raider's set, so counting them would rank
    // somebody who politely took three shards above one real upgrade.
    function withReasons(reasons) {
        mockListAll.mockReturnValue(reasons.map((reason, i) => lootRow({
            reason,
            reasonLabel: reason,
            awardedAt: now - (i + 1) * DAY,
        })));
        mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
        return councilRoster({}).rows[0];
    }

    it("counts real awards", () => {
        const row = withReasons(["bis", "mainspec", "upgrade", "minor"]);
        expect(row.lootCount).toBe(4);
        expect(row.otherCount).toBe(0);
    });

    it("does not count off-spec, shards or bank items", () => {
        const row = withReasons(["offspec", "disenchant", "bank", "greed", "pvp"]);
        expect(row.lootCount).toBe(0);
        expect(row.otherCount).toBe(5);
    });

    it("keeps them out of the item list the hover shows", () => {
        const row = withReasons(["mainspec", "disenchant", "offspec"]);
        expect(row.items.map((i) => i.reason)).toEqual(["mainspec"]);
    });

    it("counts an unrecognised response, because it is more often a real award", () => {
        // Treating a guild's own wording for a mainspec roll as nothing is the
        // worse of the two possible mistakes.
        expect(withReasons(["other"]).lootCount).toBe(1);
    });

    it("does not let a shard reset the drought", () => {
        // The whole point: someone whose only recent "loot" was a shard has
        // still been waiting, and has to keep their place in the ranking.
        mockListAll.mockReturnValue([
            lootRow({ reason: "disenchant", awardedAt: now - 1 * DAY }),
            lootRow({ reason: "mainspec", awardedAt: now - 40 * DAY }),
        ]);
        mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
        const row = councilRoster({}).rows[0];
        expect(row.daysSinceLoot).toBeGreaterThanOrEqual(40);
        expect(row.lootCount).toBe(1);
        expect(row.otherCount).toBe(1);
    });

    it("carries the same counts onto a candidate", () => {
        mockListAll.mockReturnValue([
            lootRow({ reason: "mainspec" }),
            lootRow({ reason: "offspec" }),
        ]);
        mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
        mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([])]]));
        const [candidate] = candidatesForItem(31064, councilRoster({}).rows);
        expect(candidate.lootCount).toBe(1);
        expect(candidate.otherCount).toBe(1);
    });
});
