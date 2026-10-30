jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../../src/config/paths");
const rosterStore = require("../../../src/stores/roster/rosterStore");
const configStore = require("../../../src/stores/settings/configStore");
const { expectedRoleIds, syncRosterRoleIds, mirrorCategoryRoles } = require("../../../src/services/roster/categoryRoles");

const config = { categoryRoles: { c1: ["10", "11"], c2: ["20"] } };

beforeEach(() => {
    fs.__store.clear();
});

describe("services/roster/categoryRoles expectedRoleIds", () => {
    it("the settings roles while a category has no roster", () => {
        expect(expectedRoleIds("c1", config)).toEqual(["10", "11"]);
        expect(expectedRoleIds("c9", config)).toEqual([]);
        expect(expectedRoleIds("", config)).toEqual([]);
        expect(expectedRoleIds("c1", { categoryRoles: { c1: "junk" } })).toEqual([]);
        expect(expectedRoleIds("c1", {})).toEqual([]);
    });

    it("the roster's roles once there is a roster - also none", () => {
        rosterStore.createRoster({ name: "A", categoryId: "c1", roleIds: ["99"] });
        rosterStore.createRoster({ name: "B", categoryId: "c2", roleIds: [] });
        expect(expectedRoleIds("c1", config)).toEqual(["99"]);
        expect(expectedRoleIds("c2", config)).toEqual([]);
    });

    it("hands out a copy", () => {
        const roles = expectedRoleIds("c1", config);
        roles.push("x");
        expect(config.categoryRoles.c1).toEqual(["10", "11"]);
    });

    it("reads the stored config when none is handed in", () => {
        fs.__store.set(settingsPath("config.json"), JSON.stringify({ categoryRoles: { c5: ["55"] } }));
        expect(expectedRoleIds("c5")).toEqual(["55"]);
    });
});

describe("services/roster/categoryRoles syncRosterRoleIds", () => {
    it("carries the saved settings roles over to every roster of a category", () => {
        const a = rosterStore.createRoster({ name: "A", categoryId: "c1", roleIds: ["10", "11"] });
        const b = rosterStore.createRoster({ name: "B", categoryId: "c2", roleIds: ["20"] });
        rosterStore.createRoster({ name: "Ohne Kategorie", roleIds: ["30"] });
        const changed = syncRosterRoleIds({ c1: ["10", "11"], c3: ["40"] }, { actor: "u1" });
        expect(changed).toEqual([b.id]);
        expect(rosterStore.getRoster(a.id).roleIds).toEqual(["10", "11"]);
        expect(rosterStore.getRoster(b.id).roleIds).toEqual([]);
        const hist = rosterStore.getRoster(b.id).history;
        expect(hist[hist.length - 1]).toMatchObject({ by: "u1", what: "settings", detail: "roleIds" });
        expect(syncRosterRoleIds(null)).toEqual([]);
        expect(rosterStore.getRoster(a.id).roleIds).toEqual(["10", "11"]);
    });
});

describe("services/roster/categoryRoles mirrorCategoryRoles (#657)", () => {
    it("writes a roster's roles into its category's settings value, so a settings save keeps them", () => {
        configStore.saveConfig({ categoryRoles: { c2: ["20"] } });
        const a = rosterStore.createRoster({ name: "A", categoryId: "c1", roleIds: ["10", "11"] });
        expect(mirrorCategoryRoles(a)).toBe(true);
        expect(configStore.getConfig().categoryRoles).toEqual({ c1: ["10", "11"], c2: ["20"] });
        expect(mirrorCategoryRoles(a)).toBe(false);
        // the settings page saving the map now carries the same roles back
        expect(syncRosterRoleIds(configStore.getConfig().categoryRoles)).toEqual([]);
        expect(rosterStore.getRoster(a.id).roleIds).toEqual(["10", "11"]);
    });

    it("drops the category when the roster has no roles, and leaves a roster without category alone", () => {
        configStore.saveConfig({ categoryRoles: { c1: ["10"] } });
        expect(mirrorCategoryRoles({ categoryId: "c1", roleIds: [] })).toBe(true);
        expect(configStore.getConfig().categoryRoles).toEqual({});
        expect(mirrorCategoryRoles({ categoryId: null, roleIds: ["1"] })).toBe(false);
        expect(mirrorCategoryRoles(null)).toBe(false);
    });
});

describe("services/roster/categoryRoles with one roster per version (#739)", () => {
    const SWITCHED = { categoryIds: ["c1"], categoryVersion: { c1: "forever" }, categoryRoles: { c1: ["10"] } };
    let tbc;
    let forever;
    beforeEach(() => {
        tbc = rosterStore.createRoster({ name: "Alt", categoryId: "c1", versionId: "tbc", roleIds: ["10"] });
        rosterStore.closeRoster(tbc.id, { reason: "version_switch" });
        forever = rosterStore.createRoster({ name: "Neu", categoryId: "c1", versionId: "forever", roleIds: ["20"] });
    });

    it("expectedRoleIds: the roster of the raid's version, else of the version the category plays now", () => {
        expect(expectedRoleIds("c1", SWITCHED, { versionId: "tbc" })).toEqual(["10"]);
        expect(expectedRoleIds("c1", SWITCHED, { versionId: "forever" })).toEqual(["20"]);
        expect(expectedRoleIds("c1", SWITCHED)).toEqual(["20"]);
        // a version without roster: the settings value
        rosterStore.deleteRoster(forever.id);
        expect(expectedRoleIds("c1", SWITCHED, { versionId: "forever" })).toEqual(["10"]);
    });

    it("syncRosterRoleIds hands the settings roles only to the open roster of the current version", () => {
        expect(syncRosterRoleIds({ c1: ["30"] }, { config: SWITCHED })).toEqual([forever.id]);
        expect(rosterStore.getRoster(forever.id).roleIds).toEqual(["30"]);
        expect(rosterStore.getRoster(tbc.id).roleIds).toEqual(["10"]);
        // a category switched in this save is left to the switch
        expect(syncRosterRoleIds({ c1: ["40"] }, { config: SWITCHED, skip: new Set(["c1"]) })).toEqual([]);
        expect(rosterStore.getRoster(forever.id).roleIds).toEqual(["30"]);
    });

    it("mirrorCategoryRoles writes only the current open roster's roles", () => {
        configStore.saveConfig(SWITCHED);
        expect(mirrorCategoryRoles(rosterStore.getRoster(tbc.id))).toBe(false);
        expect(configStore.getConfig().categoryRoles.c1).toEqual(["10"]);
        expect(mirrorCategoryRoles(forever)).toBe(true);
        expect(configStore.getConfig().categoryRoles.c1).toEqual(["20"]);
    });
});
