// Every data source is mocked — what is under test is the aggregation: who ends
// up on the council, how the need score is composed, how an upgrade is valued
// (especially around the hit cap) and how the BiS gaps are grouped.
const mockListAll = jest.fn(() => []);
const mockAnnotated = jest.fn(() => []);
const mockGearByCharacter = jest.fn(() => new Map());
const mockCharacterMap = jest.fn(() => ({}));

jest.mock("../../src/web/lootStore", () => ({ listAll: (...a) => mockListAll(...a) }));
jest.mock("../../src/web/characterInfo", () => ({ annotatedCharacters: (...a) => mockAnnotated(...a) }));
jest.mock("../../src/web/charGear", () => ({ gearByCharacter: (...a) => mockGearByCharacter(...a) }));
jest.mock("../../src/web/characterStore", () => ({ characterMap: (...a) => mockCharacterMap(...a) }));

const {
    councilRoster, candidatesForItem, bisGaps, needScore, upgradeValue, currentTier,
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

const gearOf = (items, over = {}) => ({
    key: "devihra", character: "Devihra", className: "Priest", seenAt: now - DAY,
    reportId: "r1", reportTitle: "Report", items, ...over,
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
            const hitItem = Object.entries(require("../../src/config/wowsims/casterItems.json").items)
                .find(([, it]) => it.stats.spellHit >= 20 && it.slots.includes(12));
            expect(hitItem).toBeTruthy();
            const [hitId] = hitItem;

            // A raider far below the cap values the hit fully...
            const uncapped = gearOf([]);
            const gainUncapped = upgradeValue({ gear: uncapped, specEntry: shadow, itemId: Number(hitId), replaces: null });

            // ...one already at the cap does not.
            const cappedItems = [];
            let hit = 0;
            for (const [id, it] of Object.entries(require("../../src/config/wowsims/casterItems.json").items)) {
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

        it("is empty for a healer, who has no BiS list at all", () => {
            mockAnnotated.mockReturnValue([{ key: "heala", className: "Shaman", spec: "Restoration" }]);
            mockGearByCharacter.mockReturnValue(new Map([["heala", gearOf([], { key: "heala", character: "Heala", className: "Shaman" })]]));
            expect(bisGaps(councilRoster({ role: "healer" }).rows)).toEqual([]);
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
