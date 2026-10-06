// The query -> councilRoster() options shared by the council page and the sync endpoint.
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({ categoryIds: ["c1", "c2"] })),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    listCategories: jest.fn(() => [{ id: "c1", name: "SSC/TK Mittwoch" }]),
}));

const { listParam, categoryOptions, councilOptsFromQuery } = require("../../../src/web/loot/councilQuery");

describe("listParam", () => {
    it("splits a comma list and drops blanks", () => {
        expect(listParam(new URLSearchParams("tiers=t5, t6,,"), "tiers")).toEqual(["t5", "t6"]);
        expect(listParam(new URLSearchParams(""), "tiers")).toEqual([]);
    });
});

describe("categoryOptions", () => {
    it("names the configured categories, falling back to the id", () => {
        expect(categoryOptions("g1")).toEqual([{ id: "c1", name: "SSC/TK Mittwoch" }, { id: "c2", name: "c2" }]);
    });
});

describe("councilOptsFromQuery", () => {
    it("reads role, tiers, contents, category and bisTier", () => {
        const opts = councilOptsFromQuery(new URLSearchParams("role=healer&tiers=t5,t6&contents=ssc&category=c1&bisTier=t6"));
        expect(opts).toMatchObject({ role: "healer", tierIds: ["t5", "t6"], contentIds: ["ssc"], categoryId: "c1", bisTier: "t6" });
        expect(typeof opts.versionId).toBe("string");
        expect(opts.versionId).not.toBe("");
    });

    it("defaults everything to unfiltered", () => {
        expect(councilOptsFromQuery(new URLSearchParams(""))).toMatchObject({
            role: "", tierIds: [], contentIds: [], categoryId: "", bisTier: "",
        });
    });
});
