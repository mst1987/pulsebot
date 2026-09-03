// Every data source is mocked — what is under test is the aggregation: who ends
// up on the council, how the need score is composed, how an upgrade is valued
// (especially around the hit cap) and how the BiS gaps are grouped.
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

jest.mock("../../src/web/lootStore", () => ({ listAll: (...a) => mockListAll(...a) }));
jest.mock("../../src/web/characterInfo", () => ({ annotatedCharacters: (...a) => mockAnnotated(...a) }));
jest.mock("../../src/web/charGear", () => ({ gearByCharacter: (...a) => mockGearByCharacter(...a) }));
jest.mock("../../src/web/characterStore", () => ({ characterMap: (...a) => mockCharacterMap(...a) }));
jest.mock("../../src/web/raiderCharactersStore", () => ({ getCategoryAssignments: (...a) => mockAssignments(...a) }));
jest.mock("../../src/web/councilStore", () => ({
    excludedKeys: (...a) => mockExcludedKeys(...a),
    plannedRoles: (...a) => mockPlannedRoles(...a),
}));
jest.mock("../../src/web/raidEventStore", () => ({ listRaidEvents: (...a) => mockRaidEvents(...a) }));
jest.mock("../../src/web/logStore", () => ({ listLogs: (...a) => mockLogs(...a) }));
jest.mock("../../src/web/reportStore", () => ({
    listReports: (...a) => mockListReports(...a),
    getReport: (...a) => mockGetReport(...a),
}));

const {
    councilRoster, candidatesForItem, bisGaps, needScore, upgradeValue, currentTier, wornItemView,
    gearSpellHit, resolveContentFilter,
} = require("../../src/web/lootCouncil");
const { specByKey, hitCapFor } = require("../../src/config/casterSpecs");
const wowsims = require("../../src/config/wowsims");

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const lootRow = (over = {}) => ({
    characterKey: "devihra", character: "Devihra", itemId: 31064, itemName: "Hood of Absolution",
    itemIconUrl: "", itemQuality: 4, contentId: "bt", boss: "Illidan", categoryId: "cat-mo",
    reason: "mainspec", reasonLabel: "Mainspec", reasonTone: "mainspec",
    awardedAt: now - 3 * DAY, eventLabel: "Montagsraid", ...over,
});

// Mirrors what charGear.js hands out, profile included — the council reads it
// to warn when a raider was last logged wearing healing gear.
const gearOf = (items, over = {}) => ({
    key: "devihra", character: "Devihra", className: "Priest", seenAt: now - DAY,
    reportId: "r1", reportTitle: "Report", items,
    profile: { role: "caster", confident: true }, skippedReports: 0, roleMismatch: false,
    ...over,
});

const item = (slot, itemId, itemLevel = 140) => ({
    slot, itemId, itemLevel, gems: [], enchantId: 0, itemName: `Item ${itemId}`,
});

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

    describe("needScore", () => {
        it("is made of three visible parts", () => {
            const { score, parts } = needScore({ daysSinceLoot: 15, lootCount: 1, avgLootCount: 2, bisOwned: 5, bisTotal: 10 });
            expect(parts).toEqual({ drought: 0.5, share: 0.5, need: 0.5 });
            expect(score).toBeCloseTo(0.5, 5);
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
            const hitItem = Object.entries(require("../../src/config/wowsims/items.json").items)
                .find(([, it]) => it.stats.spellHit >= 20 && it.slots.includes(12));
            expect(hitItem).toBeTruthy();
            const [hitId] = hitItem;

            // A raider far below the cap values the hit fully...
            const uncapped = gearOf([]);
            const gainUncapped = upgradeValue({ gear: uncapped, specEntry: shadow, itemId: Number(hitId), replaces: null });

            // ...one already at the cap does not.
            const cappedItems = [];
            let hit = 0;
            for (const [id, it] of Object.entries(require("../../src/config/wowsims/items.json").items)) {
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

    describe("candidatesForItem", () => {
        function twoCasters() {
            mockAnnotated.mockReturnValue([
                { key: "devihra", className: "Priest", spec: "Shadow" },
                { key: "magier", className: "Mage", spec: "Arcane" },
            ]);
            mockGearByCharacter.mockReturnValue(new Map([
                ["devihra", gearOf([item(0, 29352)])],
                ["magier", gearOf([], { key: "magier", character: "Magier", className: "Mage" })],
            ]));
            return councilRoster().rows;
        }

        it("lists everyone the item fits, best gain first", () => {
            const rows = twoCasters();
            const candidates = candidatesForItem(31064, rows);
            expect(candidates.length).toBe(2);
            expect(candidates[0].value).toBeGreaterThanOrEqual(candidates[1].value);
        });

        it("says what the item would replace, or that the slot is free", () => {
            const rows = twoCasters();
            const byChar = Object.fromEntries(candidatesForItem(31064, rows).map((c) => [c.character, c]));
            expect(byChar.Devihra.replaces).toMatchObject({ itemId: 29352 });
            expect(byChar.Magier.replaces).toBeNull();
        });

        it("marks a candidate for whom the item is BiS", () => {
            const bisId = wowsims.bisFor("Priest-Shadow", "t6").items[0].id;
            mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
            mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([])]]));
            const rows = councilRoster({ bisTier: "t6" }).rows;
            expect(candidatesForItem(bisId, rows)[0].isBis).toBe(true);
        });

        it("returns nothing for an item nobody can equip", () => {
            expect(candidatesForItem(999999, twoCasters())).toEqual([]);
        });

        it("judges the drop against caster gear, like the roster does", () => {
            // Without this the drop check compares a caster's upgrade against
            // the healing set they wore on Thursday — the very thing the roster
            // already refuses to do.
            const rows = twoCasters();
            mockGearByCharacter.mockClear();
            candidatesForItem(31064, rows);
            const { roleFor } = mockGearByCharacter.mock.calls[0][0];
            expect(roleFor("devihra")).toBe("caster");
        });

        it("marks a gain that is measured against a slot it cannot read", () => {
            // A raider wearing Mark of the Champion has, as far as any
            // comparison goes, an empty trinket slot — so they are credited the
            // full worth of the drop while everybody else only gets the
            // difference. The number stands, the incomparability is named.
            const trinketId = wowsims.bisFor("Priest-Shadow", "t6").items
                .find((e) => wowsims.slotsFor(e.id).includes(12)).id;
            mockAnnotated.mockReturnValue([
                { key: "devihra", className: "Priest", spec: "Shadow" },
                { key: "magier", className: "Mage", spec: "Arcane" },
            ]);
            mockGearByCharacter.mockReturnValue(new Map([
                ["devihra", gearOf([
                    { ...item(12, 23207), situational: { note: "wirkt nur gegen Untote und Dämonen" } },
                    item(13, 29370),
                ])],
                ["magier", gearOf([item(12, 29370), item(13, 32483)], { key: "magier", character: "Magier", className: "Mage" })],
            ]));
            const byChar = Object.fromEntries(
                candidatesForItem(trinketId, councilRoster({ bisTier: "t6" }).rows).map((c) => [c.character, c]),
            );
            expect(byChar.Devihra.inflatedBy).toHaveLength(1);
            expect(byChar.Devihra.inflatedBy[0]).toMatchObject({ itemName: "Item 23207" });
            expect(byChar.Devihra.inflatedBy[0].note).toContain("Untote");
            // The raider with a real trinket on the slot is compared normally.
            expect(byChar.Magier.inflatedBy).toEqual([]);
        });

        it("leaves a genuinely free slot uncommented", () => {
            // An empty slot is not a hole in the comparison — the raider really
            // does own nothing there, and the full gain is the truth.
            const rows = twoCasters();
            const byChar = Object.fromEntries(candidatesForItem(31064, rows).map((c) => [c.character, c]));
            expect(byChar.Magier.replaces).toBeNull();
            expect(byChar.Magier.inflatedBy).toEqual([]);
        });
    });

    describe("bisGaps", () => {
        it("lists only items nobody in the group wears yet", () => {
            const bis = wowsims.bisFor("Priest-Shadow", "t6").items;
            mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
            mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([item(0, bis[0].id)])]]));
            const rows = councilRoster({ bisTier: "t6" }).rows;
            const gaps = bisGaps(rows);
            expect(gaps.map((g) => g.id)).not.toContain(bis[0].id);
            // The T6 shadow list names Ring of Recurrence twice, so grouping by
            // item id yields fewer rows than the list has entries.
            const distinct = new Set(bis.map((e) => e.id)).size;
            expect(gaps.length).toBe(distinct - 1);
        });

        it("names who is waiting for each item and suggests one of them", () => {
            mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
            mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([])]]));
            const gaps = bisGaps(councilRoster({ bisTier: "t6" }).rows);
            expect(gaps[0].wantedBy.map((w) => w.character)).toContain("Devihra");
            expect(gaps[0].best).toBeTruthy();
        });

it("works for a healer too, off Wowhead's list", () => {
            // WoWSims ships no healing set, so this list comes from Wowhead.
            // A healer with nothing on is missing their whole set, and the
            // council should be told that rather than shown an empty tab.
            mockAnnotated.mockReturnValue([{ key: "heala", className: "Shaman", spec: "Restoration" }]);
            mockGearByCharacter.mockReturnValue(new Map([["heala", gearOf([], { key: "heala", character: "Heala", className: "Shaman" })]]));
            const gaps = bisGaps(councilRoster({ role: "healer", bisTier: "t6" }).rows);
            expect(gaps.length).toBeGreaterThan(10);
            expect(gaps[0].wantedBy.map((w) => w.character)).toContain("Heala");
        });

        it("respects the content filter", () => {
            mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
            mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([])]]));
            const rows = councilRoster({ bisTier: "t6" }).rows;
            const onlyBt = bisGaps(rows, { contentIds: new Set(["bt"]) });
            // Everything the filter kept either comes from BT or from an item
            // the content table cannot place (which is never filed wrongly).
            for (const gap of onlyBt) expect(["bt", ""]).toContain(gap.contentId);
            expect(onlyBt.length).toBeLessThan(bisGaps(rows).length);
        });
    });
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

describe("web/lootCouncil — the worn gear a council looks at", () => {
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
            const [candidate] = candidatesForItem(31064, rows);
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

describe("web/lootCouncil — the loot history on a candidate", () => {
    it("carries the newest awards, so the count can be opened in a hover", () => {
        // A council asks "wer kriegt es?" and "was hat der schon bekommen?" in
        // one breath — the second answer has to be in the same payload.
        mockListAll.mockReturnValue([
            lootRow({ awardedAt: now - 1 * 86400000, itemName: "Neu" }),
            lootRow({ awardedAt: now - 9 * 86400000, itemName: "Alt" }),
        ]);
        mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
        mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([])]]));

        const [candidate] = candidatesForItem(31064, councilRoster().rows);
        expect(candidate.recentItems.map((i) => i.itemName)).toEqual(["Neu", "Alt"]);
        expect(candidate.lootCount).toBe(2);
    });

    it("caps the list while keeping the true count", () => {
        // The hover shows a handful; the number must stay honest.
        const many = Array.from({ length: 20 }, (_, i) => lootRow({ awardedAt: now - i * 86400000 }));
        mockListAll.mockReturnValue(many);
        mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
        mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([])]]));

        const [candidate] = candidatesForItem(31064, councilRoster().rows);
        expect(candidate.lootCount).toBe(20);
        expect(candidate.recentItems.length).toBeLessThan(20);
        expect(candidate.recentItems.length).toBeGreaterThan(0);
    });

    it("is empty for a raider who has never won anything", () => {
        mockListAll.mockReturnValue([]);
        mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
        mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([])]]));
        const [candidate] = candidatesForItem(31064, councilRoster().rows);
        expect(candidate.recentItems).toEqual([]);
        expect(candidate.lootCount).toBe(0);
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

describe("web/lootCouncil — judging a caster on caster gear", () => {
    it("asks charGear for a set matching the raider's role", () => {
        // Shamans and druids heal a night regularly; their newest log then shows
        // a healing set, which would give a DPS caster no DPS and let every drop
        // "replace" a healing piece.
        mockAnnotated.mockReturnValue([
            { key: "devihra", className: "Priest", spec: "Shadow" },
            { key: "heala", className: "Shaman", spec: "Restoration" },
        ]);
        mockGearByCharacter.mockReturnValue(new Map());
        councilRoster({ role: "" });

        expect(mockGearByCharacter).toHaveBeenCalledWith(
            expect.objectContaining({ roleFor: expect.any(Function) }),
        );
        const { roleFor } = mockGearByCharacter.mock.calls[0][0];
        expect(roleFor("devihra")).toBe("caster");
        expect(roleFor("heala")).toBe("healer");
        expect(roleFor("unbekannt")).toBe("");
    });

    it("passes the gear verdict on to the page", () => {
        mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
        mockGearByCharacter.mockReturnValue(new Map([["devihra", {
            ...gearOf([item(0, 31064)]),
            profile: { role: "healer", confident: true },
            roleMismatch: true,
            skippedReports: 2,
        }]]));
        const row = councilRoster({}).rows[0];
        expect(row.gear).toMatchObject({ setRole: "healer", roleMismatch: true, skippedReports: 2 });
    });

    // Ein Heiler spielt hin und wieder Offspec. Aus den Daten geht das nicht
    // hervor — dort steht die Spec, mit der er zuletzt geloggt wurde —, also
    // legt der Raidlead es fest.
    describe("als was jemand eingeplant ist", () => {
        const holyPriest = () => {
            mockAnnotated.mockReturnValue([{ key: "heala", className: "Priest", spec: "Holy" }]);
            mockGearByCharacter.mockReturnValue(new Map([["heala", gearOf([item(0, 31064)], {
                key: "heala", character: "Heala", className: "Priest",
            })]]));
        };

        it("folgt den Daten, solange niemand etwas festgelegt hat", () => {
            holyPriest();
            const row = councilRoster({ role: "healer" }).rows[0];
            expect(row).toMatchObject({ role: "healer", specKey: "Priest-Holy", roleOverride: "" });
        });

        it("plant einen Heiler als DPS ein, wenn es festgelegt ist", () => {
            holyPriest();
            mockPlannedRoles.mockReturnValue(new Map([["heala", "caster"]]));
            const row = councilRoster({ role: "caster" }).rows[0];
            // Mit der Rolle wechselt die Spec — und damit BiS-Liste,
            // Stat-Gewichte und Simulation.
            expect(row).toMatchObject({ role: "caster", specKey: "Priest-Shadow", roleOverride: "caster" });
            expect(row.bis.total).toBeGreaterThan(0);
            // Was die Daten sagen, bleibt sichtbar.
            expect(row.roleFromData).toBe("healer");
        });

        it("sucht danach auch das passende Gear", () => {
            // Die Rolle entscheidet, welches Set aus den Auswertungen gesucht
            // wird — ein als DPS eingeplanter Heiler darf nicht am Heilset
            // gemessen werden.
            holyPriest();
            mockPlannedRoles.mockReturnValue(new Map([["heala", "caster"]]));
            councilRoster({});
            const { roleFor } = mockGearByCharacter.mock.calls[0][0];
            expect(roleFor("heala")).toBe("caster");
        });

        it("nennt die Rollen, zwischen denen die Klasse überhaupt wählen kann", () => {
            holyPriest();
            expect(councilRoster({ role: "healer" }).rows[0].roleOptions.sort()).toEqual(["caster", "healer"]);

            mockAnnotated.mockReturnValue([{ key: "magier", className: "Mage", spec: "Arcane" }]);
            mockGearByCharacter.mockReturnValue(new Map([["magier", gearOf([item(0, 31064)], {
                key: "magier", character: "Magier", className: "Mage",
            })]]));
            // Ein Magier ist nie Heiler — die Seite zeigt dann keinen Schalter.
            expect(councilRoster({}).rows[0].roleOptions).toEqual(["caster"]);
        });

        it("ignoriert eine Festlegung, die die Klasse nicht hergibt", () => {
            // Ein Paladin lässt sich nicht als Caster einplanen; dann bleibt es
            // bei dem, was die Daten sagen, statt ihn zu verlieren.
            mockAnnotated.mockReturnValue([{ key: "pala", className: "Paladin", spec: "Holy" }]);
            mockGearByCharacter.mockReturnValue(new Map([["pala", gearOf([item(0, 31064)], {
                key: "pala", character: "Pala", className: "Paladin",
            })]]));
            mockPlannedRoles.mockReturnValue(new Map([["pala", "caster"]]));
            const row = councilRoster({ role: "healer" }).rows[0];
            expect(row).toMatchObject({ role: "healer", roleOverride: "" });
        });
    });

    it("gives every raider a link to their armory", () => {
        // Das Gear auf dieser Seite ist zuletzt im Log gesehen, nie live — ohne
        // den Link müsste ein Council es glauben statt es zu prüfen.
        mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
        mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([item(0, 31064)])]]));
        const row = councilRoster({}).rows[0];
        expect(row.armoryUrl).toMatch(/^https:\/\//);
        expect(row.armoryUrl).toContain(encodeURIComponent(row.character));
    });

    it("counts the slots the comparison cannot read, and the ones it filled instead", () => {
        mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
        mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([
            item(0, 31064),
            { ...item(12, 23207), situational: { note: "wirkt nur gegen Untote und Dämonen" } },
            { ...item(13, 29370), replacedSituational: { itemId: 23206, itemName: "Mark of the Champion", iconUrl: "", note: "…", seenAt: 1, reportTitle: "Alt" } },
        ])]]));
        expect(councilRoster({}).rows[0].gear).toMatchObject({ situational: 1, substituted: 1 });
    });
});
