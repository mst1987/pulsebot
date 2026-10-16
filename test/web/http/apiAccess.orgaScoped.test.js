// The area gate for `orgaScoped` routes (#724), through the real router (apiRouter.handle) and the
// real rule (services/roster/categoryOrga.js): the orga of a category gets past the area gate of such
// a route, the handler then checks the concrete event. No real route is marked yet (#725-#728 do
// that), so one route module gets a test route built with withUser({ orgaScoped }).
const { json: sent, status } = require("../../helpers/http");
const { routerClient } = require("../../helpers/http");

let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    checkCsrf: jest.fn(() => true),
}));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../src/stores/rosterStore", () => {
    const actual = jest.requireActual("../../../src/stores/rosterStore");
    const roster = { id: "r1", categoryId: "cat1", versionId: "tbc", guildId: "g1", managers: { userIds: ["mgr"], roleIds: ["role-mgr"] } };
    return { ...actual, listRosters: jest.fn(() => [roster]), rosterForCategory: jest.fn((cat) => (cat === "cat1" ? roster : null)) };
});
jest.mock("../../../src/services/events/mainVersion", () => ({
    ...jest.requireActual("../../../src/services/events/mainVersion"),
    versionOfEvent: jest.fn(() => "tbc"),
    mainVersionFor: jest.fn(() => "tbc"),
    knownVersion: jest.fn((v) => v || ""),
}));
jest.mock("../../../src/stores/raidEventStore", () => ({
    ...jest.requireActual("../../../src/stores/raidEventStore"),
    getRaidEvent: jest.fn((id) => ({ rh1: { categoryId: "cat1" }, rh2: { categoryId: "cat2" } }[id] || null)),
}));
const mockMemberRoleIds = jest.fn(async () => []);
jest.mock("../../../src/services/discord/discord", () => ({
    ...jest.requireActual("../../../src/services/discord/discord"),
    memberRoleIds: (...a) => mockMemberRoleIds(...a),
}));
const mockHandlerRan = jest.fn();
jest.mock("../../../src/web/apiRoutes/orgaHub", () => {
    const actual = jest.requireActual("../../../src/web/apiRoutes/orgaHub");
    const { withUser } = jest.requireActual("../../../src/web/http/apiHandler");
    const scoped = withUser({ orgaScoped: (body) => body.event, write: "raids", csrf: true, body: true }, ({ body, res }) => {
        mockHandlerRan(body.event);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
    });
    const plain = withUser({ orga: true, write: "raids", csrf: true, body: true }, ({ res }) => res.end("{}"));
    return {
        routes: [
            ...actual.routes,
            { method: "POST", path: "/api/test/orga-scoped", handler: scoped, area: "raids" },
            { method: "POST", path: "/api/test/orga-plain", handler: plain, area: "raids" },
        ],
    };
});

const { emptyAccess } = require("../../../src/config/permissions");
const { gate } = require("../../../src/web/http/apiAccess");
const { find, isOrgaScoped } = require("../../../src/web/http/routeTable");

const { post } = routerClient();
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
        // an orga role without `raids` write: the gate does not widen for them (orga: true does not either)
        expect(await gate("/api/test/orga-scoped", "POST", user("o", raiderGrants, { isOrga: true }), {})).toMatchObject({ code: "forbidden" });
        expect(await gate("/api/test/orga-scoped", "POST", { id: "a", isAdmin: true }, {})).toBeNull();
        // no menu access at all stays refused, manager or not
        expect(await gate("/api/test/orga-scoped", "POST", user("mgr"), {})).toMatchObject({ code: "forbidden" });
    });

    it("lets a full admin through the router to any raid", async () => {
        mockUser = { id: "a", isAdmin: true };
        const res = await post("/api/test/orga-scoped", { event: "rh2" });
        expect(status(res)).toBe(200);
    });
});
