// The candidates for one item and the BiS gaps: who is listed, in which order,
// with which loot history, and who cannot wear the item at all.
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
// The own events (#254) reach the council through the real adapter (eventSources.js).
const mockOwnEvents = jest.fn(() => []);
jest.mock("../../src/web/eventStore", () => ({
    listEvents: (...a) => mockOwnEvents(...a), getEvent: () => null, isOwnEventId: (id) => String(id || "").startsWith("eh-"),
}));
jest.mock("../../src/web/signupStore", () => ({ listSignups: () => [] }));
jest.mock("../../src/web/logStore", () => ({ listLogs: (...a) => mockLogs(...a) }));
jest.mock("../../src/web/reportStore", () => ({
    listReports: (...a) => mockListReports(...a),
    getReport: (...a) => mockGetReport(...a),
}));

const {
    councilRoster, bisGaps,
    _internal: {
        candidatesForItem, NON_BIS_WEIGHT,
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

describe("web/lootCouncil", () => {
    describe("candidatesForItem", () => {
        // 32525 (Cowl of the Illidari High Lord) is a cloth head without a
        // class lock — the one kind of item both a priest and a mage can take.
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
            const candidates = candidatesForItem(32525, rows);
            expect(candidates.length).toBe(2);
            expect(candidates[0].value).toBeGreaterThanOrEqual(candidates[1].value);
        });

        it("says what the item would replace, or that the slot is free", () => {
            const rows = twoCasters();
            const byChar = Object.fromEntries(candidatesForItem(32525, rows).map((c) => [c.character, c]));
            expect(byChar.Devihra.replaces).toMatchObject({ itemId: 29352 });
            expect(byChar.Magier.replaces).toBeNull();
        });

        it("marks a candidate for whom the item is BiS", () => {
            const bisId = wowsims.bisFor("Priest-Shadow", "t6").items[0].id;
            mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
            mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([])]]));
            const rows = councilRoster({ bisTier: "t6" }).rows;
            const c = candidatesForItem(bisId, rows)[0];
            expect(c.isBis).toBe(true);
            expect(c.bisWeight).toBe(1);
            expect(c.itemNeedScore).toBe(c.needScore);
        });

        it("weighs a candidate the item is not BiS for at half, in the need and in the ordering", () => {
            expect(NON_BIS_WEIGHT).toBe(0.5);
            const rows = twoCasters();
            const candidates = candidatesForItem(32525, rows);
            for (const c of candidates.filter((x) => !x.isBis)) {
                expect(c.bisWeight).toBe(0.5);
                expect(c.itemNeedScore).toBeCloseTo(c.needScore / 2, 3);
            }
            // the ordering follows the weighted value, so a BiS candidate with
            // half the raw gain still comes first
            for (let i = 1; i < candidates.length; i++) {
                expect(candidates[i - 1].value * candidates[i - 1].bisWeight).toBeGreaterThanOrEqual(candidates[i].value * candidates[i].bisWeight);
            }
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
            candidatesForItem(32525, rows);
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
            const byChar = Object.fromEntries(candidatesForItem(32525, rows).map((c) => [c.character, c]));
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

        // Building the gear map reads every stored evaluation from disk, so
        // asking for it per gap is what made this tab take minutes on a real
        // guild's data.
        it("reads the roster's gear once, not once per gap", () => {
            mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
            mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([])]]));
            const rows = councilRoster({ bisTier: "t6" }).rows;
            mockGearByCharacter.mockClear();
            const gaps = bisGaps(rows);
            expect(gaps.length).toBeGreaterThan(10);
            expect(mockGearByCharacter).toHaveBeenCalledTimes(1);
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

// Ein Raider, der ein Teil nicht anlegen kann, ist kein Kandidat — ein
// Hexer-Helm ist für den Magier kein „Downgrade", er gehört ihm schlicht
// nicht. Dass er fehlt, wird gesagt, sonst sieht die kürzere Liste kaputt aus.
describe("web/lootCouncil — wer das Item überhaupt tragen kann", () => {
    const { candidateSplit } = require("../../src/web/lootCouncil");
    const CORRUPTOR_HOOD = 30212;   // Hexenmeister-T5
    const SKYSHATTER_COVER = 31015; // Schamanen-T6, Kette
    const ZHARDOOM = 32374;         // Zweihandstab — für alle Caster

    function mixedRoster() {
        mockAnnotated.mockReturnValue([
            { key: "devihra", className: "Priest", spec: "Shadow" },
            { key: "magier", className: "Mage", spec: "Arcane" },
            { key: "hexer", className: "Warlock", spec: "Destruction" },
            { key: "schami", className: "Shaman", spec: "Elemental" },
        ]);
        const gear = (key, character, className) => gearOf([item(0, 31064), item(15, 30082)], { key, character, className });
        mockGearByCharacter.mockReturnValue(new Map([
            ["devihra", gear("devihra", "Devihra", "Priest")],
            ["magier", gear("magier", "Magier", "Mage")],
            ["hexer", gear("hexer", "Hexer", "Warlock")],
            ["schami", gear("schami", "Schami", "Shaman")],
        ]));
        return councilRoster({ bisTier: "t6" }).rows;
    }

    it("gibt ein Setteil nur seiner Klasse", () => {
        const { candidates, unwearable } = candidateSplit(CORRUPTOR_HOOD, mixedRoster());
        expect(candidates.map((c) => c.key)).toEqual(["hexer"]);
        expect(unwearable.map((u) => u.key).sort()).toEqual(["devihra", "magier", "schami"]);
        const mage = unwearable.find((u) => u.key === "magier");
        expect(mage).toMatchObject({ character: "Magier", reason: "class" });
        expect(mage.note).toContain("Hexenmeister");
    });

    it("gibt eine Kettenbrust keiner Stoffklasse", () => {
        const { candidates, unwearable } = candidateSplit(SKYSHATTER_COVER, mixedRoster());
        expect(candidates.map((c) => c.key)).toEqual(["schami"]);
        expect(unwearable).toHaveLength(3);
    });

    it("lässt jeden Caster für einen Stab antreten", () => {
        const { candidates, unwearable } = candidateSplit(ZHARDOOM, mixedRoster());
        expect(candidates).toHaveLength(4);
        expect(unwearable).toEqual([]);
    });

    it("trägt das volle Gear des Roster-Eintrags mit — der Drop-Check zeigt es ohne den Raider-Dialog zu öffnen", () => {
        const roster = mixedRoster();
        const { candidates } = candidateSplit(ZHARDOOM, roster);
        const hexer = candidates.find((c) => c.key === "hexer");
        const row = roster.find((r) => r.key === "hexer");
        expect(hexer.gear).toBe(row.gear);
        expect(hexer.gear.items.map((i) => i.itemId).sort()).toEqual(row.gear.items.map((i) => i.itemId).sort());
    });

    it("trägt die Identität für die Seite mit, nicht nur den Schlüssel", () => {
        const { unwearable } = candidateSplit(CORRUPTOR_HOOD, mixedRoster());
        expect(unwearable[0]).toEqual(expect.objectContaining({
            key: expect.any(String), character: expect.any(String), specLabel: expect.any(String),
            classColor: expect.any(String), reason: expect.any(String), note: expect.any(String),
        }));
    });

    it("hält candidatesForItem als reine Kandidatenliste bei", () => {
        expect(candidatesForItem(CORRUPTOR_HOOD, mixedRoster()).map((c) => c.key)).toEqual(["hexer"]);
    });

    it("nimmt sie damit auch aus den BiS-Lücken", () => {
        // Der Hexer-Helm steht auf der Hexer-Liste; der Magier fehlt ihn nicht
        // und darf ihn nicht bekommen — er taucht nirgends als Kandidat auf.
        const gaps = bisGaps(mixedRoster());
        const hood = gaps.find((g) => g.id === CORRUPTOR_HOOD);
        if (hood) expect(hood.candidates.every((c) => c.key === "hexer")).toBe(true);
        for (const gap of gaps) {
            for (const c of gap.candidates) {
                expect(require("../../src/config/wearable").canWear(c.key === "magier" ? "Mage" : c.key === "hexer" ? "Warlock" : c.key === "schami" ? "Shaman" : "Priest", gap.id)).toBe(true);
            }
        }
    });
});
