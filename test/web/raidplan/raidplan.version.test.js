// The game version of a plan (#544, fallback #542): an own event's own, a
// Raid-Helper event's category's, else the main version - never a fixed "tbc".
jest.mock("../../../src/stores/configStore", () => ({ getConfig: jest.fn(() => ({})) }));

const { getConfig } = require("../../../src/stores/configStore");
const raidplan = require("../../../src/web/raidplan/raidplan");
const { instancesFromTitle } = require("../../../src/web/raidplan/raidplanTitle");

describe("web/raidplan planVersion", () => {
    it("keeps an event's own version", () => {
        getConfig.mockReturnValue({ mainVersion: "forever" });
        expect(raidplan.planVersion({ versionId: "tbc", categoryId: "c1" })).toBe("tbc");
    });

    it("gives a Raid-Helper event its category's version, else the main version", () => {
        getConfig.mockReturnValue({ mainVersion: "forever", categoryVersion: { c1: "classic" } });
        expect(raidplan.planVersion({ categoryId: "c1" })).toBe("classic");
        expect(raidplan.planVersion({ categoryId: "c2" })).toBe("forever");
        getConfig.mockReturnValue({});
        expect(raidplan.planVersion(null)).toBe("tbc");
    });
});

describe("web/raidplan/raidplanTitle version default", () => {
    it("reads a title as TBC when no version is handed in, and guesses nothing for another version", () => {
        expect(instancesFromTitle("Kara 10er")).toMatchObject({ instanceIds: ["kara"], size: 10, versionId: "tbc" });
        expect(instancesFromTitle("Kara 10er", "forever")).toEqual({ instanceIds: [], size: 0, versionId: "forever" });
        expect(instancesFromTitle("Kara 10er", "nope").versionId).toBe("tbc");
    });
});
