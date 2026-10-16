// "Neue Version starten" (#745): every item of the checklist open and done,
// computed from the data (buildChecklist pure, loadChecklist over mocked stores),
// and the marks of the manual items.
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => mockConfig),
    saveConfig: jest.fn((partial) => { mockConfig = { ...mockConfig, ...partial }; return mockConfig; }),
    listRaidTemplates: jest.fn(() => mockTemplates),
}));
jest.mock("../../../src/stores/rosterStore", () => ({
    rosterForCategory: jest.fn((cat, version) => mockRosters[`${cat}|${version}`] || null),
    isClosed: (r) => !!(r && r.closedAt),
}));
jest.mock("../../../src/stores/eventSeriesStore", () => ({ listSeries: jest.fn(() => mockSeries) }));
jest.mock("../../../src/stores/guildBankStockStore", () => ({ listBanks: jest.fn(() => mockBanks) }));
jest.mock("../../../src/services/discord/guildRoles", () => ({ eventGuildIds: jest.fn(() => ["g1"]) }));
jest.mock("../../../src/services/discord/categoryNames", () => ({
    listKnownCategories: jest.fn(() => [{ id: "c1", name: "Montag" }, { id: "c2", name: "Mittwoch" }, { id: "c3", name: "PuG" }]),
}));
jest.mock("../../../src/services/backup/backupConfig", () => ({
    ...jest.requireActual("../../../src/services/backup/backupConfig"),
    backupEnabled: jest.fn(() => false),
}));
jest.mock("../../../src/services/backup/backupStatus", () => ({ readParts: jest.fn() }));

let mockConfig;
let mockTemplates;
let mockRosters;
let mockSeries;
let mockBanks;

const { backupEnabled } = require("../../../src/services/backup/backupConfig");
const backupStatus = require("../../../src/services/backup/backupStatus");
const { saveConfig } = require("../../../src/stores/settingsStore");
const launch = require("../../../src/services/events/versionLaunch");

const itemOf = (list, id) => list.items.find((i) => i.id === id);
const build = (over = {}) => launch.buildChecklist({ versionId: "forever", ...over });

beforeEach(() => {
    jest.clearAllMocks();
    mockConfig = {
        mainVersion: "tbc",
        categoryIds: ["c1", "c2"],
        categoryVersion: { c1: "tbc", c2: "forever" },
        versionSettings: {
            tbc: { blizzardRegion: "eu", blizzardRealmSlug: "spineshatter", blizzardNamespace: "profile-classicann-eu", armoryUrlTemplate: "https://a.example/{char}", wclUrlTemplate: "https://fresh.warcraftlogs.com/character/eu/x/{char}", wowheadPath: "tbc", softresEdition: "tbc", raidsheetId: "" },
            forever: { wowheadPath: "forever" },
        },
    };
    mockTemplates = [
        { id: "t-tbc", name: "SSC + TK", versionId: "tbc", instanceIds: ["ssc"] },
        { id: "t-fv", name: "Barrow", versionId: "forever", instanceIds: ["forever-barrow"] },
    ];
    mockRosters = {};
    mockSeries = {};
    mockBanks = [];
});

describe("buildChecklist (pure)", () => {
    it("lists the items in the runbook's order and counts all but the optional one", () => {
        const list = build();
        expect(list.items.map((i) => i.id)).toEqual(launch.ITEM_IDS);
        expect(list.total).toBe(10);
        expect(itemOf(list, "mainVersion").optional).toBe(true);
        expect(list).toMatchObject({ versionId: "forever", label: "WoW Forever" });
    });

    describe("backup", () => {
        const part = (light, at = 5) => ({ light, at });
        it("is computed where the instance takes backups: done with a fresh snapshot and off-site copy", () => {
            expect(itemOf(build({ backup: { snapshot: part("ok"), offsite: part("ok") } }), "backup")).toMatchObject({ kind: "auto", status: "done", snapshotAt: 5 });
            expect(itemOf(build({ backup: { snapshot: part("ok"), offsite: part("warn") } }), "backup")).toMatchObject({ kind: "auto", status: "open" });
        });
        it("is marked by hand without one", () => {
            expect(itemOf(build(), "backup")).toMatchObject({ kind: "manual", status: "open", mark: null });
            expect(itemOf(build({ marks: { backup: { at: 1, byName: "Orga" } } }), "backup")).toMatchObject({ kind: "manual", status: "done", mark: { at: 1, byName: "Orga" } });
        });
    });

    it.each(["export", "lootAddon", "talk"])("%s is manual: open until marked, done when marked", (id) => {
        expect(itemOf(build(), id)).toMatchObject({ kind: "manual", status: "open" });
        expect(itemOf(build({ marks: { [id]: { at: 2, byName: "X" } } }), id)).toMatchObject({ kind: "manual", status: "done" });
    });

    it("categories: open without any or with one lacking a version, done when every one has one", () => {
        expect(itemOf(build(), "categories").status).toBe("open");
        const open = itemOf(build({ categories: [{ id: "c1", name: "Mo", versionId: "tbc" }, { id: "c2", name: "Mi", versionId: "" }] }), "categories");
        expect(open).toMatchObject({ status: "open", total: 2, missing: [{ id: "c2", name: "Mi" }] });
        const ok = itemOf(build({ categories: [{ id: "c1", name: "Mo", versionId: "tbc" }, { id: "c2", name: "Mi", versionId: "forever" }] }), "categories");
        expect(ok).toMatchObject({ status: "done", missing: [], target: [{ id: "c2", name: "Mi" }] });
    });

    it("version settings: open while a needed field is missing; not needed counts as fine", () => {
        expect(itemOf(build({ fields: [{ field: "softres", state: "missing", reason: "" }] }), "versionSettings").status).toBe("open");
        expect(itemOf(build({ fields: [{ field: "wcl", state: "notNeeded", reason: "rules_not_ready" }, { field: "wowhead", state: "set", reason: "" }] }), "versionSettings").status).toBe("done");
    });

    it("templates: open without a template of the version, done with one; incomplete raids are a hint", () => {
        expect(itemOf(build(), "templates")).toMatchObject({ status: "open", count: 0 });
        const ok = itemOf(build({ templates: [{ id: "a", name: "A", incomplete: ["Barrow Deeps"] }, { id: "b", name: "B", incomplete: ["Barrow Deeps"] }] }), "templates");
        expect(ok).toMatchObject({ status: "done", count: 2, names: ["A", "B"], incomplete: ["Barrow Deeps"] });
    });

    it("series: open with a template of another version, done without", () => {
        const problems = [{ categoryId: "c2", name: "Mi", kind: "series", template: "SSC + TK" }];
        expect(itemOf(build({ seriesProblems: problems }), "series")).toMatchObject({ status: "open", problems });
        expect(itemOf(build({ targetCategories: [{ id: "c2", name: "Mi" }] }), "series")).toMatchObject({ status: "done", categories: 1 });
    });

    it("rosters: open without a category of the version or with a problem, done otherwise", () => {
        expect(itemOf(build(), "rosters").status).toBe("open");
        const target = [{ id: "c2", name: "Mi" }];
        expect(itemOf(build({ targetCategories: target, rosterProblems: [{ categoryId: "c2", name: "Mi", rosterId: "", problems: ["missing"] }] }), "rosters").status).toBe("open");
        expect(itemOf(build({ targetCategories: target }), "rosters").status).toBe("done");
    });

    it("guild bank: open without a bank or with one waiting for its server, done with an assigned one", () => {
        expect(itemOf(build(), "guildBank").status).toBe("open");
        expect(itemOf(build({ banks: [{ key: "k", guild: "G", realm: "R", assigned: false }] }), "guildBank").status).toBe("open");
        expect(itemOf(build({ banks: [{ key: "k", guild: "G", realm: "R", assigned: true }] }), "guildBank").status).toBe("done");
    });

    it("main version: optional, done only when it is the target and the others are hidden", () => {
        expect(itemOf(build({ mainVersion: "tbc", hideOtherVersions: false }), "mainVersion")).toMatchObject({ status: "open", isMain: false });
        expect(itemOf(build({ mainVersion: "forever", hideOtherVersions: false }), "mainVersion")).toMatchObject({ status: "open", isMain: true, hidden: false });
        const list = build({ mainVersion: "forever", hideOtherVersions: true });
        expect(itemOf(list, "mainVersion").status).toBe("done");
        // optional: not in "x / y"
        expect(list.done).toBe(build({ mainVersion: "tbc" }).done);
        expect(list.total).toBe(10);
    });
});

describe("fieldStates", () => {
    it("Forever today: Wowhead set, realm, armory and softres needed, logs and raidsheet not possible", () => {
        const states = Object.fromEntries(launch.fieldStates("forever", mockConfig).map((f) => [f.field, [f.state, f.reason]]));
        expect(states).toEqual({
            realm: ["missing", ""],
            armory: ["missing", ""],
            wcl: ["notNeeded", "rules_not_ready"],
            wowhead: ["set", ""],
            softres: ["missing", ""],
            raidsheet: ["notNeeded", "no_sheet_layout"],
        });
    });

    it("an empty field of a feature switched off is not needed", () => {
        mockConfig.versionSettings.forever.disabled = ["armory", "softres"];
        const states = Object.fromEntries(launch.fieldStates("forever", mockConfig).map((f) => [f.field, [f.state, f.reason]]));
        expect(states.realm).toEqual(["notNeeded", "disabled"]);
        expect(states.armory).toEqual(["notNeeded", "disabled"]);
        expect(states.softres).toEqual(["notNeeded", "disabled"]);
    });

    it("TBC: the raidsheet is possible, so an empty one is missing", () => {
        const states = Object.fromEntries(launch.fieldStates("tbc", mockConfig).map((f) => [f.field, f.state]));
        expect(states).toMatchObject({ realm: "set", armory: "set", wcl: "set", wowhead: "set", softres: "set", raidsheet: "missing" });
    });
});

describe("loadChecklist", () => {
    it("reads the target's categories, templates, series, rosters and banks", () => {
        mockConfig.categoryRaidTemplate = { c2: "t-tbc" };
        mockSeries = { c2: { categoryId: "c2", enabled: true, raidTemplateId: "" }, c1: { categoryId: "c1", enabled: true, raidTemplateId: "t-fv" } };
        mockRosters = { "c2|forever": { id: "r2", roleIds: [], managers: { roleIds: [], userIds: ["u1"] }, closedAt: null } };
        mockBanks = [{ key: "forever:r:g", gameVersion: "forever", guild: "Gilde", realm: "Realm", guildId: "" }, { key: "tbc:r:g", gameVersion: "tbc", guild: "Alt", realm: "R", guildId: "g1" }];
        const list = launch.loadChecklist("forever");
        expect(itemOf(list, "categories")).toMatchObject({ status: "done", total: 2, target: [{ id: "c2", name: "Mittwoch" }] });
        expect(itemOf(list, "templates")).toMatchObject({ status: "done", count: 1, names: ["Barrow"], incomplete: ["Barrow Deeps"] });
        // c1 plays TBC: its Forever template is not this checklist's business
        expect(itemOf(list, "series").problems).toEqual([
            { categoryId: "c2", name: "Mittwoch", kind: "default", template: "SSC + TK" },
            { categoryId: "c2", name: "Mittwoch", kind: "series", template: "SSC + TK" },
        ]);
        expect(itemOf(list, "rosters").problems).toEqual([{ categoryId: "c2", name: "Mittwoch", rosterId: "r2", problems: ["noRoles"] }]);
        expect(itemOf(list, "guildBank")).toMatchObject({ status: "open", banks: [{ key: "forever:r:g", guild: "Gilde", realm: "Realm", assigned: false }] });
        expect(itemOf(list, "versionSettings").status).toBe("open");
        expect(itemOf(list, "backup").kind).toBe("manual");
    });

    it("is done where the data is in place", () => {
        mockConfig.categoryRaidTemplate = { c2: "t-fv" };
        mockSeries = { c2: { categoryId: "c2", enabled: true, raidTemplateId: "" } };
        mockRosters = { "c2|forever": { id: "r2", roleIds: ["role"], managers: { roleIds: ["m"], userIds: [] }, closedAt: null } };
        mockBanks = [{ key: "forever:r:g", gameVersion: "forever", guild: "Gilde", realm: "Realm", guildId: "g1" }];
        mockConfig.versionSettings.forever.disabled = ["armory", "softres"];
        const list = launch.loadChecklist("forever");
        for (const id of ["categories", "versionSettings", "templates", "series", "rosters", "guildBank"]) expect([id, itemOf(list, id).status]).toEqual([id, "done"]);
    });

    it("names a missing, closed or ownerless roster", () => {
        expect(launch.rosterProblemsOf(null)).toEqual(["missing"]);
        expect(launch.rosterProblemsOf({ closedAt: "2026-10-01", roleIds: [], managers: { roleIds: [], userIds: [] } })).toEqual(["closed", "noRoles", "noManagers"]);
        expect(launch.rosterProblemsOf({ closedAt: null, roleIds: ["r"], managers: { roleIds: [], userIds: ["u"] } })).toEqual([]);
    });

    it("ignores a paused series", () => {
        mockSeries = { c2: { categoryId: "c2", enabled: false, raidTemplateId: "t-tbc" } };
        expect(itemOf(launch.loadChecklist("forever"), "series").problems).toEqual([]);
    });

    it("reads the backup for a full admin where the instance takes one", () => {
        backupEnabled.mockReturnValue(true);
        backupStatus.readParts.mockReturnValue({ parts: [{ key: "snapshot", light: "ok", at: 10 }, { key: "offsite", light: "ok", at: 11 }] });
        expect(itemOf(launch.loadChecklist("forever", { withBackup: true }), "backup")).toMatchObject({ kind: "auto", status: "done", offsiteAt: 11 });
        expect(itemOf(launch.loadChecklist("forever"), "backup").kind).toBe("manual");
    });

    it("opens on a version a category plays besides the main one", () => {
        expect(launch.loadChecklist("").versionId).toBe("forever");
        // nothing played besides the main version: the newest other one
        expect(launch.defaultTarget({ mainVersion: "tbc", categoryVersion: {} })).toBe("forever");
        expect(launch.defaultTarget({ mainVersion: "forever", categoryVersion: {} })).toBe("classic");
        expect(launch.defaultTarget({ mainVersion: "tbc", categoryVersion: { c1: "classic" } })).toBe("classic");
    });
});

describe("setManualMark", () => {
    it("stores and removes a mark per version", () => {
        expect(launch.setManualMark("forever", "talk", true, { byName: "Orga", now: 42 }).config.versionLaunch).toEqual({ forever: { talk: { at: 42, byName: "Orga" } } });
        expect(itemOf(launch.loadChecklist("forever"), "talk")).toMatchObject({ status: "done", mark: { at: 42, byName: "Orga" } });
        launch.setManualMark("forever", "talk", false);
        expect(saveConfig).toHaveBeenLastCalledWith({ versionLaunch: { forever: {} } });
    });

    it("refuses a computed item and an unknown version", () => {
        expect(launch.setManualMark("forever", "rosters", true)).toMatchObject({ code: "invalid" });
        expect(launch.setManualMark("nope", "talk", true)).toMatchObject({ code: "invalid", error: "Unbekannte Spielversion." });
        expect(saveConfig).not.toHaveBeenCalled();
    });
});
