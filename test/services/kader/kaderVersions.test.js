// The versions the Kaderplaner holds Kader for, the only thing the content switch reads of it.
let mockPlanners = {};
let mockFail = false;

jest.mock("../../../src/stores/roster/kaderStore", () => ({
    plannerGuildKeys: () => {
        if (mockFail) throw new Error("unreadable");
        return Object.keys(mockPlanners);
    },
    readPlanner: (guildId) => mockPlanners[guildId],
}));

const { kaderVersionIds } = require("../../../src/services/kader/kaderVersions");

beforeEach(() => {
    mockPlanners = {};
    mockFail = false;
});

describe("kaderVersionIds", () => {
    it("names every Kader's version once, across servers", () => {
        mockPlanners = {
            g1: { kaders: [{ id: "k1", versionId: "forever" }, { id: "k2", versionId: "tbc" }] },
            g2: { kaders: [{ id: "k3", versionId: "forever" }] },
        };
        expect(kaderVersionIds().sort()).toEqual(["forever", "tbc"]);
    });

    it("counts a Kader without a known version as the planner's own (Forever)", () => {
        mockPlanners = { g1: { kaders: [{ id: "k1" }, { id: "k2", versionId: "nope" }] } };
        expect(kaderVersionIds()).toEqual(["forever"]);
    });

    it("is empty without Kader or when the file cannot be read", () => {
        mockPlanners = { g1: { kaders: [] }, g2: {} };
        expect(kaderVersionIds()).toEqual([]);
        mockFail = true;
        expect(kaderVersionIds()).toEqual([]);
    });

    it("hands out version ids only", () => {
        mockPlanners = { g1: { kaders: [{ id: "k1", name: "Main", versionId: "forever", players: { u1: { note: "secret" } } }] } };
        expect(JSON.stringify(kaderVersionIds())).toBe("[\"forever\"]");
    });
});
