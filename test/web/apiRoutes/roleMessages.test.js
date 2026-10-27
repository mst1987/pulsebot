// The role messages' API (src/web/apiRoutes/roleMessages.js) through the real router:
// area `channels` (GET reads, the rest writes), the answers and the error shape with
// the role and the reason of a refused role.
let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({ getUser: () => mockUser, checkCsrf: () => true }));
let mockActive = "900000000000000001";
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: () => mockActive, pickActiveGuild: async () => mockActive }));
jest.mock("../../../src/services/discord/linkCheck", () => ({ messageLink: (g, c, m) => `https://discord.com/channels/${g}/${c}/${m}` }));
// the server list (#895): two equal servers
jest.mock("../../../src/stores/configStore", () => ({
    getConfig: () => ({ discordServers: { servers: [{ guildId: "900000000000000001" }, { guildId: "900000000000000002" }], links: [] } }),
}));
jest.mock("../../../src/services/discord/roleMessages", () => {
    const actual = jest.requireActual("../../../src/services/discord/roleMessages");
    return {
        LIMITS: actual.LIMITS,
        guildIdOf: actual.guildIdOf,
        roleMessageOptions: jest.fn(),
        createRoleMessage: jest.fn(),
        updateRoleMessage: jest.fn(),
        deleteRoleMessage: jest.fn(),
    };
});

const svc = require("../../../src/services/discord/roleMessages");
const store = require("../../../src/stores/roleMessageStore");
const route = require("../../../src/web/apiRoutes/roleMessages");
const { emptyAccess } = require("../../../src/config/permissions");
const { tempStoreFile } = require("../../helpers/tempStore");
const { routerClient, status, body, json } = require("../../helpers/http");

const { get, post, request } = routerClient(route);
const ADMIN = { id: "1", name: "Admin", isAdmin: true };
const user = (level) => ({ id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), ...(level ? { channels: level } : {}) } });
const READER = user({ read: true, write: false });
const WRITER = user({ read: true, write: true });

const failure = (code, message, status, details = {}) => Object.assign(new Error(message), { code, status, details });
const ENTRY = { id: "abc", guildSide: "event", channelId: "100000000000000001", messageId: "300000000000000003", title: "WoW Forever Role", body: "", imageUrl: "", color: null, roles: [{ roleId: "200000000000000002", emoji: "✅", label: "WoW Forever Role" }] };

beforeEach(() => {
    jest.clearAllMocks();
    mockActive = "900000000000000001";
    store.useFile(tempStoreFile("role-messages.json"));
    mockUser = ADMIN;
});
afterAll(() => store.useFile(null));

describe("access (area channels)", () => {
    it("lets a reader list and read the options, but not write", async () => {
        mockUser = READER;
        svc.roleMessageOptions.mockReturnValue({ guildId: "900000000000000001", online: true, roles: [] });
        expect(status(await get("/api/role-messages"))).toBe(200);
        expect(status(await get("/api/role-messages/options"))).toBe(200);
        expect(status(await post("/api/role-messages", {}))).toBe(403);
        expect(status(await request("PUT", "/api/role-messages", { id: "abc" }))).toBe(403);
        expect(status(await request("DELETE", "/api/role-messages", { id: "abc" }))).toBe(403);
        expect(svc.createRoleMessage).not.toHaveBeenCalled();
    });

    it("keeps out accounts without the area and anonymous callers", async () => {
        mockUser = user(null);
        expect(status(await get("/api/role-messages"))).toBe(403);
        mockUser = null;
        expect(status(await get("/api/role-messages"))).toBe(401);
    });
});

describe("GET", () => {
    it("lists the messages with their server, link and the limits", async () => {
        store.saveMessage(ENTRY);
        const data = body(await get("/api/role-messages"));
        expect(data.limits).toMatchObject({ roles: 25, reactions: 20 });
        expect(data.messages[0]).toMatchObject({ id: "abc", guildId: "900000000000000001", url: expect.stringContaining("300000000000000003") });
    });

    it("hands the server to the options, the first one by default", async () => {
        svc.roleMessageOptions.mockReturnValue({ guildId: "900000000000000002" });
        expect(body(await get("/api/role-messages/options", { guildId: "900000000000000002" }))).toEqual({ guildId: "900000000000000002" });
        expect(svc.roleMessageOptions).toHaveBeenLastCalledWith("900000000000000002");
        await get("/api/role-messages/options");
        expect(svc.roleMessageOptions).toHaveBeenLastCalledWith("900000000000000001");
    });

    it("refuses options for a server outside the list", async () => {
        const res = await get("/api/role-messages/options", { guildId: "900000000000000099" });
        expect(status(res)).toBe(400);
        expect(json(res).error.code).toBe("unknown_guild");
        expect(svc.roleMessageOptions).not.toHaveBeenCalled();
    });

    // #897: an entry from before #895 goes to the first server, its side no longer counts
    it("reads an entry from before #895 as the first server's and one by its own server", async () => {
        store.saveMessage({ ...ENTRY, id: "old", guildSide: "talk" });
        store.saveMessage({ ...ENTRY, id: "new", guildSide: undefined, guildId: "900000000000000002" });
        const byId = Object.fromEntries(body(await get("/api/role-messages")).messages.map((m) => [m.id, m]));
        expect(byId.old.guildId).toBe("900000000000000001");
        expect(byId.new.guildId).toBe("900000000000000002");
        expect(byId.old).not.toHaveProperty("guildSide");
    });
});

describe("POST, PUT, DELETE", () => {
    it("creates with the author and answers 201 with the entry and warnings", async () => {
        mockUser = WRITER;
        svc.createRoleMessage.mockResolvedValue({ entry: ENTRY, url: "https://discord.com/x", warnings: ["w"] });
        const res = await post("/api/role-messages", { channelId: ENTRY.channelId });
        expect(status(res)).toBe(201);
        expect(body(res)).toMatchObject({ entry: { id: "abc", guildId: "900000000000000001" }, url: "https://discord.com/x", warnings: ["w"] });
        expect(svc.createRoleMessage).toHaveBeenCalledWith(expect.objectContaining({ channelId: ENTRY.channelId }), { userId: "7" });
    });

    it("answers a refused role with its code, role and reason", async () => {
        svc.createRoleMessage.mockRejectedValue(failure("privileged_role", "Die Rolle hat Rechte.", 400, { roleId: "200000000000000004", reason: "the role is an orga role" }));
        const res = await post("/api/role-messages", {});
        expect(status(res)).toBe(400);
        expect(json(res)).toEqual({ error: { code: "privileged_role", message: "Die Rolle hat Rechte.", roleId: "200000000000000004", reason: "the role is an orga role" } });
    });

    it("updates by the id in the body and passes on a 404", async () => {
        store.saveMessage(ENTRY);
        svc.updateRoleMessage.mockResolvedValue({ entry: ENTRY, url: "", warnings: [], reposted: true });
        const res = await request("PUT", "/api/role-messages", { id: "abc", title: "T" });
        expect(body(res)).toMatchObject({ reposted: true, entry: { id: "abc" } });
        expect(svc.updateRoleMessage).toHaveBeenCalledWith("abc", expect.objectContaining({ title: "T" }));
        svc.updateRoleMessage.mockRejectedValue(failure("not_found", "Gibt es nicht.", 404));
        expect(status(await request("PUT", "/api/role-messages", { id: "nope" }))).toBe(404);
        expect(json(await request("PUT", "/api/role-messages", {})).error.code).toBe("missing_id");
    });

    it("deletes by the id in the body", async () => {
        store.saveMessage(ENTRY);
        svc.deleteRoleMessage.mockResolvedValue({ id: "abc", messageDeleted: false });
        expect(body(await request("DELETE", "/api/role-messages", { id: "abc" }))).toEqual({ id: "abc", messageDeleted: false });
        expect(svc.deleteRoleMessage).toHaveBeenCalledWith("abc");
        expect(status(await request("DELETE", "/api/role-messages", {}))).toBe(400);
    });

    it("lets an unexpected error through to the router", async () => {
        store.saveMessage(ENTRY);
        svc.deleteRoleMessage.mockRejectedValue(new Error("boom"));
        expect(status(await request("DELETE", "/api/role-messages", { id: "abc" }))).toBe(500);
    });
});

describe("rights per server (#925)", () => {
    const A = "900000000000000001";
    const B = "900000000000000002";
    const onB = { ...ENTRY, id: "onB", guildSide: undefined, guildId: B };

    beforeEach(() => {
        store.saveMessage(ENTRY); // on server A (the first)
        store.saveMessage(onB);
        mockUser = WRITER;
        mockActive = A;
    });

    it("lists only the role messages of the active server", async () => {
        expect(body(await get("/api/role-messages")).messages.map((m) => m.id)).toEqual(["abc"]);
        mockActive = B;
        expect(body(await get("/api/role-messages")).messages.map((m) => m.id)).toEqual(["onB"]);
    });

    it("answers 403 other_server for the options of another server", async () => {
        const res = await get("/api/role-messages/options", { guildId: B });
        expect(status(res)).toBe(403);
        expect(json(res).error.code).toBe("other_server");
        expect(svc.roleMessageOptions).not.toHaveBeenCalled();
    });

    it("answers 403 other_server for a new message on another server, posts on the active one", async () => {
        const res = await post("/api/role-messages", { guildId: B, channelId: ENTRY.channelId });
        expect(status(res)).toBe(403);
        expect(json(res).error.code).toBe("other_server");
        expect(svc.createRoleMessage).not.toHaveBeenCalled();
        svc.createRoleMessage.mockResolvedValue({ entry: ENTRY, url: "", warnings: [] });
        expect(status(await post("/api/role-messages", { channelId: ENTRY.channelId }))).toBe(201);
        expect(svc.createRoleMessage).toHaveBeenCalledWith(expect.objectContaining({ guildId: A }), { userId: "7" });
    });

    it("answers 404 for changing or deleting a role message of another server", async () => {
        const put = await request("PUT", "/api/role-messages", { id: "onB", title: "T" });
        expect(status(put)).toBe(404);
        expect(json(put).error.code).toBe("not_found");
        expect(status(await request("DELETE", "/api/role-messages", { id: "onB" }))).toBe(404);
        expect(svc.updateRoleMessage).not.toHaveBeenCalled();
        expect(svc.deleteRoleMessage).not.toHaveBeenCalled();
    });

    it("answers 403 for moving an own role message to another server, keeps its server without guildId", async () => {
        const res = await request("PUT", "/api/role-messages", { id: "abc", guildId: B });
        expect(status(res)).toBe(403);
        expect(svc.updateRoleMessage).not.toHaveBeenCalled();
        svc.updateRoleMessage.mockResolvedValue({ entry: ENTRY, url: "", warnings: [], reposted: false });
        await request("PUT", "/api/role-messages", { id: "abc", title: "T" });
        expect(svc.updateRoleMessage).toHaveBeenCalledWith("abc", expect.objectContaining({ guildId: A }));
    });

    it("lets a full admin list, change and delete on every server", async () => {
        mockUser = ADMIN;
        expect(body(await get("/api/role-messages")).messages.map((m) => m.id).sort()).toEqual(["abc", "onB"]);
        svc.updateRoleMessage.mockResolvedValue({ entry: onB, url: "", warnings: [], reposted: false });
        expect(status(await request("PUT", "/api/role-messages", { id: "onB", title: "T" }))).not.toBe(404);
        expect(svc.updateRoleMessage).toHaveBeenCalledWith("onB", expect.objectContaining({ guildId: B }));
        svc.deleteRoleMessage.mockResolvedValue({ id: "onB", messageDeleted: true });
        expect(body(await request("DELETE", "/api/role-messages", { id: "onB" }))).toEqual({ id: "onB", messageDeleted: true });
    });
});
