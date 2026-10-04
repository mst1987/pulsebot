const { PLANNING_MODES, normalizeCategoryPlanning, planningOf, planningRefusal } = require("../../../src/services/events/planning");

describe("services/events/planning", () => {
    it("knows exactly two modes", () => {
        expect(PLANNING_MODES).toEqual(["raidplan", "sheet"]);
    });

    describe("normalizeCategoryPlanning", () => {
        it("keeps known modes under trimmed ids and drops everything else", () => {
            expect(normalizeCategoryPlanning({ " a ": "sheet", b: "raidplan", c: "both", d: null, "": "sheet" })).toEqual({ a: "sheet", b: "raidplan" });
        });

        it("reads anything that is no map as empty", () => {
            expect(normalizeCategoryPlanning(null)).toEqual({});
            expect(normalizeCategoryPlanning(["sheet"])).toEqual({});
            expect(normalizeCategoryPlanning("sheet")).toEqual({});
        });
    });

    describe("planningOf", () => {
        const config = {
            categoryPlanning: { picked: "raidplan", sheetPicked: "sheet" },
            categorySheets: { picked: { url: "https://fix", name: "Fix" }, fixed: { url: "https://fixed", name: "" }, empty: { url: "", name: "x" } },
        };

        it("takes the stored mode first, even over a fixed sheet", () => {
            expect(planningOf("picked", config)).toBe("raidplan");
            expect(planningOf(" sheetPicked ", config)).toBe("sheet");
        });

        it("defaults to the sheet for a category with a fixed sheet, else to the raid plan", () => {
            expect(planningOf("fixed", config)).toBe("sheet");
            expect(planningOf("empty", config)).toBe("raidplan");
            expect(planningOf("unknown", config)).toBe("raidplan");
        });

        it("plans an event without a category with the raid plan", () => {
            expect(planningOf("", config)).toBe("raidplan");
            expect(planningOf(undefined, config)).toBe("raidplan");
            expect(planningOf("fixed", undefined)).toBe("raidplan");
        });

        it("ignores an unknown stored value and falls back to the default", () => {
            expect(planningOf("fixed", { categoryPlanning: { fixed: "nope" }, categorySheets: config.categorySheets })).toBe("sheet");
        });
    });

    describe("planningRefusal", () => {
        const config = { categoryPlanning: { rp: "raidplan", sh: "sheet" }, categorySheets: {} };

        it("lets the matching action through", () => {
            expect(planningRefusal("sheet", "sh", config)).toBeNull();
            expect(planningRefusal("raidplan", "rp", config)).toBeNull();
        });

        it("refuses the other one with a German 409", () => {
            expect(planningRefusal("sheet", "rp", config)).toEqual({ status: 409, code: "planning_mismatch", message: expect.stringContaining("plant mit dem Raidplan") });
            expect(planningRefusal("raidplan", "sh", config)).toEqual({ status: 409, code: "planning_mismatch", message: expect.stringContaining("plant mit einem Google-Sheet") });
        });
    });
});
