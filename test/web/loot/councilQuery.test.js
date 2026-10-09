// The query -> councilRoster() options shared by the council page and the sync endpoint.
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({ categoryIds: ["c1", "c2"] })),
}));
const mockGetRoster = jest.fn(() => null);
jest.mock("../../../src/stores/rosterStore", () => ({ getRoster: (...a) => mockGetRoster(...a) }));
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

describe("councilOptsFromQuery with a roster (#676)", () => {
    it("takes category, id and version from the roster - with or without category", () => {
        mockGetRoster.mockImplementation((id) => ({
            r1: { id: "r1", guildId: "g1", categoryId: "c2", versionId: "forever" },
            r2: { id: "r2", guildId: "g1", categoryId: null, versionId: "tbc" },
            r3: { id: "r3", guildId: "g2", categoryId: "c9", versionId: "tbc" },
        }[id] || null));
        expect(councilOptsFromQuery(new URLSearchParams("roster=r1&category=c1"), { guildId: "g1" })).toMatchObject({ rosterId: "r1", categoryId: "c2", versionId: "forever" });
        expect(councilOptsFromQuery(new URLSearchParams("roster=r2"))).toMatchObject({ rosterId: "r2", categoryId: "" });
        // another server's roster, or an unknown one, is ignored: the category of the query counts
        expect(councilOptsFromQuery(new URLSearchParams("roster=r3&category=c1"), { guildId: "g1" })).toMatchObject({ rosterId: "", categoryId: "c1" });
        expect(councilOptsFromQuery(new URLSearchParams("roster=nope"))).toMatchObject({ rosterId: "", categoryId: "" });
        mockGetRoster.mockReset();
        mockGetRoster.mockReturnValue(null);
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
            role: "", tierIds: [], contentIds: [], categoryId: "", bisTier: "", showBench: false,
        });
    });

    it("shows Ersatz from the roster only when the page asks for it (bench=1, #667)", () => {
        expect(councilOptsFromQuery(new URLSearchParams("category=c1&bench=1")).showBench).toBe(true);
        expect(councilOptsFromQuery(new URLSearchParams("category=c1&bench=0")).showBench).toBe(false);
    });
});
