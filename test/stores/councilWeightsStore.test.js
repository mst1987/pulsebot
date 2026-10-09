// The loot council's weighting store (#668): defaults, cleaning, a category's
// own settings replacing the server's as a whole, reset, and the need weights
// normalised to shares of 1.
const councilWeights = require("../../src/stores/councilWeightsStore");
const { tempStoreFile } = require("../helpers/tempStore");

beforeAll(() => councilWeights.useFile(tempStoreFile("council-weights.json")));
afterAll(() => councilWeights.useFile(null));
beforeEach(() => {
    councilWeights.resetWeights("");
    councilWeights.resetWeights("c1");
});

describe("stores/councilWeightsStore", () => {
    it("weighs like the issue's table when nothing is stored", () => {
        const w = councilWeights.weightsFor("");
        expect(w).toMatchObject({
            scope: "global",
            classes: { trinket: 2, bisWeapon: 2, weapon: 1.5, set: 1, normal: 1, frequent: 0.5 },
            items: {},
            need: { drought: 45, share: 30, need: 10, tenure: 15 },
            tenureDays: 90,
        });
        expect(councilWeights.globalWeights().stored).toBe(false);
    });

    it("cleans what it stores: clamps, a 0.1 grid, unknown fields and bad ids out", () => {
        const stored = councilWeights.setWeights("", {
            classes: { trinket: 7, weapon: 1.234, set: "x", bogus: 3 },
            items: { 30021: 1.5, 0: 2, "-4": 1, abc: 1, 28789: { weight: 0.25, name: "  Eye  " }, 31064: { weight: "nope" } },
            need: { drought: 150, share: -3, need: 10.6 },
            tenureDays: 2,
            extra: true,
        }, { by: "Admin", now: 5 });
        expect(stored.classes).toEqual({ trinket: 5, bisWeapon: 2, weapon: 1.2, set: 1, normal: 1, frequent: 0.5 });
        expect(stored.items).toEqual({ 30021: { weight: 1.5, name: "" }, 28789: { weight: 0.3, name: "Eye" } });
        expect(stored.need).toEqual({ drought: 100, share: 0, need: 11, tenure: 15 });
        expect(stored.tenureDays).toBe(7);
        expect(stored).toMatchObject({ at: 5, by: "Admin" });
        expect(stored.extra).toBeUndefined();
        expect(councilWeights.globalWeights().stored).toBe(true);
    });

    it("falls back to the default need weights when every one is zero", () => {
        const stored = councilWeights.setWeights("", { need: { drought: 0, share: 0, need: 0, tenure: 0 } });
        expect(stored.need).toEqual({ drought: 45, share: 30, need: 10, tenure: 15 });
    });

    it("keeps at most 200 item exceptions", () => {
        const items = {};
        for (let i = 1; i <= 250; i += 1) items[i] = 1;
        expect(Object.keys(councilWeights.setWeights("", { items }).items)).toHaveLength(200);
    });

    it("lets a category's own settings replace the server's as a whole", () => {
        councilWeights.setWeights("", { classes: { trinket: 3 }, tenureDays: 120 });
        councilWeights.setWeights("c1", { tenureDays: 30 });
        expect(councilWeights.weightsFor("c1")).toMatchObject({ scope: "category", tenureDays: 30, classes: { trinket: 2 } });
        expect(councilWeights.weightsFor("c2")).toMatchObject({ scope: "global", tenureDays: 120, classes: { trinket: 3 } });
        expect(councilWeights.categoryWeights("c2")).toBeNull();
        expect(councilWeights.categoryWeights("")).toBeNull();
    });

    it("resets a category to the server's and the server to the defaults", () => {
        councilWeights.setWeights("", { tenureDays: 120 });
        councilWeights.setWeights("c1", { tenureDays: 30 });
        councilWeights.resetWeights("c1");
        expect(councilWeights.weightsFor("c1")).toMatchObject({ scope: "global", tenureDays: 120 });
        councilWeights.resetWeights("");
        expect(councilWeights.weightsFor("c1").tenureDays).toBe(90);
    });

    it("normalises the need weights to shares of 1", () => {
        const shares = councilWeights.effectiveNeedWeights({ drought: 45, share: 30, need: 10, tenure: 15 });
        expect(shares).toEqual({ drought: 0.45, share: 0.3, need: 0.1, tenure: 0.15 });
        const doubled = councilWeights.effectiveNeedWeights({ drought: 90, share: 60, need: 20, tenure: 30 });
        expect(doubled.drought).toBeCloseTo(0.45, 10);
        expect(Object.values(councilWeights.effectiveNeedWeights({ drought: 1, share: 0, need: 0, tenure: 0 }))).toEqual([1, 0, 0, 0]);
    });

    it("reads an unreadable file as the defaults", () => {
        expect(councilWeights.normalizeSettings(null)).toMatchObject({ tenureDays: 90, items: {} });
        expect(councilWeights.defaults().need).toEqual(councilWeights.DEFAULTS.need);
    });
});
