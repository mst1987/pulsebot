// The members API (src/web/apiRoutes/discordMembers.js) through the real router: area
// `channels` read, the side passed on, the detail's 400/404.
let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({ getUser: () => mockUser, checkCsrf: () => true, getActiveGuild: () => "" }));
jest.mock("../../../src/services/discord/serverMembers", () => ({
    listServerMembers: jest.fn(async (side) => ({ side, online: true, total: 0, roles: [], members: [] })),
    serverMemberDetail: jest.fn(),
}));

const svc = require("../../../src/services/discord/serverMembers");
const route = require("../../../src/web/apiRoutes/discordMembers");
const { emptyAccess } = require("../../../src/config/permissions");
const { routerClient, status, body, json } = require("../../helpers/http");

const { get, post } = routerClient(route);
const ADMIN = { id: "1", name: "Admin", isAdmin: true };
const user = (level) => ({ id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), ...(level ? { channels: level } : {}) } });

beforeEach(() => {
    jest.clearAllMocks();
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
    it("passes the side on, event by default", async () => {
        expect(body(await get("/api/discord/members", { side: "talk" }))).toEqual({ side: "talk", online: true, total: 0, roles: [], members: [] });
        expect(svc.listServerMembers).toHaveBeenLastCalledWith("talk");
        await get("/api/discord/members", { side: "nonsense" });
        expect(svc.listServerMembers).toHaveBeenLastCalledWith("event");
    });
});

describe("GET /api/discord/members/detail", () => {
    it("answers the member, 400 without an id, 404 for an unknown one", async () => {
        svc.serverMemberDetail.mockResolvedValueOnce({ member: { id: "5" }, roles: [], channels: [] });
        expect(body(await get("/api/discord/members/detail", { side: "talk", userId: "5" }))).toEqual({ member: { id: "5" }, roles: [], channels: [] });
        expect(svc.serverMemberDetail).toHaveBeenCalledWith("talk", "5");

        const missing = await get("/api/discord/members/detail");
        expect(status(missing)).toBe(400);
        expect(json(missing).error.code).toBe("missing_user");

        svc.serverMemberDetail.mockResolvedValueOnce(null);
        const unknown = await get("/api/discord/members/detail", { userId: "6" });
        expect(status(unknown)).toBe(404);
        expect(json(unknown).error.code).toBe("not_found");
    });
});
