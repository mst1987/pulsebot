// The members API (src/web/apiRoutes/discord/discordMembers.js) through the real router: area
// `channels` read, the server (guildId) passed on, 400 unknown_guild, the detail's 400
// and its `gone` answer.
let mockUser = null;
jest.mock("../../../../src/web/http/auth", () => ({ getUser: () => mockUser, checkCsrf: () => true, getActiveGuild: () => "" }));
let mockActive = "900000000000000001";
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: () => mockActive, pickActiveGuild: async () => mockActive }));
// the server list (#895): two equal servers
jest.mock("../../../../src/stores/configStore", () => ({
    getConfig: () => ({ discordServers: { servers: [{ guildId: "900000000000000001" }, { guildId: "900000000000000002" }], links: [] } }),
}));
const EVENT = "900000000000000001";
const TALK = "900000000000000002";
jest.mock("../../../../src/services/discord/serverMembers", () => ({
    listServerMembers: jest.fn(async (guildId) => ({ guildId, online: true, total: 0, roles: [], members: [] })),
    serverMemberDetail: jest.fn(),
}));

const svc = require("../../../../src/services/discord/serverMembers");
const route = require("../../../../src/web/apiRoutes/discord/discordMembers");
const { emptyAccess } = require("../../../../src/config/permissions");
const { routerClient, status, body, json } = require("../../../helpers/http");

const { get, post } = routerClient(route);
const ADMIN = { id: "1", name: "Admin", isAdmin: true };
const user = (level) => ({ id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), ...(level ? { channels: level } : {}) } });

beforeEach(() => {
    jest.clearAllMocks();
    mockActive = "900000000000000001";
    mockUser = ADMIN;
});

describe("access (area channels, read)", () => {
    it("lets a reader in", async () => {
        mockUser = user({ read: true, write: false });
        svc.serverMemberDetail.mockResolvedValue({ member: { id: "5" } });
        expect(status(await get("/api/discord/members"))).toBe(200);
        expect(status(await get("/api/discord/members/detail", { userId: "5" }))).toBe(200);
    });

    it("keeps out accounts without the area and anonymous callers, and has no write route", async () => {
        mockUser = user(null);
        expect(status(await get("/api/discord/members"))).toBe(403);
        expect(status(await get("/api/discord/members/detail", { userId: "5" }))).toBe(403);
        mockUser = null;
        expect(status(await get("/api/discord/members"))).toBe(401);
        mockUser = ADMIN;
        expect(status(await post("/api/discord/members", {}))).toBe(405);
        expect(svc.serverMemberDetail).not.toHaveBeenCalled();
    });
});

describe("GET /api/discord/members", () => {
    it("passes the server on, the first server by default, an old side=talk too (#897)", async () => {
        expect(body(await get("/api/discord/members", { guildId: TALK }))).toEqual({ guildId: TALK, online: true, total: 0, roles: [], members: [] });
        expect(svc.listServerMembers).toHaveBeenLastCalledWith(TALK);
        await get("/api/discord/members");
        expect(svc.listServerMembers).toHaveBeenLastCalledWith(EVENT);
        await get("/api/discord/members", { side: "talk" });
        expect(svc.listServerMembers).toHaveBeenLastCalledWith(EVENT);
    });

    it("refuses a server outside the list", async () => {
        const res = await get("/api/discord/members", { guildId: "900000000000000099" });
        expect(status(res)).toBe(400);
        expect(json(res).error.code).toBe("unknown_guild");
        expect(status(await get("/api/discord/members/detail", { guildId: "900000000000000099", userId: "5" }))).toBe(400);
        expect(svc.listServerMembers).not.toHaveBeenCalled();
        expect(svc.serverMemberDetail).not.toHaveBeenCalled();
    });
});

describe("GET /api/discord/members/detail", () => {
    it("answers the member, 400 without an id, 200 with gone for an unknown one", async () => {
        svc.serverMemberDetail.mockResolvedValueOnce({ member: { id: "5" }, roles: [], channels: [] });
        expect(body(await get("/api/discord/members/detail", { guildId: TALK, userId: "5" }))).toEqual({ member: { id: "5" }, roles: [], channels: [] });
        expect(svc.serverMemberDetail).toHaveBeenCalledWith(TALK, "5");

        const missing = await get("/api/discord/members/detail");
        expect(status(missing)).toBe(400);
        expect(json(missing).error.code).toBe("missing_user");

        svc.serverMemberDetail.mockResolvedValueOnce({ online: true, gone: true, member: null, roles: [], channels: [] });
        const unknown = await get("/api/discord/members/detail", { userId: "6" });
        expect(status(unknown)).toBe(200);
        expect(body(unknown)).toMatchObject({ gone: true, member: null });
    });
});
