// Mock fs with an in-memory store so tests never touch the repo's disk.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { getSetupLoot, saveSetupLoot } = require("../../../src/stores/loot/setupLootStore.js");

beforeEach(() => {
    fs.__store.clear();
    jest.useRealTimers();
});

describe("stores/loot/setupLootStore (#1037)", () => {
    it("returns null when nothing is stored", () => {
        expect(getSetupLoot("ev1")).toBeNull();
        expect(getSetupLoot("")).toBeNull();
        expect(saveSetupLoot("", {})).toBeNull();
    });

    it("saves a snapshot with sorted instances and numeric counts", () => {
        saveSetupLoot("ev1", {
            versionId: "tbc", instanceIds: ["kara", "gruul"],
            wants: { u1: { a: { items: [{ itemId: 1, weight: 1 }], source: "softres" } } },
            items: { 1: { name: "X", icon: "i" } },
            counts: { signups: "50", gear: 31 },
        });
        const got = getSetupLoot("ev1");
        expect(got.instanceIds).toEqual(["gruul", "kara"]);
        expect(got.counts).toEqual({ signups: 50, gear: 31, softres: 0, bis: 0, spec: 0 });
        expect(got.wants.u1.a.source).toBe("softres");
        expect(got.at).toEqual(expect.any(Number));
    });

    it("replaces the snapshot of the same group and drops ones older than 30 days", () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-10-01T00:00:00Z"));
        saveSetupLoot("old", { versionId: "tbc" });
        saveSetupLoot("ev1", { versionId: "tbc" });
        jest.setSystemTime(new Date("2026-10-20T00:00:00Z"));
        saveSetupLoot("ev1", { versionId: "forever" });
        expect(getSetupLoot("ev1").versionId).toBe("forever");
        expect(getSetupLoot("old")).not.toBeNull();
        jest.setSystemTime(new Date("2026-11-05T00:00:00Z"));
        saveSetupLoot("ev2", {});
        expect(getSetupLoot("old")).toBeNull();
        expect(getSetupLoot("ev1")).not.toBeNull();
    });
});
