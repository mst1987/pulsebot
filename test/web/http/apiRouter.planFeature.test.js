// The router's plan check (`feature` on a route entry, docs/server-plans.md), through the real
// router and gate with a route table of its own: no real route carries a feature yet.
let mockUser = null;
let mockGuild = "g1";
const mockHandler = jest.fn(async (req, res) => {
    res.writeHead(200);
    res.end("{}");
});

jest.mock("../../../src/web/http/auth", () => ({ getUser: () => mockUser, checkCsrf: () => true }));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => mockGuild) }));
jest.mock("../../../src/config/plans", () => {
    const actual = jest.requireActual("../../../src/config/plans");
    return { ...actual, FEATURES: ["test"], PLANS: { ...actual.PLANS, none: { id: "none", features: [] }, some: { id: "some", features: ["test"] } } };
});
jest.mock("../../../src/web/http/routeTable", () => {
    const ROUTES = [
        { method: "GET", path: "/api/test/planned", handler: (...args) => mockHandler(...args), adminOnly: true, feature: "test" },
        { method: "GET", path: "/api/test/plain", handler: (...args) => mockHandler(...args), adminOnly: true },
    ];
    return {
        ROUTES,
        find: (method, path) => ROUTES.find((r) => r.method === method && r.path === path) || null,
        methodsFor: (path) => ROUTES.filter((r) => r.path === path).map((r) => r.method),
        areasOf: () => [],
        isOrgaScoped: () => false,
        isOrgaRead: () => false,
    };
});

const store = require("../../../src/stores/settings/serverPlanStore");
const { handle } = require("../../../src/web/http/apiRouter");
const { tempStoreFile } = require("../../helpers/tempStore");
const { mockRes, jsonRequest, status, body } = require("../../helpers/http");

const ADMIN = { id: "1", name: "Admin", isAdmin: true };

async function get(path) {
    const res = mockRes();
    await handle(path, jsonRequest("GET", path), res, new URL(`http://x${path}`));
    return res;
}

beforeEach(() => {
    mockHandler.mockClear();
    store.useFile(tempStoreFile("server-plans.json"));
    mockUser = ADMIN;
    mockGuild = "g1";
});
afterAll(() => store.useFile(null));

describe("apiRouter: routes behind a plan feature", () => {
    it("lets a server without an entry through", async () => {
        const res = await get("/api/test/planned");
        expect(status(res)).toBe(200);
        expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it("answers 403 plan_required on a plan without the feature, to a full admin too", async () => {
        store.setEntry("g1", { plan: "none", until: "", note: "" });
        const res = await get("/api/test/planned");
        expect(status(res)).toBe(403);
        expect(body(res).error.code).toBe("plan_required");
        expect(mockHandler).not.toHaveBeenCalled();
    });

    it("lets a plan with the feature through", async () => {
        store.setEntry("g1", { plan: "some", until: "", note: "" });
        expect(status(await get("/api/test/planned"))).toBe(200);
    });

    it("is free again once `until` has passed", async () => {
        store.setEntry("g1", { plan: "none", until: "2020-01-01", note: "" });
        expect(status(await get("/api/test/planned"))).toBe(200);
    });

    it("asks about the active server, not any other", async () => {
        store.setEntry("g1", { plan: "none", until: "", note: "" });
        mockGuild = "g2";
        expect(status(await get("/api/test/planned"))).toBe(200);
    });

    it("leaves a route without a feature alone", async () => {
        store.setEntry("g1", { plan: "none", until: "", note: "" });
        expect(status(await get("/api/test/plain"))).toBe(200);
    });

    it("keeps the rights first: a stranger learns nothing about the plan", async () => {
        store.setEntry("g1", { plan: "none", until: "", note: "" });
        mockUser = null;
        const res = await get("/api/test/planned");
        expect(status(res)).toBe(401);
        expect(mockHandler).not.toHaveBeenCalled();
    });
});
