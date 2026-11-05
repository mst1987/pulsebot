jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../../src/config/paths");
const rosterStore = require("../../../src/stores/roster/rosterStore");
const configStore = require("../../../src/stores/settings/configStore");
const { expectedRoleIds, syncRosterRoleIds, rolesOfOtherRosters, mirrorCategoryRoles } = require("../../../src/services/roster/categoryRoles");

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

    it("touches only the categories named in `only` (#1073 part B)", () => {
        const a = rosterStore.createRoster({ name: "A", categoryId: "c1", roleIds: ["10"] });
        const b = rosterStore.createRoster({ name: "B", categoryId: "c2", roleIds: ["20"] });
        const changed = syncRosterRoleIds({ c1: ["12"] }, { actor: "u1", only: new Set(["c1"]) });
        expect(changed).toEqual([a.id]);
        expect(rosterStore.getRoster(a.id).roleIds).toEqual(["12"]);
        expect(rosterStore.getRoster(b.id).roleIds).toEqual(["20"]);
        expect(syncRosterRoleIds({}, { only: new Set() })).toEqual([]);
        expect(rosterStore.getRoster(a.id).roleIds).toEqual(["12"]);
    });

    it("adopts a roster only for a category named in `only`", () => {
        const FOREVER = { categoryVersion: { c5: "forever", c6: "forever" }, categoryIds: ["c5", "c6"] };
        const roster = rosterStore.createRoster({ guildId: "g1", name: "Kader", versionId: "forever", roleIds: ["50"] });
        expect(syncRosterRoleIds({ c5: ["50"] }, { config: FOREVER, guildOf: () => "g1", only: new Set(["c6"]) })).toEqual([]);
        expect(rosterStore.getRoster(roster.id).categoryId || "").toBe("");
    });

    describe("a category without roster that gets the role of a roster without category", () => {
        const FOREVER = { categoryVersion: { c5: "forever" }, categoryIds: ["c5"] };
        const guildOf = () => "g1";
        const kaderRoster = () => rosterStore.createRoster({ guildId: "g1", name: "Pulse Do", versionId: "forever", roleIds: ["50"], kaderId: "k1" });

        it("takes that roster instead of a second one coming at the next start", () => {
            const roster = kaderRoster();
            expect(syncRosterRoleIds({ c5: ["50"] }, { actor: "u1", config: FOREVER, guildOf })).toEqual([roster.id]);
            expect(rosterStore.getRoster(roster.id)).toMatchObject({ categoryId: "c5", name: "Pulse Do", kaderId: "k1", roleIds: ["50"] });
            expect(rosterStore.rosterForCategory("c5", "forever").id).toBe(roster.id);
            expect(syncRosterRoleIds({ c5: ["50"] }, { actor: "u1", config: FOREVER, guildOf })).toEqual([]);
        });

        it("names a roster once when it also takes more roles", () => {
            const roster = kaderRoster();
            expect(syncRosterRoleIds({ c5: ["50", "51"] }, { config: FOREVER, guildOf })).toEqual([roster.id]);
            expect(rosterStore.getRoster(roster.id).roleIds).toEqual(["50", "51"]);
        });

        it.each([
            ["an inactive category", { ...FOREVER, categoryIds: [] }, {}, new Set()],
            ["a category switched in this save", FOREVER, {}, new Set(["c5"])],
            ["a roster of another version", FOREVER, { versionId: "tbc" }, new Set()],
            ["a roster of another server", FOREVER, { guildId: "g2" }, new Set()],
        ])("leaves it alone for %s", (_case, cfg, fields, skip) => {
            const roster = rosterStore.createRoster({ guildId: "g1", name: "Pulse Do", versionId: "forever", roleIds: ["50"], ...fields });
            expect(syncRosterRoleIds({ c5: ["50"] }, { config: cfg, skip, guildOf })).toEqual([]);
            expect(rosterStore.getRoster(roster.id).categoryId).toBeNull();
        });

        it("moves nothing while the category's server is unknown", () => {
            const roster = kaderRoster();
            expect(syncRosterRoleIds({ c5: ["50"] }, { config: FOREVER })).toEqual([]);
            expect(syncRosterRoleIds({ c5: ["50"] }, { config: FOREVER, guildOf: () => "" })).toEqual([]);
            expect(rosterStore.getRoster(roster.id).categoryId).toBeNull();
        });

        it("a category that has its roster keeps it", () => {
            const own = rosterStore.createRoster({ guildId: "g1", name: "Eigen", categoryId: "c5", versionId: "forever", roleIds: ["60"] });
            const free = kaderRoster();
            syncRosterRoleIds({ c5: ["60"] }, { config: FOREVER, guildOf });
            expect(rosterStore.getRoster(free.id).categoryId).toBeNull();
            expect(rosterStore.getRoster(own.id).categoryId).toBe("c5");
        });
    });
});

describe("services/roster/categoryRoles rolesOfOtherRosters", () => {
    const CFG = { categoryVersion: { c1: "tbc", c2: "tbc" } };

    it("counts the roster a category takes in this save with the roles it then follows", () => {
        const config = { categoryVersion: { c2: "tbc", c5: "tbc" }, categoryIds: ["c2", "c5"] };
        rosterStore.createRoster({ guildId: "g1", name: "Kader", versionId: "tbc", roleIds: ["30"] });
        rosterStore.createRoster({ guildId: "g1", name: "Mi", categoryId: "c2", versionId: "tbc", roleIds: ["20"] });
        const opts = { config, guildOf: () => "g1" };
        expect(rolesOfOtherRosters({ c5: ["30", "20"], c2: ["20"] }, opts)).toEqual([{ roleId: "20", rosterName: "Kader", otherName: "Mi" }]);
        expect(rolesOfOtherRosters({ c5: ["30"], c2: ["20"] }, opts)).toEqual([]);
    });

    it("the first category takes a roster two categories name", () => {
        const config = { categoryVersion: { c5: "tbc", c6: "tbc" }, categoryIds: ["c5", "c6"] };
        const kader = rosterStore.createRoster({ guildId: "g1", name: "Kader", versionId: "tbc", roleIds: ["30"] });
        const guildOf = () => "g1";
        expect(rolesOfOtherRosters({ c5: ["30"], c6: ["30"] }, { config, guildOf })).toEqual([]);
        expect(syncRosterRoleIds({ c5: ["30"], c6: ["30"] }, { config, guildOf })).toEqual([kader.id]);
        expect(rosterStore.getRoster(kader.id).categoryId).toBe("c5");
    });

    it("only what the save adds counts: a map that was off before blocks nobody", () => {
        const config = { categoryVersion: { c1: "tbc", c2: "tbc" } };
        rosterStore.createRoster({ guildId: "g1", name: "Mo", categoryId: "c1", versionId: "tbc", roleIds: ["10"] });
        rosterStore.createRoster({ guildId: "g1", name: "Mi", categoryId: "c2", versionId: "tbc", roleIds: ["20"] });
        const map = { c1: ["10", "20"], c2: ["20"] };
        expect(rolesOfOtherRosters(map, { before: map, config })).toEqual([]);
        expect(rolesOfOtherRosters(map, { before: { c1: ["10"], c2: ["20"] }, config })).toHaveLength(1);
    });

    it("does not count the old roster of a category switched in this save, it closes right after", () => {
        const config = { categoryVersion: { c1: "forever", c2: "tbc" } };
        rosterStore.createRoster({ guildId: "g1", name: "Mo", categoryId: "c1", versionId: "tbc", roleIds: ["10"] });
        rosterStore.createRoster({ guildId: "g1", name: "Mi", categoryId: "c2", versionId: "tbc", roleIds: ["20"] });
        const map = { c1: ["10"], c2: ["20", "10"] };
        expect(rolesOfOtherRosters(map, { config, skip: new Set(["c1"]) })).toEqual([]);
        expect(rolesOfOtherRosters(map, { config: CFG })).toEqual([{ roleId: "10", rosterName: "Mi", otherName: "Mo" }]);
    });

    it("does not name a roster of another server", () => {
        rosterStore.createRoster({ guildId: "g1", name: "Mo", categoryId: "c1", versionId: "tbc", roleIds: [] });
        rosterStore.createRoster({ guildId: "g2", name: "Fremd", versionId: "tbc", roleIds: ["70"] });
        expect(rolesOfOtherRosters({ c1: ["70"] }, { config: CFG })).toEqual([{ roleId: "70", rosterName: "Mo", otherName: "" }]);
    });

    const both = () => [
        rosterStore.createRoster({ name: "Mo", categoryId: "c1", versionId: "tbc", roleIds: ["10"] }),
        rosterStore.createRoster({ name: "Mi", categoryId: "c2", versionId: "tbc", roleIds: ["20"] }),
    ];

    it("names a role a category's roster would take from another open roster", () => {
        both();
        expect(rolesOfOtherRosters({ c1: ["10", "20"], c2: ["20"] }, { config: CFG })).toEqual([{ roleId: "20", rosterName: "Mo", otherName: "Mi" }]);
    });

    it("sees a roster without category as a holder", () => {
        both();
        rosterStore.createRoster({ name: "Kader", versionId: "tbc", roleIds: ["30"] });
        expect(rolesOfOtherRosters({ c1: ["30"], c2: ["20"] }, { config: CFG })).toEqual([{ roleId: "30", rosterName: "Mo", otherName: "Kader" }]);
    });

    it("lets a role move or swap between categories in one save", () => {
        both();
        expect(rolesOfOtherRosters({ c1: ["10", "20"], c2: [] }, { config: CFG })).toEqual([]);
        expect(rolesOfOtherRosters({ c1: ["20"], c2: ["10"] }, { config: CFG })).toEqual([]);
    });

    it("an old double blocks nothing, a closed roster and a switched category do not count", () => {
        const [mo, mi] = both();
        rosterStore.updateRoster(mi.id, { roleIds: ["10"] });
        expect(rolesOfOtherRosters({ c1: ["10"], c2: ["10"] }, { config: CFG })).toEqual([]);
        rosterStore.updateRoster(mi.id, { roleIds: ["20"] });
        expect(rolesOfOtherRosters({ c1: ["10", "20"], c2: ["20"] }, { config: CFG, skip: new Set(["c1"]) })).toEqual([]);
        rosterStore.closeRoster(mi.id, { reason: "version_switch" });
        expect(rolesOfOtherRosters({ c1: ["10", "20"] }, { config: CFG })).toEqual([]);
        expect(rosterStore.getRoster(mo.id).roleIds).toEqual(["10"]);
    });

    it("answers nothing for no map at all", () => {
        expect(rolesOfOtherRosters(null)).toEqual([]);
        expect(rolesOfOtherRosters([])).toEqual([]);
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
