// The query -> councilRoster() options shared by the council page and the sync endpoint.
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({ categoryIds: ["c1", "c2"] })),
}));
const mockGetRoster = jest.fn(() => null);
jest.mock("../../../src/stores/rosterStore", () => ({ getRoster: (...a) => mockGetRoster(...a) }));
jest.mock("../../../src/services/discord/discord", () => ({
    listCategories: jest.fn(() => [{ id: "c1", name: "SSC/TK Mittwoch" }]),
}));

const { listParam, categoryOptions, councilOptsFromQuery, pageCouncilOpts, pickVersion } = require("../../../src/web/loot/councilQuery");

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

describe("councilOptsFromQuery: the council's version without a roster (#748)", () => {
    const config = require("../../../src/stores/settingsStore").getConfig;
    afterEach(() => config.mockReturnValue({ categoryIds: ["c1", "c2"] }));

    it("follows an explicit content switch, but not \"all\"", () => {
        expect(councilOptsFromQuery(new URLSearchParams("version=forever")).versionId).toBe("forever");
        expect(councilOptsFromQuery(new URLSearchParams("version=all")).versionId).toBe("tbc");
        expect(councilOptsFromQuery(new URLSearchParams("")).versionId).toBe("tbc");
    });

    it("lets a category with its own version win over the switch", () => {
        config.mockReturnValue({ categoryIds: ["c1"], categoryVersion: { c1: "forever" } });
        expect(councilOptsFromQuery(new URLSearchParams("category=c1&version=tbc")).versionId).toBe("forever");
        expect(councilOptsFromQuery(new URLSearchParams("category=c2&version=tbc")).versionId).toBe("tbc");
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

// The menu's version comes first on the page (#741/#563): a TBC roster or a TBC
// category is no pick of the Forever council - not in the list, not in the answer.
describe("version of a pick and the page's options", () => {
    const { getConfig } = require("../../../src/stores/settingsStore");
    const CONFIG = { categoryIds: ["c1", "c2", "c3"], mainVersion: "forever", categoryVersion: { c1: "tbc", c2: "forever" } };
    beforeEach(() => {
        getConfig.mockReturnValue(CONFIG);
        mockGetRoster.mockImplementation((id) => ({
            tbcRoster: { id: "tbcRoster", guildId: "g1", categoryId: "c1", versionId: "tbc" },
            foreverRoster: { id: "foreverRoster", guildId: "g1", categoryId: "c2", versionId: "forever" },
        }[id] || null));
    });
    afterEach(() => {
        getConfig.mockReturnValue({ categoryIds: ["c1", "c2"] });
        mockGetRoster.mockReset();
        mockGetRoster.mockReturnValue(null);
    });

    it("pickVersion: a roster its stored version, a category its own or the main version", () => {
        expect(pickVersion({ roster: { versionId: "forever" } })).toBe("forever");
        expect(pickVersion({ roster: { versionId: "" } })).toBe("tbc");
        expect(pickVersion({ categoryId: "c1", config: CONFIG })).toBe("tbc");
        expect(pickVersion({ categoryId: "c3", config: CONFIG })).toBe("forever");
    });

    it("categoryOptions with a version lists only the categories that play it", () => {
        expect(categoryOptions("g1", { versionId: "forever", config: CONFIG }).map((c) => c.id)).toEqual(["c2", "c3"]);
        expect(categoryOptions("g1", { versionId: "tbc", config: CONFIG }).map((c) => c.id)).toEqual(["c1"]);
        expect(categoryOptions("g1", { config: CONFIG }).map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    });

    it("keeps a pick of the page's version", () => {
        expect(pageCouncilOpts(new URLSearchParams("roster=foreverRoster&version=forever"), { guildId: "g1" }))
            .toMatchObject({ rosterId: "foreverRoster", categoryId: "c2", versionId: "forever", charVersion: "forever" });
        expect(pageCouncilOpts(new URLSearchParams("category=c1&version=tbc"))).toMatchObject({ categoryId: "c1", versionId: "tbc" });
        expect(pageCouncilOpts(new URLSearchParams("category=c1&version=tbc")).droppedPick).toBeUndefined();
    });

    it("drops a roster or a category of another version and names it", () => {
        const roster = pageCouncilOpts(new URLSearchParams("roster=tbcRoster&version=forever"), { guildId: "g1" });
        expect(roster).toMatchObject({ rosterId: "", categoryId: "", versionId: "forever", charVersion: "forever" });
        expect(roster.droppedPick).toEqual({ kind: "roster", id: "tbcRoster", versionId: "tbc" });
        // the menu sends nothing: the main version (Forever) decides
        const category = pageCouncilOpts(new URLSearchParams("category=c1"));
        expect(category).toMatchObject({ categoryId: "", versionId: "forever" });
        expect(category.droppedPick).toEqual({ kind: "category", id: "c1", versionId: "tbc" });
    });

    it("drops a pick of a hidden version even when the url asks for that version", () => {
        getConfig.mockReturnValue({ ...CONFIG, hideOtherVersions: true });
        const opts = pageCouncilOpts(new URLSearchParams("roster=tbcRoster&version=tbc"), { guildId: "g1" });
        expect(opts).toMatchObject({ rosterId: "", versionId: "forever", charVersion: "forever" });
        expect(opts.droppedPick).toEqual({ kind: "roster", id: "tbcRoster", versionId: "tbc" });
    });

    it("leaves the sync tool's reading alone: councilOptsFromQuery keeps the pick", () => {
        expect(councilOptsFromQuery(new URLSearchParams("category=c1"))).toMatchObject({ categoryId: "c1", versionId: "tbc" });
    });
});
