// Golden master of lootCouncil.councilRoster (#424): the roster was split into
// loading (roles, loot per character), one row per raider (spec, BiS, gear,
// items) and the need score. The payload for a council that walks every branch
// — loot that counts and loot that does not, a planned role, an excluded
// raider, a raider known only from a log, a full gear record, the category
// filter — must stay exactly what it was before the split.
//
// Regenerate test/fixtures/lootCouncil/councilRosterGolden.json only for a
// change of behaviour that is meant: GOLDEN_WRITE=1 npx jest lootCouncilGolden
const fs = require("fs");
const path = require("path");

const mockListAll = jest.fn(() => []);
const mockAnnotated = jest.fn(() => []);
const mockGearByCharacter = jest.fn(() => new Map());
const mockCharacterMap = jest.fn(() => ({}));
const mockAssignments = jest.fn(() => ({}));
const mockExcludedKeys = jest.fn(() => new Set());
const mockPlannedRoles = jest.fn(() => new Map());

jest.mock("../../../src/stores/lootStore", () => ({ listAll: (...a) => mockListAll(...a) }));
jest.mock("../../../src/services/characters/characterInfo", () => ({ annotatedCharacters: (...a) => mockAnnotated(...a) }));
jest.mock("../../../src/services/loot/charGear", () => ({ gearByCharacter: (...a) => mockGearByCharacter(...a) }));
jest.mock("../../../src/stores/characterStore", () => ({ characterMap: (...a) => mockCharacterMap(...a) }));
jest.mock("../../../src/stores/raiderCharactersStore", () => ({ getCategoryAssignments: (...a) => mockAssignments(...a) }));
jest.mock("../../../src/stores/councilStore", () => ({
    excludedKeys: (...a) => mockExcludedKeys(...a),
    plannedRoles: (...a) => mockPlannedRoles(...a),
}));
jest.mock("../../../src/stores/raidEventStore", () => ({ listRaidEvents: () => [] }));
jest.mock("../../../src/stores/eventStore", () => ({ listEvents: () => [], getEvent: () => null, isOwnEventId: () => false }));
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: () => [] }));
jest.mock("../../../src/stores/logStore", () => ({ listLogs: () => [] }));
jest.mock("../../../src/stores/reportStore", () => ({ listReports: () => [], getReport: () => null }));

const { councilRoster } = require("../../../src/web/loot/lootCouncil");
const wowsims = require("../../../src/config/wowsims");

const GOLDEN = path.join(__dirname, "..", "..", "fixtures", "lootCouncil", "councilRosterGolden.json");
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 20, 12);

const lootRow = (over = {}) => ({
    characterKey: "devihra", character: "Devihra", itemId: 31064, itemName: "Hood of Absolution",
    itemIconUrl: "icon.jpg", itemQuality: 4, contentId: "bt", boss: "Illidan", categoryId: "cat-mo",
    reason: "mainspec", reasonLabel: "Mainspec", reasonTone: "mainspec",
    awardedAt: NOW - 3 * DAY, eventLabel: "Montagsraid", ...over,
});
const item = (slot, itemId, over = {}) => ({ slot, itemId, itemLevel: 141, gems: [], enchantId: 0, itemName: `Item ${itemId}`, ...over });

function scenario() {
    const bis = wowsims.bisFor("Priest-Shadow", "t6").items;
    mockListAll.mockReturnValue([
        lootRow(),
        lootRow({ itemName: "", itemQuality: undefined, boss: "", reasonLabel: "", reasonTone: "", eventLabel: "", awardedAt: NOW - 10 * DAY }),
        lootRow({ reason: "offspec", awardedAt: NOW - DAY }),              // does not count, tallied as `other`
        lootRow({ contentId: "kara", awardedAt: NOW - 40 * DAY }),        // outside a tier filter
        lootRow({ categoryId: "cat-do", awardedAt: NOW - 5 * DAY }),      // another raid
        lootRow({ characterKey: "", character: "Niemand" }),              // no key: skipped
        lootRow({ characterKey: "hauer", character: "Hauer" }),           // a warrior: not on the council
        lootRow({ characterKey: "satt", character: "Satt", awardedAt: NOW - DAY }),
        lootRow({ characterKey: "heala", character: "Heala", categoryId: "cat-do", awardedAt: 0 }),
        lootRow({ characterKey: "magier", character: "Magier", reason: "", awardedAt: NOW - 2 * DAY }),
        lootRow({ characterKey: "fremd", character: "Fremd", reason: "shard" }),
    ]);
    mockAnnotated.mockReturnValue([
        { key: "devihra", className: "Priest", spec: "Shadow" },
        { key: "hauer", className: "Warrior", spec: "Fury" },
        { key: "satt", className: "Mage", spec: "Arcane" },
        { key: "heala", className: "Priest", spec: "Holy" },
        { key: "magier", className: "Mage", spec: "" },
    ]);
    mockCharacterMap.mockReturnValue({
        neu: { className: "Warlock", spec: "Affliction" },
        druide: { className: "Druid", spec: "Restoration" },
        fremd: { className: "Paladin", spec: "Holy" },
    });
    mockGearByCharacter.mockReturnValue(new Map([
        ["devihra", {
            key: "devihra", character: "Devihra", className: "Priest", seenAt: NOW - DAY, reportId: "r1", reportTitle: "BT Montag",
            items: [item(0, bis[0].id), item(4, bis[1].id, { situational: true }), item(5, 99999, { replacedSituational: true }), item(10, bis[0].id)],
            profile: { role: "caster", confident: true }, skippedReports: 2, roleMismatch: true,
            source: "armory", armoryAt: NOW - 2 * DAY, wclAt: NOW - 3 * DAY, logRejected: "old", unverifiedEnchants: 1, armoryRejected: "pvp", pvpGear: true,
            dropped: [{ slot: 12, slotName: "Trinket", itemId: 28789, itemName: "Eye of Magtheridon", iconUrl: "eye.jpg", note: "boss-specific", extra: "not shown" }],
        }],
        ["neu", { key: "neu", character: "Neu", className: "Warlock", seenAt: NOW - 4 * DAY, reportId: "r2", reportTitle: "BT Donnerstag", items: [item(0, 31064)] }],
        ["heala", { key: "heala", character: "Heala", className: "Priest", seenAt: NOW - DAY, reportId: "r1", reportTitle: "BT Montag", items: [item(0, 31064)], profile: { role: "healer", confident: false } }],
        ["unbekannt", { key: "unbekannt", character: "", className: "", seenAt: 0, items: [] }],
    ]));
    mockExcludedKeys.mockReturnValue(new Set(["satt"]));
    mockPlannedRoles.mockReturnValue(new Map([["heala", "caster"], ["druide", "caster"]]));
    mockAssignments.mockReturnValue({ "user-1": "Neu" });
}

const CASES = {
    all: {},
    casters: { role: "caster" },
    healers: { role: "healer" },
    monday: { categoryId: "cat-mo" },
    t6: { tierIds: ["t6"], bisTier: "t6" },
    mondayT6: { categoryId: "cat-mo", tierIds: ["t6"], contentIds: ["kara"], bisTier: "t5" },
};

describe("lootCouncil.councilRoster golden master", () => {
    let nowSpy;
    beforeEach(() => {
        jest.clearAllMocks();
        nowSpy = jest.spyOn(Date, "now").mockReturnValue(NOW);
        scenario();
    });
    afterEach(() => nowSpy.mockRestore());

    it("builds the same roster for every filter as before the split", () => {
        const actual = Object.fromEntries(Object.entries(CASES).map(([name, opts]) => [name, councilRoster(opts)]));
        if (process.env.GOLDEN_WRITE) {
            fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
            fs.writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + "\n");
        }
        expect(actual).toEqual(JSON.parse(fs.readFileSync(GOLDEN, "utf8")));
    });
});
