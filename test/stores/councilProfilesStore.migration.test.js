// The migration into Loot-Council profiles (#676) is a golden master: the
// council must compute exactly the same numbers after it as before. Before:
// councilRoster() with the weighting #668 resolved (councilWeightsStore
// weightsFor(category) - the old line in lootCouncil.js) and the stored
// category view (councilStore viewFor). After: councilRoster() resolving the
// profile on its own (services/loot/councilProfiles.js).
//
// Four categories cover every case: cA own weighting + roster, cB only a view
// and no roster, cC a roster and nothing of its own, cD weighting + view
// without roster - plus "all categories".
const mockListAll = jest.fn(() => []);
const mockAnnotated = jest.fn(() => []);

jest.mock("../../src/stores/lootStore", () => ({ listAll: (...a) => mockListAll(...a) }));
jest.mock("../../src/services/characters/characterInfo", () => ({ annotatedCharacters: (...a) => mockAnnotated(...a) }));
jest.mock("../../src/services/loot/charGear", () => ({ gearByCharacter: () => new Map() }));
jest.mock("../../src/stores/characterStore", () => ({ characterMap: () => ({}) }));
jest.mock("../../src/stores/raiderCharactersStore", () => ({ getCategoryAssignments: () => ({}), readLegacyAssignments: () => ({}) }));
jest.mock("../../src/stores/raidEventStore", () => ({ listRaidEvents: () => [{ id: "e1", categoryId: "cD", categoryName: "Donnerstag PuG", startTime: 5 }] }));
jest.mock("../../src/stores/eventStore", () => ({ listEvents: () => [], getEvent: () => null, isOwnEventId: () => false }));
jest.mock("../../src/stores/signupStore", () => ({ listSignups: () => [] }));
jest.mock("../../src/stores/logStore", () => ({ listLogs: () => [] }));
jest.mock("../../src/stores/reportStore", () => ({ listReports: () => [], getReport: () => null, getReportRoster: () => null }));

const fs = require("fs");
const path = require("path");
const { settingsPath } = require("../../src/config/paths");
const councilWeights = require("../../src/stores/councilWeightsStore");
const councilStore = require("../../src/stores/councilStore");
const councilProfilesStore = require("../../src/stores/councilProfilesStore");
const rosterStore = require("../../src/stores/rosterStore");
const councilProfiles = require("../../src/services/loot/councilProfiles");
const { migrateCouncilProfiles } = require("../../src/stores/settingsMigration");
const { councilRoster } = require("../../src/web/loot/lootCouncil");
const { tempStoreFile } = require("../helpers/tempStore");
const { DAY, now, lootRow } = require("../helpers/lootCouncil");

const TRINKET = 28789;
const SET = 31064;
const CATS = ["cA", "cB", "cC", "cD", ""];

beforeAll(() => {
    councilWeights.useFile(tempStoreFile("council-weights.json"));
    rosterStore.useFile(tempStoreFile("rosters.json"));
});
afterAll(() => {
    councilWeights.useFile(null);
    rosterStore.useFile(null);
    councilProfilesStore.useFile(null);
});

let rA;
let rC;
beforeEach(() => {
    councilProfilesStore.useFile(tempStoreFile("council-profiles.json"));
    councilStore.reset();
    councilWeights.resetWeights("");
    for (const id of ["cA", "cD"]) councilWeights.resetWeights(id);
    for (const r of rosterStore.listRosters("")) rosterStore.deleteRoster(r.id);
    fs.mkdirSync(path.dirname(settingsPath("category-names.json")), { recursive: true });
    fs.writeFileSync(settingsPath("category-names.json"), JSON.stringify({ guilds: { g1: { cA: "Mittwoch", cB: "Sonntag", cC: "Montag" } } }));

    councilWeights.setWeights("", { classes: { trinket: 3, set: 1.5 }, need: { drought: 50, share: 20, need: 10, tenure: 20 }, tenureDays: 60 }, { by: "Admin", now: 7 });
    councilWeights.setWeights("cA", { classes: { trinket: 0.5 }, items: { [SET]: { weight: 4, name: "Hood" } }, need: { drought: 10, share: 70, need: 10, tenure: 10 } });
    councilWeights.setWeights("cD", { need: { drought: 30, share: 30, need: 30, tenure: 10 }, tenureDays: 20 });
    councilStore.setView("cB", { role: "healer", tiers: ["t6"], bisTier: "t6" });
    councilStore.setView("cD", { role: "", contents: ["ssc"] });
    rA = rosterStore.createRoster({ name: "Mittwoch-Roster", guildId: "g1", categoryId: "cA" });
    rC = rosterStore.createRoster({ name: "Montag-Roster", guildId: "g1", categoryId: "cC" });
    rosterStore.upsertMember(rA.id, "100001", { chars: ["Devihra"] });
    rosterStore.upsertMember(rA.id, "100002", { chars: ["Zweit"] });
    rosterStore.upsertMember(rC.id, "100001", { chars: ["Devihra"] });

    mockAnnotated.mockReturnValue([
        { key: "devihra", className: "Priest", spec: "Shadow" },
        { key: "zweit", className: "Warlock", spec: "Destruction" },
        { key: "heila", className: "Priest", spec: "Holy" },
    ]);
    mockListAll.mockReturnValue(["cA", "cB", "cC", "cD"].flatMap((categoryId, i) => [
        lootRow({ categoryId, itemId: TRINKET, awardedAt: now - (3 + i) * DAY }),
        lootRow({ categoryId, characterKey: "zweit", character: "Zweit", itemId: SET, awardedAt: now - (10 + i) * DAY }),
        lootRow({ categoryId, characterKey: "heila", character: "Heila", itemId: SET, awardedAt: now - (20 + i) * DAY }),
    ]));
});

/** What a council answer says about every raider - the numbers that must not move. */
const numbers = (built) => ({
    rows: built.rows.map((r) => ({ key: r.key, need: r.needScore, parts: r.needParts, points: r.lootPoints, drought: r.droughtDays })),
    avgLootPoints: built.avgLootPoints,
    weights: { classes: built.weights.classes, items: built.weights.items, need: built.weights.need, needShares: built.weights.needShares, tenureDays: built.weights.tenureDays },
});
const viewOnly = ({ role, tiers, contents, bisTier, version }) => ({ role, tiers, contents, bisTier, version });

describe("migrateCouncilProfiles (#676) - golden master", () => {
    it("keeps every number and every view exactly as before", () => {
        const before = {};
        for (const categoryId of CATS) {
            before[categoryId] = {
                council: numbers(councilRoster({ categoryId, now, weights: councilWeights.weightsFor(categoryId) })),
                view: categoryId ? viewOnly(councilStore.viewFor(categoryId)) : null,
            };
        }

        // the cases really differ - otherwise "unchanged" would prove nothing
        expect(before.cA.council.rows).not.toEqual(before[""].council.rows);
        expect(before.cD.council.weights).not.toEqual(before.cC.council.weights);
        expect(before.cA.council.rows.map((r) => r.key).sort()).toEqual(["devihra", "zweit"]);

        const lines = migrateCouncilProfiles({ now: 1000 });
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("council-profiles.json");
        expect(lines[0]).toContain("aus der Server-Gewichtung");

        for (const categoryId of CATS) {
            expect({ categoryId, ...numbers(councilRoster({ categoryId, now })) }).toEqual({ categoryId, ...before[categoryId].council });
            if (categoryId) expect({ categoryId, view: viewOnly(councilProfiles.viewFor({ categoryId })) }).toEqual({ categoryId, view: before[categoryId].view });
        }
    });

    it("makes the server weighting Standard and a profile per category with own settings", () => {
        migrateCouncilProfiles({ now: 1000 });
        const list = councilProfilesStore.listProfiles();
        expect(list.map((p) => [p.id, p.name])).toEqual([
            ["standard", "Standard"],
            ["cat-cD", "Donnerstag PuG"],
            ["cat-cA", "Mittwoch"],
            ["cat-cB", "Sonntag"],
        ]);
        expect(councilProfilesStore.getProfile("standard")).toMatchObject({ at: 7, by: "Admin", weights: { tenureDays: 60 } });
        // cA's profile went to its roster, cB and cD (no roster) keep theirs as category entries, cC follows Standard.
        expect(rosterStore.getRoster(rA.id).lootProfileId).toBe("cat-cA");
        expect(rosterStore.getRoster(rC.id).lootProfileId).toBe("");
        expect(councilProfilesStore.categoryProfiles()).toEqual({ cB: "cat-cB", cD: "cat-cD" });
        // the hand-over writes no history line - nobody changed a setting
        expect(rosterStore.getRoster(rA.id).history.map((h) => h.what)).not.toContain("settings");
        // a view-only category copies the server weighting, a weighting-only one gets the default view
        expect(councilProfilesStore.getProfile("cat-cB").weights.classes.trinket).toBe(3);
        expect(councilProfilesStore.getProfile("cat-cA").view.role).toBe("caster");
        expect(councilProfiles.resolveProfile({ categoryId: "cC" }).source).toBe("default");
        expect(councilProfiles.resolveProfile({ categoryId: "cA" }).source).toBe("roster");
        expect(councilProfiles.resolveProfile({ categoryId: "cB" }).source).toBe("category");
    });

    it("runs once and leaves the old files untouched", () => {
        expect(migrateCouncilProfiles({ now: 1 })).toHaveLength(1);
        const stored = fs.readFileSync(councilStore.VIEWS_FILE, "utf8");
        expect(JSON.parse(stored).views.cB.role).toBe("healer");
        expect(councilWeights.storedWeights().categories.cA).toBeTruthy();
        expect(migrateCouncilProfiles({ now: 2 })).toEqual([]);
        expect(councilProfilesStore.isMigrated()).toBe(true);
    });

    it("does nothing at all on a fresh install", () => {
        councilStore.reset();
        councilWeights.resetWeights("");
        for (const id of ["cA", "cD"]) councilWeights.resetWeights(id);
        expect(migrateCouncilProfiles()).toEqual([]);
        expect(councilProfilesStore.isMigrated()).toBe(false);
        expect(councilProfilesStore.defaultProfile().stored).toBe(false);
    });

    it("names a repeated category name apart and falls back to the id", () => {
        fs.writeFileSync(settingsPath("category-names.json"), JSON.stringify({ guilds: { g1: { cA: "Raid", cB: "Raid" } } }));
        const result = councilProfilesStore.migrateLegacy({
            global: null,
            categories: { cA: {}, cX: {} },
            views: { cB: { role: "healer" } },
            nameOf: (id) => ({ cA: "Raid", cB: "Raid" }[id] || ""),
            rosterFor: () => null,
        });
        expect(result.created.map((c) => c.name).sort()).toEqual(["Raid", "Raid (2)", "cX"]);
        expect(councilProfilesStore.getProfile("standard").at).toBe(0);
    });
});
