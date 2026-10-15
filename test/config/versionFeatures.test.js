// The features of the per-version matrix (#761) and the one normaliser of their setting.
const { VERSION_FEATURES, isVersionFeature, normalizeDisabled } = require("../../src/config/versionFeatures");

describe("config/versionFeatures", () => {
    it("lists the eight features in the matrix order", () => {
        expect(VERSION_FEATURES).toEqual(["logcheck", "lootCouncilBis", "simulation", "raidSheet", "softres", "armory", "wowheadLinks", "raidplanCatalog", "dungeonTimes"]);
        expect(Object.isFrozen(VERSION_FEATURES)).toBe(true);
    });

    it("knows a feature by its id only", () => {
        expect(isVersionFeature("logcheck")).toBe(true);
        expect(isVersionFeature("Logcheck")).toBe(false);
        expect(isVersionFeature("")).toBe(false);
        expect(isVersionFeature(undefined)).toBe(false);
    });

    it("keeps known ids once, in the matrix order, and drops the rest", () => {
        expect(normalizeDisabled(["softres", " logcheck ", "softres", "teleport", 3, null])).toEqual(["logcheck", "softres"]);
        expect(normalizeDisabled([])).toEqual([]);
        expect(normalizeDisabled("logcheck")).toEqual([]);
        expect(normalizeDisabled(undefined)).toEqual([]);
    });
});
