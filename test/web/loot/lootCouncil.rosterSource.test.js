// A category with a roster (#667): the roster is the council's candidate list.
// Stamm and Probe are candidates, Ersatz only with showBench, Pause never;
// members appear without loot and gear; Forever keys match; stand-ins fold
// under "Nicht im Roster"; a member whose spec the council does not know is
// counted. Every data source is mocked; lootCouncil.js runs for real.
const mockListAll = jest.fn(() => []);
const mockAnnotated = jest.fn(() => []);
const mockGearByCharacter = jest.fn(() => new Map());
const mockCharacterMap = jest.fn(() => ({}));
const mockExcludedKeys = jest.fn(() => new Set());
const mockRosterForCategory = jest.fn(() => null);
const mockListProfiles = jest.fn(() => []);

jest.mock("../../../src/stores/lootStore", () => ({ listAll: (...a) => mockListAll(...a) }));
jest.mock("../../../src/services/characters/characterInfo", () => ({ annotatedCharacters: (...a) => mockAnnotated(...a) }));
jest.mock("../../../src/services/loot/charGear", () => ({ gearByCharacter: (...a) => mockGearByCharacter(...a) }));
jest.mock("../../../src/stores/characterStore", () => ({ characterMap: (...a) => mockCharacterMap(...a) }));
jest.mock("../../../src/stores/raiderCharactersStore", () => ({ getCategoryAssignments: () => ({}) }));
jest.mock("../../../src/stores/councilStore", () => ({
    excludedKeys: (...a) => mockExcludedKeys(...a),
    plannedRoles: () => new Map(),
}));
jest.mock("../../../src/stores/rosterStore", () => ({ rosterForCategory: (...a) => mockRosterForCategory(...a) }));
jest.mock("../../../src/stores/raiderProfileStore", () => ({ listProfiles: (...a) => mockListProfiles(...a) }));
jest.mock("../../../src/stores/raidEventStore", () => ({ listRaidEvents: () => [] }));
jest.mock("../../../src/stores/eventStore", () => ({
    listEvents: () => [], getEvent: () => null, isOwnEventId: (id) => String(id || "").startsWith("eh-"),
}));
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: () => [] }));
jest.mock("../../../src/stores/logStore", () => ({ listLogs: () => [] }));
jest.mock("../../../src/stores/reportStore", () => ({ listReports: () => [], getReport: () => null, getReportRoster: () => null }));

const { councilRoster } = require("../../../src/web/loot/lootCouncil");
const { councilSyncPayloadV2 } = require("../../../src/web/loot/councilSync");
const { now, DAY, lootRow, gearOf, item } = require("../../helpers/lootCouncil");

/** A roster of category "cat-mo" with these members ({ userId: { status, chars, charNames } }). */
function roster(members, over = {}) {
    return { id: "r-mo", name: "Montag", categoryId: "cat-mo", versionId: "tbc", allowMultipleChars: false, members, ...over };
}
const member = (status, chars, charNames = {}) => ({ status, chars, charNames });

beforeEach(() => {
    jest.clearAllMocks();
    mockListAll.mockReturnValue([]);
    mockAnnotated.mockReturnValue([]);
    mockGearByCharacter.mockReturnValue(new Map());
    mockCharacterMap.mockReturnValue({});
    mockExcludedKeys.mockReturnValue(new Set());
    mockRosterForCategory.mockReturnValue(null);
    mockListProfiles.mockReturnValue([]);
});

describe("lootCouncil with a roster (#667)", () => {
    it("without a roster everything stays as before - no status, no roster fields", () => {
        mockListAll.mockReturnValue([lootRow({ characterKey: "aktiv", character: "Aktiv" })]);
        mockAnnotated.mockReturnValue([{ key: "aktiv", className: "Mage", spec: "Arcane" }]);
        const built = councilRoster({ categoryId: "cat-mo" });
        expect(built.rows.map((r) => r.character)).toEqual(["Aktiv"]);
        expect(built.rows[0]).not.toHaveProperty("status");
        expect(built).not.toHaveProperty("rosterSource");
        expect(built).not.toHaveProperty("outsiders");
        expect(built.skipped).toEqual({ category: 0, excluded: 0, version: 0 });
    });

    it("takes Stamm and Probe as candidates; Ersatz only with showBench; Pause never", () => {
        mockRosterForCategory.mockReturnValue(roster({
            1001: member("core", ["stamm"], { stamm: "Stamm" }),
            1002: member("trial", ["probe"], { probe: "Probe" }),
            1003: member("bench", ["ersatz"], { ersatz: "Ersatz" }),
            1004: member("pause", ["pausiert"], { pausiert: "Pausiert" }),
        }));
        mockAnnotated.mockReturnValue(["stamm", "probe", "ersatz", "pausiert"].map((key) => ({ key, className: "Mage", spec: "Arcane" })));

        const built = councilRoster({ categoryId: "cat-mo" });
        expect(built.rows.map((r) => r.key).sort()).toEqual(["probe", "stamm"]);
        expect(built.rows.find((r) => r.key === "probe").status).toBe("trial");
        expect(built.rows.find((r) => r.key === "stamm").status).toBe("core");
        expect(built.skipped).toMatchObject({ bench: 1, paused: 1, category: 0 });
        expect(built.rosterSource).toMatchObject({ id: "r-mo", name: "Montag", counts: { core: 1, trial: 1, bench: 1, pause: 1 }, showBench: false });

        const withBench = councilRoster({ categoryId: "cat-mo", showBench: true });
        expect(withBench.rows.map((r) => r.key).sort()).toEqual(["ersatz", "probe", "stamm"]);
        expect(withBench.rows.find((r) => r.key === "ersatz").status).toBe("bench");
        expect(withBench.skipped).toMatchObject({ bench: 0, paused: 1 });
        expect(withBench.rosterSource.showBench).toBe(true);
    });

    it("lists a member with neither loot nor gear: 0 items and the longest wait", () => {
        mockRosterForCategory.mockReturnValue(roster({ 1001: member("core", ["neuling"], { neuling: "Neuling-Thunderstrike" }) }));
        // Known only from the raider profile: class and spec.
        mockListProfiles.mockReturnValue([{
            userId: "1001",
            characters: [{ key: "neuling", name: "Neuling", className: "Priest", specs: [{ key: "Priest-Holy" }, { key: "Priest-Shadow" }] }],
        }]);
        mockListAll.mockReturnValue([lootRow({ characterKey: "outsider", character: "Outsider", awardedAt: now - 2 * DAY })]);
        mockAnnotated.mockReturnValue([{ key: "outsider", className: "Mage", spec: "Arcane" }]);

        const { rows } = councilRoster({ categoryId: "cat-mo", role: "caster" });
        expect(rows.map((r) => r.character)).toEqual(["Neuling"]);
        const row = rows[0];
        // The caster council takes the profile's caster spec, not its first one.
        expect(row).toMatchObject({ specKey: "Priest-Shadow", spec: "Shadow", lootCount: 0, daysSinceLoot: null, lastAwardAt: 0, gear: null });
        expect(row.needParts.drought).toBe(1);
        expect(row.needScore).toBeGreaterThan(0.5);

        // The healer council takes the healing spec.
        expect(councilRoster({ categoryId: "cat-mo", role: "healer" }).rows[0].specKey).toBe("Priest-Holy");
    });

    it("picks the profile spec of the new roles too (#669)", () => {
        mockRosterForCategory.mockReturnValue(roster({
            1001: member("core", ["klinge"], { klinge: "Klinge" }),
            1002: member("core", ["pfote"], { pfote: "Pfote" }),
        }));
        mockListProfiles.mockReturnValue([
            { userId: "1001", characters: [{ key: "klinge", name: "Klinge", className: "Warrior", specs: [{ key: "Warrior-Fury" }, { key: "Warrior-Protection" }] }] },
            { userId: "1002", characters: [{ key: "pfote", name: "Pfote", className: "Druid", specs: [{ key: "Druid-Feral" }, { key: "Druid-Guardian" }] }] },
        ]);
        const specs = (role) => Object.fromEntries(councilRoster({ categoryId: "cat-mo", role }).rows.map((r) => [r.key, r.specKey]));
        expect(specs("tank")).toEqual({ klinge: "Warrior-Protection", pfote: "Druid-Guardian" });
        expect(specs("melee")).toEqual({ klinge: "Warrior-Fury", pfote: "Druid-Feral" });
        expect(councilRoster({ categoryId: "cat-mo", role: "tank" }).rosterSource.noSpec).toEqual([]);
    });

    it("matches a Forever character's key against loot and gear keyed by its bare name", () => {
        mockRosterForCategory.mockReturnValue(roster({ 1001: member("core", ["forever~devi res"], { "forever~devi res": "Devi Res" }) }, { versionId: "forever" }));
        mockListAll.mockReturnValue([lootRow({ characterKey: "devi res", character: "Devi Res", awardedAt: now - 4 * DAY })]);
        mockGearByCharacter.mockReturnValue(new Map([["devi res", gearOf([item(0, 31064)], { key: "devi res", character: "Devi Res", className: "Priest" })]]));
        mockAnnotated.mockReturnValue([{ key: "devi res", className: "Priest", spec: "Shadow" }]);

        const built = councilRoster({ categoryId: "cat-mo" });
        expect(built.rows).toHaveLength(1);
        expect(built.rows[0]).toMatchObject({ key: "devi res", character: "Devi Res", lootCount: 1, daysSinceLoot: 4 });
        expect(built.rows[0].gear.itemCount).toBe(1);
        // A roster member's version is the roster's.
        expect(built.versions.map((v) => v.id)).toContain("forever");
        expect(councilRoster({ categoryId: "cat-mo", charVersion: "tbc" }).skipped.version).toBe(1);
    });

    it("counts every assigned character with allowMultipleChars", () => {
        mockRosterForCategory.mockReturnValue(roster({ 1001: member("core", ["main", "twink"]) }, { allowMultipleChars: true }));
        mockAnnotated.mockReturnValue([
            { key: "main", character: "Main", className: "Warlock", spec: "Destruction" },
            { key: "twink", character: "Twink", className: "Mage", spec: "Fire" },
        ]);
        expect(councilRoster({ categoryId: "cat-mo" }).rows.map((r) => r.key).sort()).toEqual(["main", "twink"]);
    });

    it("folds stand-ins from the category's loot under outsiders - unranked and not for the addon", () => {
        mockRosterForCategory.mockReturnValue(roster({ 1001: member("core", ["stamm"]), 1002: member("pause", ["pausiert"]) }));
        mockListAll.mockReturnValue([
            lootRow({ characterKey: "stamm", character: "Stamm", awardedAt: now - 1 * DAY }),
            lootRow({ characterKey: "aushilfe", character: "Aushilfe", awardedAt: now - 3 * DAY }),
            lootRow({ characterKey: "aushilfe", character: "Aushilfe", itemId: 30000, awardedAt: now - 5 * DAY }),
            // paused is in the roster, so never a stand-in
            lootRow({ characterKey: "pausiert", character: "Pausiert" }),
            // another category's raider is no stand-in here
            lootRow({ characterKey: "anderer", character: "Anderer", categoryId: "cat-do" }),
        ]);
        mockAnnotated.mockReturnValue(["stamm", "aushilfe", "pausiert", "anderer"].map((key) => ({ key, className: "Mage", spec: "Arcane" })));

        const built = councilRoster({ categoryId: "cat-mo" });
        expect(built.rows.map((r) => r.key)).toEqual(["stamm"]);
        expect(built.outsiders.map((r) => r.key)).toEqual(["aushilfe"]);
        expect(built.outsiders[0]).toMatchObject({ lootCount: 2, status: "" });
        expect(built.outsiders[0]).not.toHaveProperty("needScore");
        // The share part is measured against the ranked field only.
        expect(built.avgLootCount).toBe(1);

        const payload = councilSyncPayloadV2([{ id: "cat-mo", name: "Montag", opts: { role: "" }, built }], { now });
        expect(payload.version).toBe(2);
        expect(payload.categories[0].raiders.map((r) => r.key)).toEqual(["stamm"]);
        // The addon format stays as it is: no status field yet (#670).
        expect(payload.categories[0].raiders[0]).not.toHaveProperty("status");
    });

    it("leaves a set-aside member out and counts them, also as no stand-in", () => {
        mockRosterForCategory.mockReturnValue(roster({ 1001: member("core", ["stamm"]), 1002: member("core", ["weg"]) }));
        mockListAll.mockReturnValue([lootRow({ characterKey: "gone", character: "Gone" })]);
        mockAnnotated.mockReturnValue(["stamm", "weg", "gone"].map((key) => ({ key, className: "Mage", spec: "Arcane" })));
        mockExcludedKeys.mockReturnValue(new Set(["weg", "gone"]));
        const built = councilRoster({ categoryId: "cat-mo" });
        expect(built.rows.map((r) => r.key)).toEqual(["stamm"]);
        expect(built.skipped.excluded).toBe(1);
        expect(built.outsiders).toEqual([]);
    });

    it("names the members whose spec the council does not know instead of dropping them silently", () => {
        mockRosterForCategory.mockReturnValue(roster({
            1001: member("core", ["krieger"], { krieger: "Krieger" }),
            1002: member("trial", ["priester"], { priester: "Priester" }),
            1003: member("core", ["heiler"], { heiler: "Heiler" }),
            1004: member("core", ["unbekannt"], { unbekannt: "Unbekannt" }),
        }));
        mockAnnotated.mockReturnValue([
            { key: "krieger", className: "Warrior", spec: "Fury" },
            // a priest without a spec could be shadow or holy: not guessed
            { key: "priester", className: "Priest", spec: "" },
            { key: "heiler", className: "Priest", spec: "Holy" },
        ]);
        const built = councilRoster({ categoryId: "cat-mo", role: "caster" });
        expect(built.rows).toEqual([]);
        expect(councilRoster({ categoryId: "cat-mo", role: "melee" }).rows.map((r) => r.key)).toEqual(["krieger"]);
        // The holy priest and the fury warrior (melee since #669) are left out
        // by the role filter, which is not "unknown".
        expect(built.rosterSource.noSpec).toEqual([
            { key: "priester", character: "Priester", className: "Priest", status: "trial" },
            { key: "unbekannt", character: "Unbekannt", className: "", status: "core" },
        ]);
    });
});
