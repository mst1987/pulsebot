// Which roster of a category is meant (#739): one per category and version.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const rosterStore = require("../../../src/stores/roster/rosterStore");
const configStore = require("../../../src/stores/settings/configStore");
const {
    rosterOfCategory, currentRoster, rosterOfEvent, currentVersionOf, isCurrentRoster,
} = require("../../../src/services/roster/categoryRoster");

const SWITCHED = { categoryIds: ["c1"], categoryVersion: { c1: "forever" } };

let tbc;
let forever;
beforeEach(() => {
    fs.__store.clear();
    tbc = rosterStore.createRoster({ name: "Mo", categoryId: "c1", versionId: "tbc" });
    rosterStore.closeRoster(tbc.id, { reason: "version_switch" });
    forever = rosterStore.createRoster({ name: "Mo", categoryId: "c1", versionId: "forever" });
});

describe("services/roster/categoryRoster", () => {
    it("rosterOfCategory: the named version's roster - closed or not -, else the one the category plays now", () => {
        expect(rosterOfCategory("c1", { versionId: "tbc" }).id).toBe(tbc.id);
        expect(rosterOfCategory("c1", { versionId: "forever" }).id).toBe(forever.id);
        expect(rosterOfCategory("c1", { config: SWITCHED }).id).toBe(forever.id);
        expect(rosterOfCategory("c1", { versionId: "nope", config: SWITCHED }).id).toBe(forever.id);
        expect(rosterOfCategory("", { versionId: "tbc" })).toBeNull();
        expect(rosterOfCategory("c9", { versionId: "tbc" })).toBeNull();
    });

    it("currentRoster reads the stored config when none is handed in", () => {
        expect(currentRoster("c1").id).toBe(tbc.id);
        configStore.saveConfig(SWITCHED);
        expect(currentRoster("c1").id).toBe(forever.id);
        expect(currentVersionOf("c1")).toBe("forever");
    });

    it("rosterOfEvent: the roster of the raid's stored version", () => {
        expect(rosterOfEvent({ id: "e1", categoryId: "c1", versionId: "tbc" }, { config: SWITCHED }).id).toBe(tbc.id);
        expect(rosterOfEvent({ id: "e2", categoryId: "c1", versionId: "forever" }).id).toBe(forever.id);
        // a raid not stored yet: the version its category plays now
        expect(rosterOfEvent({ id: "e3", categoryId: "c1" }, { config: SWITCHED }).id).toBe(forever.id);
        expect(rosterOfEvent({ id: "e4" })).toBeNull();
        expect(rosterOfEvent(null)).toBeNull();
    });

    it("isCurrentRoster: open and of the version the category plays now", () => {
        expect(isCurrentRoster(forever, { config: SWITCHED })).toBe(true);
        expect(isCurrentRoster(rosterStore.getRoster(tbc.id), { config: SWITCHED })).toBe(false);
        expect(isCurrentRoster(forever, { config: {} })).toBe(false);
        expect(isCurrentRoster({ id: "x", categoryId: null }, { config: SWITCHED })).toBe(false);
        expect(isCurrentRoster(null)).toBe(false);
    });
});
