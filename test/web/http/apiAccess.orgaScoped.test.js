// The area gate for `orgaScoped` routes (#724), through the real router (apiRouter.handle) and the
// real rule (services/roster/categoryOrga.js): the orga of a category gets past the area gate of such
// a route, the handler then checks the concrete event. The real routes have their own tests (the
// setup editor: test/web/apiRoutes/events/setup.categoryOrga.test.js, #725); here one route module gets test
// routes built with withUser({ orgaScoped }), to pin the gate itself.
const { json: sent, status } = require("../../helpers/http");
const { routerClient } = require("../../helpers/http");

let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    checkCsrf: jest.fn(() => true),
}));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
// the server of a raid is eventServer.test's / apiHandler.server.test's matter (#925): every raid here is on g1
jest.mock("../../../src/services/events/eventServer", () => ({
    allOnServer: jest.fn(() => true), serverOfEntry: jest.fn(() => "g1"), guildOfCategory: jest.fn(() => "g1"), liveGuildOf: jest.fn(() => "g1"),
}));
jest.mock("../../../src/stores/roster/rosterStore", () => {
    const actual = jest.requireActual("../../../src/stores/roster/rosterStore");
    const roster = { id: "r1", categoryId: "cat1", versionId: "tbc", guildId: "g1", managers: { userIds: ["mgr"], roleIds: ["role-mgr"] } };
    return { ...actual, listRosters: jest.fn(() => [roster]), rosterForCategory: jest.fn((cat) => (cat === "cat1" ? roster : null)) };
});
jest.mock("../../../src/services/versions/mainVersion", () => ({
    ...jest.requireActual("../../../src/services/versions/mainVersion"),
    versionOfEvent: jest.fn(() => "tbc"),
    mainVersionFor: jest.fn(() => "tbc"),
    knownVersion: jest.fn((v) => v || ""),
}));
jest.mock("../../../src/stores/events/raidEventStore", () => ({
    ...jest.requireActual("../../../src/stores/events/raidEventStore"),
    getRaidEvent: jest.fn((id) => ({ rh1: { categoryId: "cat1" }, rh2: { categoryId: "cat2" } }[id] || null)),
}));
const mockMemberRoleIds = jest.fn(async () => []);
jest.mock("../../../src/services/discord/discord", () => ({
    ...jest.requireActual("../../../src/services/discord/discord"),
    memberRoleIds: (...a) => mockMemberRoleIds(...a),
}));
const mockHandlerRan = jest.fn();
jest.mock("../../../src/web/apiRoutes/discord/orgaHub", () => {
    const actual = jest.requireActual("../../../src/web/apiRoutes/discord/orgaHub");
    const { withUser } = jest.requireActual("../../../src/web/http/apiHandler");
    const scoped = withUser({ orgaScoped: (body) => body.event, write: "raids", csrf: true, body: true }, ({ body, res }) => {
        mockHandlerRan(body.event);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
    });
    const plain = withUser({ orga: true, write: "raids", csrf: true, body: true }, ({ res }) => res.end("{}"));
    // no `write` on the wrapper: only the area gate (raids at write level for a POST) guards it
    const areaOnly = withUser({ orgaScoped: (body) => body.event, csrf: true, body: true }, ({ body, res }) => {
        mockHandlerRan(body.event);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
    });
    const adminOnly = withUser({ orgaScoped: (body) => body.event, csrf: true, body: true }, ({ res }) => res.end("{}"));
    // #729: a read of one raid - the area as always, a manager for their raids
    const read = withUser({ orgaRead: (body, query) => query.get("event") }, ({ query, res }) => {
        mockHandlerRan(query.get("event"));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
    });
    return {
        routes: [
            ...actual.routes,
            { method: "GET", path: "/api/test/orga-read", handler: read, area: "raidplan" },
            // the same handler on a write method: the read mark never widens a write
            { method: "POST", path: "/api/test/orga-read", handler: read, area: "raidplan" },
            { method: "POST", path: "/api/test/orga-scoped", handler: scoped, area: "raids" },
            { method: "POST", path: "/api/test/orga-plain", handler: plain, area: "raids" },
            { method: "POST", path: "/api/test/orga-area", handler: areaOnly, area: "raids" },
            { method: "POST", path: "/api/test/orga-admin", handler: adminOnly, adminOnly: true },
        ],
    };
});

const { emptyAccess } = require("../../../src/config/permissions");
const { gate } = require("../../../src/web/http/apiAccess");
const { find, isOrgaScoped, isOrgaRead } = require("../../../src/web/http/routeTable");

const { post, get } = routerClient();
const user = (id, grants = {}, extra = {}) => ({ id, isAdmin: false, access: { ...emptyAccess(), ...grants }, ...extra });
// a raider with a menu area, but no right on `raids`
const raiderGrants = { signup: { read: true, write: true } };

beforeEach(() => {
    jest.clearAllMocks();
    mockMemberRoleIds.mockResolvedValue([]);
});

describe("web/http/apiAccess gate (orgaScoped)", () => {
    it("sees the mark of a withUser({ orgaScoped }) handler", () => {
        expect(isOrgaScoped(find("POST", "/api/test/orga-scoped"))).toBe(true);
        expect(isOrgaScoped(find("POST", "/api/test/orga-plain"))).toBe(false);
        expect(isOrgaScoped(null)).toBe(false);
    });

    it("lets the manager of a category in for a raid of that category, without `raids` write", async () => {
        mockUser = user("mgr", raiderGrants);
        const res = await post("/api/test/orga-scoped", { event: "rh1" });
        expect(status(res)).toBe(200);
        expect(mockHandlerRan).toHaveBeenCalledWith("rh1");
    });

    it("lets a manager by role in, reading their roles once for gate and handler", async () => {
        mockUser = user("x", raiderGrants);
        mockMemberRoleIds.mockResolvedValue(["role-mgr"]);
        const res = await post("/api/test/orga-scoped", { event: "rh1" });
        expect(status(res)).toBe(200);
        expect(mockMemberRoleIds).toHaveBeenCalledTimes(1);
    });

    it("refuses the manager for a raid of another category with not_category_orga", async () => {
        mockUser = user("mgr", raiderGrants);
        const res = await post("/api/test/orga-scoped", { event: "rh2" });
        expect(status(res)).toBe(403);
        expect(sent(res).error.code).toBe("not_category_orga");
        expect(mockHandlerRan).not.toHaveBeenCalled();
    });

    it("keeps the area refusal for who manages no roster, and on a route without the mark", async () => {
        mockUser = user("nobody", raiderGrants);
        let res = await post("/api/test/orga-scoped", { event: "rh1" });
        expect(status(res)).toBe(403);
        expect(sent(res).error.code).toBe("forbidden");

        mockUser = user("mgr", raiderGrants);
        res = await post("/api/test/orga-plain", { event: "rh1" });
        expect(status(res)).toBe(403);
        expect(sent(res).error.code).toBe("forbidden");
        expect(mockHandlerRan).not.toHaveBeenCalled();
    });

    it("answers the global orga and the anonymous caller exactly as checkAccess does", async () => {
        expect(await gate("/api/test/orga-scoped", "POST", null, {})).toMatchObject({ status: 401 });
        // an orga role without `raids` write that manages no roster: the gate does not widen for them
        expect(await gate("/api/test/orga-scoped", "POST", user("o", raiderGrants, { isOrga: true }), {})).toMatchObject({ code: "forbidden" });
        expect(await gate("/api/test/orga-scoped", "POST", { id: "a", isAdmin: true }, {})).toBeNull();
        // no menu access at all stays refused, manager or not
        expect(await gate("/api/test/orga-scoped", "POST", user("mgr"), {})).toMatchObject({ code: "forbidden" });
    });

    it("gives a global orga without `raids` write at least what a manager gets (#724 review)", async () => {
        // an orga role with `raids` read only that manages the roster of cat1
        mockUser = user("mgr", { raids: { read: true, write: false } }, { isOrga: true });
        let res = await post("/api/test/orga-scoped", { event: "rh1" });
        expect(status(res)).toBe(200);
        res = await post("/api/test/orga-scoped", { event: "rh2" });
        expect(sent(res).error.code).toBe("not_category_orga");
        // the area alone missing (no write on the wrapper): the gate's category path holds in the handler
        res = await post("/api/test/orga-area", { event: "rh1" });
        expect(status(res)).toBe(200);
        res = await post("/api/test/orga-area", { event: "rh2" });
        expect(sent(res).error.code).toBe("not_category_orga");
        expect(mockHandlerRan.mock.calls).toEqual([["rh1"], ["rh1"]]);
    });

    it("never opens an adminOnly route, marked or not", async () => {
        mockUser = user("mgr", raiderGrants);
        const res = await post("/api/test/orga-admin", { event: "rh1" });
        expect(status(res)).toBe(403);
        expect(sent(res).error.code).toBe("forbidden");
    });

    it("lets a full admin through the router to any raid", async () => {
        mockUser = { id: "a", isAdmin: true };
        const res = await post("/api/test/orga-scoped", { event: "rh2" });
        expect(status(res)).toBe(200);
    });
});

describe("web/http/apiAccess gate (orgaRead, #729)", () => {
    it("sees the mark of a withUser({ orgaRead }) handler", () => {
        expect(isOrgaRead(find("GET", "/api/test/orga-read"))).toBe(true);
        expect(isOrgaRead(find("POST", "/api/test/orga-scoped"))).toBe(false);
        expect(isOrgaRead(null)).toBe(false);
    });

    it("lets a manager without the area read a raid of their category, not another one", async () => {
        mockUser = user("mgr", raiderGrants);
        let res = await get("/api/test/orga-read", { event: "rh1" });
        expect(status(res)).toBe(200);
        res = await get("/api/test/orga-read", { event: "rh2" });
        expect([status(res), sent(res).error.code]).toEqual([403, "not_category_orga"]);
        // naming no raid refuses too
        res = await get("/api/test/orga-read", {});
        expect(sent(res).error.code).toBe("not_category_orga");
        expect(mockHandlerRan.mock.calls).toEqual([["rh1"]]);
    });

    it("keeps whoever holds the area as before: every raid, no roster asked", async () => {
        mockUser = user("reader", { raidplan: { read: true, write: false } });
        expect(status(await get("/api/test/orga-read", { event: "rh2" }))).toBe(200);
        expect(mockMemberRoleIds).not.toHaveBeenCalled();
    });

    it("keeps the area refusal for who manages no roster, and never widens a write", async () => {
        mockUser = user("nobody", raiderGrants);
        expect(sent(await get("/api/test/orga-read", { event: "rh1" })).error.code).toBe("forbidden");
        mockUser = user("mgr", raiderGrants);
        const res = await post("/api/test/orga-read", { event: "rh1" });
        expect([status(res), sent(res).error.code]).toEqual([403, "forbidden"]);
        expect(mockHandlerRan).not.toHaveBeenCalled();
    });
});
