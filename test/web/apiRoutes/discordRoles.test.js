// The roles API (src/web/apiRoutes/discordRoles.js) through the real router: area
// `channels` read, the side passed on, the detail's 400/404 and the tab counts.
let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({ getUser: () => mockUser, checkCsrf: () => true, getActiveGuild: () => "" }));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: () => mockGuildId }));
let mockGuildId = "900000000000000001";
jest.mock("../../../src/services/discord/serverRoles", () => ({
    listServerRoles: jest.fn(async (side) => ({ side, online: true, roles: [] })),
    serverRoleDetail: jest.fn(),
    roleCount: jest.fn(() => 12),
}));
jest.mock("../../../src/services/discord/serverMembers", () => ({ memberCount: jest.fn(() => 186) }));
jest.mock("../../../src/services/discord/discord", () => ({
    getGuild: jest.fn(() => ({ id: "900000000000000001" })),
    listAllChannels: jest.fn(() => [{ id: "1", isThread: false }, { id: "2", isThread: false }, { id: "3", isThread: true }]),
}));

const svc = require("../../../src/services/discord/serverRoles");
const members = require("../../../src/services/discord/serverMembers");
const discord = require("../../../src/services/discord/discord");
const store = require("../../../src/stores/roleMessageStore");
const route = require("../../../src/web/apiRoutes/discordRoles");
const { emptyAccess } = require("../../../src/config/permissions");
const { tempStoreFile } = require("../../helpers/tempStore");
const { routerClient, status, body, json } = require("../../helpers/http");

const { get, post } = routerClient(route);
const ADMIN = { id: "1", name: "Admin", isAdmin: true };
const user = (level) => ({ id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), ...(level ? { channels: level } : {}) } });

beforeEach(() => {
    jest.clearAllMocks();
    store.useFile(tempStoreFile("role-messages.json"));
    mockUser = ADMIN;
    mockGuildId = "900000000000000001";
});
afterAll(() => store.useFile(null));

describe("access (area channels, read)", () => {
    it("lets a reader in", async () => {
        mockUser = user({ read: true, write: false });
        svc.serverRoleDetail.mockResolvedValue({ role: { id: "5" } });
        expect(status(await get("/api/discord/roles"))).toBe(200);
        expect(status(await get("/api/discord/roles/detail", { roleId: "5" }))).toBe(200);
        expect(status(await get("/api/discord/tab-counts"))).toBe(200);
    });

    it("keeps out accounts without the area and anonymous callers, and has no write route", async () => {
        mockUser = user(null);
        expect(status(await get("/api/discord/roles"))).toBe(403);
        expect(status(await get("/api/discord/tab-counts"))).toBe(403);
        mockUser = null;
        expect(status(await get("/api/discord/roles"))).toBe(401);
        mockUser = ADMIN;
        expect(status(await post("/api/discord/roles", {}))).toBe(405);
    });
});

describe("GET /api/discord/roles", () => {
    it("passes the side on, event by default", async () => {
        expect(body(await get("/api/discord/roles", { side: "talk" }))).toEqual({ side: "talk", online: true, roles: [] });
        expect(svc.listServerRoles).toHaveBeenLastCalledWith("talk");
        await get("/api/discord/roles", { side: "nonsense" });
        expect(svc.listServerRoles).toHaveBeenLastCalledWith("event");
    });
});

describe("GET /api/discord/roles/detail", () => {
    it("answers the role, 400 without an id, 404 for an unknown one", async () => {
        svc.serverRoleDetail.mockResolvedValueOnce({ role: { id: "5" }, channels: [], members: [] });
        expect(body(await get("/api/discord/roles/detail", { side: "event", roleId: "5" }))).toEqual({ role: { id: "5" }, channels: [], members: [] });
        expect(svc.serverRoleDetail).toHaveBeenCalledWith("event", "5");

        const missing = await get("/api/discord/roles/detail");
        expect(status(missing)).toBe(400);
        expect(json(missing).error.code).toBe("missing_role");

        svc.serverRoleDetail.mockResolvedValueOnce(null);
        const unknown = await get("/api/discord/roles/detail", { roleId: "6" });
        expect(status(unknown)).toBe(404);
        expect(json(unknown).error.code).toBe("not_found");
    });
});

describe("GET /api/discord/tab-counts", () => {
    it("counts channels without threads, the roles, the members and the role messages", async () => {
        store.saveMessage({ id: "a", guildSide: "event", channelId: "1", title: "A", roles: [{ roleId: "200000000000000002" }] });
        expect(body(await get("/api/discord/tab-counts", { side: "talk" }))).toEqual({ channels: 2, serverRoles: 12, members: 186, roleMessages: 1 });
        expect(svc.roleCount).toHaveBeenCalledWith("talk");
        expect(members.memberCount).toHaveBeenCalledWith("talk");
    });

    it("is null for the channels offline", async () => {
        discord.getGuild.mockReturnValueOnce(null);
        expect(body(await get("/api/discord/tab-counts")).channels).toBeNull();
        mockGuildId = "";
        expect(body(await get("/api/discord/tab-counts")).channels).toBeNull();
        expect(discord.listAllChannels).not.toHaveBeenCalled();
    });

    it("counts no role messages when the store cannot be read", async () => {
        jest.spyOn(store, "listMessages").mockImplementationOnce(() => { throw new Error("broken"); });
        expect(body(await get("/api/discord/tab-counts")).roleMessages).toBe(0);
    });
});
