// The plan table (Alle Server > Einstellungen): full admins only, others learn nothing.
let mockUser = null;

jest.mock("../../../../src/web/http/auth", () => ({ getUser: () => mockUser, checkCsrf: () => true }));
jest.mock("../../../../src/services/discord/discord", () => ({
    listGuilds: jest.fn(() => [{ id: "g1", name: "Eins" }, { id: "g2", name: "Zwei" }]),
}));
jest.mock("../../../../src/services/discord/roles/guildRoles", () => ({ serverLabel: jest.fn((id) => (id === "g1" ? "Kurz" : "")) }));
jest.mock("../../../../src/config/plans", () => {
    const actual = jest.requireActual("../../../../src/config/plans");
    return { ...actual, PLANS: { ...actual.PLANS, none: { id: "none", features: [] } } };
});

const route = require("../../../../src/web/apiRoutes/system/serverPlans");
const store = require("../../../../src/stores/settings/serverPlanStore");
const { emptyAccess } = require("../../../../src/config/permissions");
const { routerClient, status, body } = require("../../../helpers/http");
const { tempStoreFile } = require("../../../helpers/tempStore");

const { get, request } = routerClient(route);
const ADMIN = { id: "1", name: "Admin", isAdmin: true };
const SETTINGS_USER = { id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), settings: { read: true, write: true } } };
const PATH = "/api/settings/server-plans";

beforeEach(() => {
    store.useFile(tempStoreFile("server-plans.json"));
    mockUser = ADMIN;
});
afterAll(() => store.useFile(null));

describe("GET /api/settings/server-plans", () => {
    it("lists the plans and every server for a full admin", async () => {
        const res = await get(PATH);
        expect(status(res)).toBe(200);
        const { plans, servers, maxNote } = body(res);
        expect(plans).toEqual(["free", "none"]);
        expect(maxNote).toBeGreaterThan(0);
        expect(servers.map((s) => [s.guildId, s.name, s.plan])).toEqual([["g1", "Kurz", "free"], ["g2", "Zwei", "free"]]);
    });

    it("is closed to everyone else, even with the settings right", async () => {
        mockUser = SETTINGS_USER;
        expect(status(await get(PATH))).toBe(403);
        mockUser = null;
        expect(status(await get(PATH))).toBe(401);
    });
});

describe("PUT /api/settings/server-plans", () => {
    it("saves a plan and answers with the fresh table", async () => {
        const res = await request("PUT", PATH, { guildId: "g1", plan: "none", until: "2027-01-31", note: "Test" });
        expect(status(res)).toBe(200);
        expect(store.getEntry("g1")).toEqual({ plan: "none", until: "2027-01-31", note: "Test" });
        expect(body(res).servers[0]).toMatchObject({ guildId: "g1", plan: "none", note: "Test" });
    });

    it("is refused for someone who is not a full admin, and saves nothing", async () => {
        mockUser = SETTINGS_USER;
        expect(status(await request("PUT", PATH, { guildId: "g1", plan: "none" }))).toBe(403);
        expect(store.getEntry("g1")).toBeNull();
    });

    it("refuses a server the bot does not know", async () => {
        const res = await request("PUT", PATH, { guildId: "g9", plan: "none" });
        expect(status(res)).toBe(400);
        expect(body(res).error.code).toBe("unknown_guild");
    });

    it("passes on the service's refusal", async () => {
        const res = await request("PUT", PATH, { guildId: "g1", plan: "gone" });
        expect(status(res)).toBe(400);
        expect(body(res).error.code).toBe("unknown_plan");
    });
});
