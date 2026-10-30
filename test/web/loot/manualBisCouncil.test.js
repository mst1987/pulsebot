// The council on hand-maintained BiS lists (#760): a version without BiS data
// (Forever) measures its raiders against the orga's lists - "BiS n von m", the
// open items and the drop candidates by need. TBC never takes this path.
// Item ids here are test ids, not game data.
const mockListAll = jest.fn(() => []);
const mockAnnotated = jest.fn(() => []);
const mockGearByCharacter = jest.fn(() => new Map());

jest.mock("../../../src/stores/lootStore", () => ({ listAll: (...a) => mockListAll(...a) }));
jest.mock("../../../src/services/characters/characterInfo", () => ({ annotatedCharacters: (...a) => mockAnnotated(...a) }));
jest.mock("../../../src/services/loot/charGear", () => ({ gearByCharacter: (...a) => mockGearByCharacter(...a) }));
jest.mock("../../../src/stores/characterStore", () => ({ characterMap: () => ({}) }));
jest.mock("../../../src/stores/raiderCharactersStore", () => ({ getCategoryAssignments: () => ({}) }));
jest.mock("../../../src/stores/councilStore", () => ({ excludedKeys: () => new Set(), plannedRoles: () => new Map() }));
jest.mock("../../../src/stores/raidEventStore", () => ({ listRaidEvents: () => [] }));
jest.mock("../../../src/stores/eventStore", () => ({ listEvents: () => [], getEvent: () => null, isOwnEventId: () => false }));
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: () => [] }));
jest.mock("../../../src/stores/logStore", () => ({ listLogs: () => [] }));
jest.mock("../../../src/stores/reportStore", () => ({ listReports: () => [], getReport: () => null, getReportRoster: () => null }));

const manualBisStore = require("../../../src/stores/manualBisStore");
const { councilRoster } = require("../../../src/web/loot/lootCouncil");
const {
    manualIndex, manualBisForSpec, manualBisItems, manualBisSpecsView, manualItemView,
    manualCandidateSplit, manualBisGaps, searchManualItems,
} = require("../../../src/web/loot/manualBisCouncil");
const { specByKey } = require("../../../src/config/data/councilSpecs");
const { tempStoreFile } = require("../../helpers/tempStore");
const { lootRow, gearOf, item } = require("../../helpers/lootCouncil");

const HOOD = 900001;
const ALT_HOOD = 900002;
const RING = 900010;
const CLOAK = 900020;

/** A shadow priest list: hood (with an alternative), the same ring twice; a mage list naming the cloak. */
function fillLists() {
    manualBisStore.setSlot("forever", "Priest-Shadow", 0, [{ id: HOOD, name: "Kapuze", icon: "inv_helmet_01", quality: 4 }, { id: ALT_HOOD, name: "Andere Kapuze" }]);
    manualBisStore.setSlot("forever", "Priest-Shadow", 10, [{ id: RING, name: "Ring" }]);
    manualBisStore.setSlot("forever", "Priest-Shadow", 11, [{ id: RING, name: "Ring" }]);
    manualBisStore.setSlot("forever", "Mage-Fire", 14, [{ id: CLOAK }]);
}

beforeEach(() => {
    jest.clearAllMocks();
    manualBisStore.useFile(tempStoreFile("council-manual-bis.json"));
    mockListAll.mockReturnValue([lootRow({ itemId: 555, itemName: "Irgendwas" })]);
    mockAnnotated.mockReturnValue([{ key: "devihra", name: "Devihra", className: "Priest", spec: "Shadow" }]);
    // wears the alternative hood and one ring
    mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([item(0, ALT_HOOD), item(10, RING)])]]));
});
afterAll(() => manualBisStore.useFile(null));

describe("manualBisCouncil - the pieces", () => {
    it("indexes who names an item and keeps a stored name over an id-only entry", () => {
        fillLists();
        manualBisStore.setSlot("forever", "Warlock-Destruction", 0, [{ id: HOOD }]);
        const index = manualIndex("forever");
        expect(index.owners.get(HOOD)).toEqual(["Priest-Shadow", "Warlock-Destruction"]);
        expect(index.info.get(HOOD).name).toBe("Kapuze");
        expect(manualBisSpecsView(index, HOOD).map((s) => [s.specKey, s.label, s.role])).toEqual([
            ["Priest-Shadow", "Schattenpriester", "caster"], ["Warlock-Destruction", "Zerstörungs-Hexer", "caster"],
        ]);
        expect(manualBisSpecsView(index, 1)).toEqual([]);
    });

    it("shows an id-only item honestly: no name, no icon", () => {
        fillLists();
        expect(manualItemView(manualIndex("forever"), CLOAK)).toMatchObject({ id: CLOAK, name: "", iconUrl: "", ilvl: 0, stats: {}, contentId: "" });
    });

    it("builds a spec's list in sheet order and counts a slot done with an alternative, copies spent", () => {
        fillLists();
        const index = manualIndex("forever");
        const bis = manualBisForSpec(index, specByKey("Priest-Shadow"));
        expect(bis).toMatchObject({ source: "manual", sourceLabel: "Eigene Liste", tier: "", borrowedFrom: "" });
        expect(bis.items.map((e) => [e.slot, e.id])).toEqual([[0, HOOD], [10, RING], [11, RING]]);
        const items = manualBisItems(index, bis, gearOf([item(0, ALT_HOOD), item(10, RING)]));
        expect(items.map((i) => [i.slot, i.id, i.owned, i.alternatives])).toEqual([
            [0, ALT_HOOD, true, [HOOD]], // done with the alternative, shown as worn
            [10, RING, true, []],
            [11, RING, false, []], // one ring worn closes one slot only
        ]);
        expect(manualBisForSpec(index, specByKey("Druid-Balance"))).toMatchObject({ items: [], source: "" });
    });

    it("finds items of the lists by name or id", () => {
        fillLists();
        const index = manualIndex("forever");
        expect(searchManualItems(index, "kapu").map((i) => i.id)).toEqual([HOOD, ALT_HOOD]);
        expect(searchManualItems(index, "andere").map((i) => i.id)).toEqual([ALT_HOOD]);
        expect(searchManualItems(index, String(CLOAK)).map((i) => i.id)).toEqual([CLOAK]);
        expect(searchManualItems(index, "")).toEqual([]);
    });
});

describe("councilRoster on hand lists", () => {
    it("Forever measures against the hand list: BiS 2 von 3, worn pieces marked, nothing from the TBC table", () => {
        fillLists();
        const { rows, bisTier } = councilRoster({ versionId: "forever" });
        expect(bisTier).toBe("");
        const row = rows[0];
        expect(row.bis).toMatchObject({ source: "manual", sourceLabel: "Eigene Liste", total: 3, owned: 2 });
        expect(row.simSupported).toBe(false);
        expect(row.gear.items.map((i) => [i.itemId, i.isBis, i.bisSpecs.map((s) => s.specKey)])).toEqual([
            [ALT_HOOD, true, ["Priest-Shadow"]],
            [RING, true, ["Priest-Shadow"]],
        ]);
        expect(row.gear.items[0].stats).toEqual({});
        // the BiS gap now counts in the need part
        expect(row.needParts.need).toBeGreaterThan(0);
    });

    it("without any hand list Forever stays as before: an empty list", () => {
        const row = councilRoster({ versionId: "forever" }).rows[0];
        expect(row.bis).toEqual(expect.objectContaining({ total: 0, owned: 0, items: [], source: "" }));
        expect(row.gear.items[0].bisSpecs).toEqual([]);
    });

    it("switched off, the hand lists are not read", () => {
        fillLists();
        const config = { versionSettings: { forever: { wowheadPath: "forever", disabled: ["lootCouncilBis"] } } };
        expect(councilRoster({ versionId: "forever", config }).rows[0].bis.total).toBe(0);
    });

    it("TBC never reads the hand lists", () => {
        fillLists();
        manualBisStore.setSlot("tbc", "Priest-Shadow", 0, [{ id: HOOD }]);
        const row = councilRoster({ versionId: "tbc" }).rows[0];
        expect(row.bis.source).not.toBe("manual");
        expect(row.bis.items.some((i) => i.id === HOOD)).toBe(false);
    });

    it("drop candidates and open items: whose list names it and still misses it, by need", () => {
        fillLists();
        const { rows } = councilRoster({ versionId: "forever" });
        const ring = manualCandidateSplit(RING, rows);
        expect(ring.candidates.map((c) => [c.key, c.slot, c.isBis, c.simSupported, c.value])).toEqual([["devihra", 11, true, false, 0]]);
        expect(ring.candidates[0].replaces).toBeNull();
        expect(ring.unwearable).toEqual([]);
        // the hood slot is done (alternative worn): owned, not a candidate
        expect(manualCandidateSplit(HOOD, rows)).toMatchObject({ candidates: [], owned: [expect.objectContaining({ key: "devihra", source: "worn" })] });
        // nobody's list: nobody
        expect(manualCandidateSplit(CLOAK, rows).candidates).toEqual([]);
        const gaps = manualBisGaps(rows);
        expect(gaps.map((g) => [g.id, g.wantedBy.map((w) => [w.key, w.missing])])).toEqual([[RING, [["devihra", 1]]]]);
        expect(gaps[0].best.key).toBe("devihra");
    });

    it("counts copies: one ring worn and awarded leaves the second ring slot open", () => {
        fillLists();
        // the worn ring (slot 10) was won here - that award is the worn copy, not a second one
        mockListAll.mockReturnValue([lootRow({ itemId: RING, itemName: "Ring" })]);
        const split = manualCandidateSplit(RING, councilRoster({ versionId: "forever" }).rows);
        expect(split.candidates.map((c) => [c.key, c.slot])).toEqual([["devihra", 11]]);
        expect(split.owned).toEqual([]);
    });

    it("a second awarded copy not yet in a log counts as owned", () => {
        fillLists();
        mockListAll.mockReturnValue([lootRow({ itemId: RING, itemName: "Ring" }), lootRow({ itemId: RING, itemName: "Ring", awardedAt: Date.now() - 1000 })]);
        const split = manualCandidateSplit(RING, councilRoster({ versionId: "forever" }).rows);
        expect(split.candidates).toEqual([]);
        expect(split.owned).toEqual([expect.objectContaining({ key: "devihra", source: "awarded" })]);
    });

    it("an awarded copy with nothing of it worn fills the open slot", () => {
        fillLists();
        mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([item(0, ALT_HOOD), item(10, 1234)])]]));
        mockListAll.mockReturnValue([lootRow({ itemId: RING, itemName: "Ring" }), lootRow({ itemId: RING, itemName: "Ring" })]);
        const split = manualCandidateSplit(RING, councilRoster({ versionId: "forever" }).rows);
        expect(split.owned).toEqual([expect.objectContaining({ source: "awarded" })]);
        mockListAll.mockReturnValue([lootRow({ itemId: RING, itemName: "Ring" })]);
        expect(manualCandidateSplit(RING, councilRoster({ versionId: "forever" }).rows).candidates).toHaveLength(1);
    });
});
