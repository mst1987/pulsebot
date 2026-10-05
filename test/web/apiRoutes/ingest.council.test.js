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
            weights: { drought: 50, share: 40, need: 10 },
        });
        expect(data.raiders).toHaveLength(1);
        expect(data.raiders[0]).toMatchObject({ character: "Gemli", classFile: "PRIEST", need: 50, daysSinceLoot: -1, bis: { missing: [7] } });
    });

    it("passes category and role through to the roster", async () => {
        const res = await authed("/api/ingest/council", { category: "c1", role: "healer", tiers: "t5" });
        expect(councilRoster).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "c1", role: "healer", tierIds: [], bisTier: "" }));
        expect(body(res).filter).toMatchObject({ category: "c1", categoryName: "SSC/TK Mittwoch", role: "healer" });
    });
});
