// GET /api/ingest/council - the sync tool's council roster, through the real
// router. Same bearer-token auth as the uploads; no Discord session anywhere.
const { status, body, routerClient } = require("../../helpers/http");

jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => null),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../src/stores/ingestTokenStore", () => ({
    verifyToken: jest.fn(),
    touchToken: jest.fn(),
    bearerFrom: (req) => {
        const h = (req.headers && req.headers.authorization) || "";
        return h.startsWith("Bearer ") ? h.slice(7) : "";
    },
}));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({ categoryIds: ["c1", "c2"] })),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    listCategories: jest.fn(() => [{ id: "c1", name: "SSC/TK Mittwoch" }]),
}));
jest.mock("../../../src/web/loot/lootCouncil", () => ({
    ...jest.requireActual("../../../src/web/loot/lootCouncil"),
    councilRoster: jest.fn(),
}));

const { verifyToken, touchToken } = require("../../../src/stores/ingestTokenStore");
const { councilRoster } = require("../../../src/web/loot/lootCouncil");
const { getConfig } = require("../../../src/stores/settingsStore");
const ingest = require("../../../src/web/apiRoutes/ingest");

const { get, handle, urlFor } = routerClient(ingest);

/** A GET carrying an authorization header (routerClient's own get sends none). */
async function authed(path, query, authorization = "Bearer ehl_good") {
    const { mockRes } = require("../../helpers/http");
    const res = mockRes();
    await handle(path, { method: "GET", headers: authorization ? { authorization } : {} }, res, urlFor(path, query));
    return res;
}

const ROW = {
    key: "gemli", character: "Gemli", className: "Priest", specLabel: "Shadow", role: "caster",
    needScore: 0.5, needParts: { drought: 0.5, share: 0.5, need: 0.5 },
    lootCount: 0, lootTotal: 0, otherCount: 0, lastAwardAt: 0, daysSinceLoot: null,
    bis: { tier: "t6", source: "wowsims", owned: 0, total: 1, items: [{ id: 7, owned: false }] },
    items: [],
};

beforeEach(() => {
    jest.clearAllMocks();
    verifyToken.mockReturnValue({ id: "t1", name: "Raidlead-PC" });
    councilRoster.mockReturnValue({ rows: [ROW], avgLootCount: 0, bisTier: "t6" });
    getConfig.mockReturnValue({ categoryIds: ["c1", "c2"] });
});

describe("GET /api/ingest/council", () => {
    it("refuses a request without a token", async () => {
        const res = await get("/api/ingest/council");
        expect(status(res)).toBe(401);
        expect(body(res).error.code).toBe("no_token");
        expect(councilRoster).not.toHaveBeenCalled();
    });

    it("refuses an unknown token", async () => {
        verifyToken.mockReturnValue(null);
        const res = await authed("/api/ingest/council");
        expect(status(res)).toBe(401);
        expect(body(res).error.code).toBe("bad_token");
        expect(councilRoster).not.toHaveBeenCalled();
    });

    it("answers a valid token with the slim payload and records the use", async () => {
        const res = await authed("/api/ingest/council");
        expect(status(res)).toBe(200);
        expect(touchToken).toHaveBeenCalledWith("t1");
        const data = body(res);
        expect(data).toMatchObject({
            format: "eventhelper-council",
            version: 1,
            filter: { category: "", categoryName: "", role: "", bisTier: "t6", bisTierDerived: true },
            categories: [{ id: "c1", name: "SSC/TK Mittwoch" }, { id: "c2", name: "c2" }],
            weights: { drought: 45, share: 30, need: 10 },
        });
        expect(data.raiders).toHaveLength(1);
        expect(data.raiders[0]).toMatchObject({ character: "Gemli", classFile: "PRIEST", need: 50, daysSinceLoot: -1, bis: { missing: [7] } });
    });

    it("answers ?v=2 with every Loot-Council category (version 2), none here", async () => {
        const res = await authed("/api/ingest/council", { v: "2" });
        expect(status(res)).toBe(200);
        expect(body(res)).toMatchObject({ format: "eventhelper-council", version: 2, categories: [] });
        expect(councilRoster).not.toHaveBeenCalled();
    });

    it("builds a v2 entry per Loot-Council category with the raider key", async () => {
        getConfig.mockReturnValue({ categoryIds: ["c1", "c2"], categoryLootSystem: { c1: "lootcouncil" } });
        const res = await authed("/api/ingest/council", { v: "2" });
        const data = body(res);
        expect(data.categories.map((c) => [c.id, c.name])).toEqual([["c1", "SSC/TK Mittwoch"]]);
        expect(data.categories[0].raiders[0]).toMatchObject({ key: "gemli", character: "Gemli" });
        expect(councilRoster).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "c1" }));
    });

    it("answers ?v=3 with version 3: every role, status and the category's weighting (#670)", async () => {
        getConfig.mockReturnValue({ categoryIds: ["c1", "c2"], categoryLootSystem: { c1: "lootcouncil" } });
        councilRoster.mockReturnValue({
            rows: [ROW, { ...ROW, key: "hauer", character: "Hauer", className: "Warrior", specLabel: "Fury", role: "melee", status: "trial", lootPoints: 0 }],
            avgLootCount: 0, avgLootPoints: 0, bisTier: "t6",
        });
        const res = await authed("/api/ingest/council", { v: "3" });
        expect(status(res)).toBe(200);
        const data = body(res);
        expect(data).toMatchObject({ format: "eventhelper-council", version: 3, weights: { drought: 45, share: 30, need: 10, tenure: 15 } });
        expect(data.categories.map((c) => c.id)).toEqual(["c1"]);
        expect(data.categories[0].raiders.map((r) => [r.key, r.role, r.status])).toEqual([["gemli", "caster", ""], ["hauer", "melee", "trial"]]);
        expect(data.categories[0]).toHaveProperty("itemWeights.classes.trinket", 2);
        expect(data.categories[0]).toHaveProperty("itemClasses");
    });

    it("answers a higher version than it knows with version 3, and v=3 with a category with version 1", async () => {
        expect(body(await authed("/api/ingest/council", { v: "4" })).version).toBe(3);
        expect(body(await authed("/api/ingest/council", { v: "3", category: "c1" })).version).toBe(1);
    });

    it("passes category and role through to the roster", async () => {
        const res = await authed("/api/ingest/council", { category: "c1", role: "healer", tiers: "t5" });
        expect(councilRoster).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "c1", role: "healer", tierIds: [], bisTier: "" }));
        expect(body(res).filter).toMatchObject({ category: "c1", categoryName: "SSC/TK Mittwoch", role: "healer" });
    });
});
