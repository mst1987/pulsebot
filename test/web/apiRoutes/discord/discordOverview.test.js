// The Discord overview's API (src/web/apiRoutes/discord/discordOverview.js) through the real
// router: area `channels` read only, `guildId` picks one server of the list (#895),
// `fresh` reaches the message check, a server outside the list is refused.
let mockUser = null;
jest.mock("../../../../src/web/http/auth", () => ({ getUser: () => mockUser, checkCsrf: () => true }));
let mockActive = "900000000000000001";
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: () => mockActive, pickActiveGuild: async () => mockActive }));
const mockConfig = {
    marker: 1,
    discordServers: { servers: [{ guildId: "900000000000000001" }, { guildId: "900000000000000002", label: "Talk" }], links: [] },
};
jest.mock("../../../../src/stores/configStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../../src/services/discord/discord", () => ({
    isOnline: () => true,
    getGuild: (id) => (id === "900000000000000001" ? { id, name: "Gilde", iconURL: () => "https://cdn/icon.png" } : null),
}));
jest.mock("../../../../src/services/discord/memberActivity", () => ({ recentActivity: jest.fn(() => [{ kind: "join" }]) }));
jest.mock("../../../../src/services/discord/botCheck", () => ({ botCheck: jest.fn(() => ({ known: true })) }));
jest.mock("../../../../src/services/discord/botMessages", () => ({ botMessages: jest.fn(async () => [{ status: "ok" }]) }));
jest.mock("../../../../src/services/discord/roleHygiene", () => ({ roleHygiene: jest.fn(() => ({ known: true, empty: 1 })) }));

const { recentActivity } = require("../../../../src/services/discord/memberActivity");
const { botCheck } = require("../../../../src/services/discord/botCheck");
const { botMessages } = require("../../../../src/services/discord/botMessages");
const route = require("../../../../src/web/apiRoutes/discord/discordOverview");
const { emptyAccess } = require("../../../../src/config/permissions");
const { routerClient, status, body, json } = require("../../../helpers/http");

const { get, post } = routerClient(route);
const user = (level) => ({ id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), ...(level ? { channels: level } : {}) } });
const READER = user({ read: true, write: false });
const ADMIN = { id: "1", name: "Admin", isAdmin: true };
const GUILDS = { event: "900000000000000001", talk: "900000000000000002" };
const CONFIG = mockConfig;

beforeEach(() => {
    jest.clearAllMocks();
    mockActive = "900000000000000001";
    mockUser = READER;
});

describe("access (area channels)", () => {
    it("lets a reader in, keeps out accounts without the area and anonymous callers", async () => {
        expect(status(await get("/api/discord/overview"))).toBe(200);
        mockUser = user(null);
        expect(status(await get("/api/discord/overview"))).toBe(403);
        mockUser = null;
        expect(status(await get("/api/discord/overview"))).toBe(401);
    });

    it("has no writing route", async () => {
        expect(route.routes.map((r) => r.method)).toEqual(["GET", "GET"]);
        expect(status(await post("/api/discord/overview", {}))).not.toBe(200);
    });
});

describe("GET", () => {
    beforeEach(() => { mockUser = ADMIN; });

    it("answers the first server by default with every part", async () => {
        const data = body(await get("/api/discord/overview"));
        expect(data).toEqual({
            guildId: GUILDS.event,
            online: true,
            members: [{ kind: "join" }],
            botCheck: { known: true },
            messages: [{ status: "ok" }],
            hygiene: { known: true, empty: 1 },
        });
        expect(recentActivity).toHaveBeenCalledWith(GUILDS.event, { days: 7 });
        expect(botCheck).toHaveBeenCalledWith(GUILDS.event, CONFIG);
        expect(botMessages).toHaveBeenCalledWith(GUILDS.event, CONFIG, { fresh: false });
    });

    it("takes the server by guildId and hands fresh on", async () => {
        const data = body(await get("/api/discord/overview", { guildId: GUILDS.talk, fresh: "1" }));
        expect(data.guildId).toBe(GUILDS.talk);
        expect(botMessages).toHaveBeenCalledWith(GUILDS.talk, CONFIG, { fresh: true });
    });

    // #897: there is no talk server any more, an old link opens the first server
    it("reads an old side=talk link as the first server", async () => {
        expect(body(await get("/api/discord/overview", { side: "talk" })).guildId).toBe(GUILDS.event);
    });

    it("refuses a server outside the list", async () => {
        const res = await get("/api/discord/overview", { guildId: "900000000000000099" });
        expect(status(res)).toBe(400);
        expect(json(res).error).toEqual(expect.objectContaining({ code: "unknown_guild" }));
        expect(botMessages).not.toHaveBeenCalled();
    });
});

describe("rights per server (#925)", () => {
    it("lets a reader open the active server, without guildId too", async () => {
        expect(body(await get("/api/discord/overview")).guildId).toBe(GUILDS.event);
        expect(body(await get("/api/discord/overview", { guildId: GUILDS.event })).guildId).toBe(GUILDS.event);
        mockActive = GUILDS.talk;
        expect(body(await get("/api/discord/overview")).guildId).toBe(GUILDS.talk);
    });

    it("answers 403 other_server for another server of the list", async () => {
        const res = await get("/api/discord/overview", { guildId: GUILDS.talk });
        expect(status(res)).toBe(403);
        expect(json(res).error.code).toBe("other_server");
        expect(botMessages).not.toHaveBeenCalled();
    });

    it("lets a full admin open every server", async () => {
        mockUser = ADMIN;
        expect(body(await get("/api/discord/overview", { guildId: GUILDS.talk })).guildId).toBe(GUILDS.talk);
    });
});

describe("GET /api/discord/servers", () => {
    it("lists every server for a full admin in their order with name and label", async () => {
        mockUser = ADMIN;
        expect(body(await get("/api/discord/servers"))).toEqual([
            { guildId: GUILDS.event, name: "Gilde", label: "", online: true, iconUrl: "https://cdn/icon.png" },
            { guildId: GUILDS.talk, name: "", label: "Talk", online: false, iconUrl: "" },
        ]);
    });

    it("lists only the active server for everybody else (#925)", async () => {
        expect(body(await get("/api/discord/servers")).map((s) => s.guildId)).toEqual([GUILDS.event]);
        mockActive = GUILDS.talk;
        expect(body(await get("/api/discord/servers")).map((s) => s.guildId)).toEqual([GUILDS.talk]);
    });


    it("keeps out accounts without the area", async () => {
        mockUser = user(null);
        expect(status(await get("/api/discord/servers"))).toBe(403);
    });
});
