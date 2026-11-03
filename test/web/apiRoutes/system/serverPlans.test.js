// The plan table (Alle Server > Einstellungen): full admins only, others learn nothing.
let mockUser = null;
let mockCsrf = true;
let mockOnline = true;
let mockUnavailable = [];

jest.mock("../../../../src/web/http/auth", () => ({ getUser: () => mockUser, checkCsrf: () => mockCsrf }));
jest.mock("../../../../src/services/discord/discord", () => {
    const cached = (id) => id === "g1" || id === "g2";
    return {
        listGuilds: jest.fn(() => [{ id: "g1", name: "Eins" }, { id: "g2", name: "Zwei" }]),
        isOnline: () => mockOnline,
        getGuild: (id) => (cached(id) ? { id } : null),
        isGuildAvailable: (id) => cached(id) && !mockUnavailable.includes(id),
    };
});
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
    mockCsrf = true;
    mockOnline = true;
    mockUnavailable = [];
});
afterAll(() => store.useFile(null));

const stateOf = (res, guildId) => body(res).servers.find((s) => s.guildId === guildId).state;

describe("GET /api/settings/server-plans", () => {
    it("lists the plans and every server for a full admin", async () => {
        const res = await get(PATH);
        expect(status(res)).toBe(200);
        const { plans, servers, maxNote } = body(res);
        expect(plans).toEqual(["free", "none"]);
        expect(maxNote).toBeGreaterThan(0);
        expect(servers.map((s) => [s.guildId, s.name, s.plan])).toEqual([["g1", "Kurz", "free"], ["g2", "Zwei", "free"]]);
    });

    it("marks a server as gone only when the bot is online and no longer has it", async () => {
        store.setEntry("g9", { plan: "none", until: "", note: "" });
        const res = await get(PATH);
        expect(stateOf(res, "g1")).toBe("known");
        expect(stateOf(res, "g9")).toBe("gone");
    });

    it("says unknown, not gone, for every server while the bot is offline", async () => {
        store.setEntry("g9", { plan: "none", until: "", note: "" });
        mockOnline = false;
        const res = await get(PATH);
        expect(stateOf(res, "g9")).toBe("unknown");
        expect(stateOf(res, "g1")).toBe("unknown");
    });

    it("says unknown for a server in an outage, which stays cached as unavailable", async () => {
        mockUnavailable = ["g2"];
        const res = await get(PATH);
        expect(stateOf(res, "g2")).toBe("unknown");
        expect(stateOf(res, "g1")).toBe("known");
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

    it("is refused without a valid CSRF token, and saves nothing", async () => {
        mockCsrf = false;
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
