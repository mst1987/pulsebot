// Judging a caster on caster gear: the role-matched gear set, the planned role
// the council set, the armory link and the gear verdict passed to the page.
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

const { councilRoster } = require("../../src/web/lootCouncil");
const { gearOf, item } = require("../helpers/lootCouncil");

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

    it("sagt, warum die Armory-Antwort nicht genommen wurde, und ob das Set PvP ist", () => {
        mockAnnotated.mockReturnValue([{ key: "devihra", className: "Priest", spec: "Shadow" }]);
        mockGearByCharacter.mockReturnValue(new Map([["devihra", gearOf([item(0, 31064)], {
            armoryRejected: "pvp", pvpGear: false,
        })]]));
        expect(councilRoster({}).rows[0].gear).toMatchObject({ armoryRejected: "pvp", pvpGear: false });
    });
});
