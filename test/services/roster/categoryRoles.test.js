jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../../src/config/paths");
const rosterStore = require("../../../src/stores/rosterStore");
const { expectedRoleIds, syncRosterRoleIds } = require("../../../src/services/roster/categoryRoles");

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
