// The Discord overview's API (src/web/apiRoutes/discordOverview.js) through the real
// router: area `channels` read only, the side picks the server, `fresh` reaches the
// message check, an unknown side is refused.
let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({ getUser: () => mockUser, checkCsrf: () => true }));
jest.mock("../../../src/stores/configStore", () => ({ getConfig: () => ({ marker: 1 }) }));
jest.mock("../../../src/services/discord/discord", () => ({ isOnline: () => true }));
jest.mock("../../../src/services/discord/guildRoles", () => ({
    eventGuildId: () => "900000000000000001",
    talkGuildId: () => "900000000000000002",
}));
jest.mock("../../../src/services/discord/memberActivity", () => ({ recentActivity: jest.fn(() => [{ kind: "join" }]) }));
jest.mock("../../../src/services/discord/botCheck", () => ({ botCheck: jest.fn(() => ({ known: true })) }));
jest.mock("../../../src/services/discord/botMessages", () => ({ botMessages: jest.fn(async () => [{ status: "ok" }]) }));
jest.mock("../../../src/services/discord/roleHygiene", () => ({ roleHygiene: jest.fn(() => ({ known: true, empty: 1 })) }));

const { recentActivity } = require("../../../src/services/discord/memberActivity");
const { botCheck } = require("../../../src/services/discord/botCheck");
const { botMessages } = require("../../../src/services/discord/botMessages");
const route = require("../../../src/web/apiRoutes/discordOverview");
const { emptyAccess } = require("../../../src/config/permissions");
const { routerClient, status, body, json } = require("../../helpers/http");

const { get, post } = routerClient(route);
const user = (level) => ({ id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), ...(level ? { channels: level } : {}) } });
const READER = user({ read: true, write: false });
const GUILDS = { event: "900000000000000001", talk: "900000000000000002" };

beforeEach(() => {
    jest.clearAllMocks();
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
        expect(route.routes.map((r) => r.method)).toEqual(["GET"]);
        expect(status(await post("/api/discord/overview", {}))).not.toBe(200);
    });
});

describe("GET", () => {
    it("answers the event side by default with every part", async () => {
        const data = body(await get("/api/discord/overview"));
        expect(data).toEqual({
            side: "event",
            guildId: GUILDS.event,
            online: true,
            members: [{ kind: "join" }],
            botCheck: { known: true },
            messages: [{ status: "ok" }],
            hygiene: { known: true, empty: 1 },
        });
        expect(recentActivity).toHaveBeenCalledWith(GUILDS.event, { days: 7 });
        expect(botCheck).toHaveBeenCalledWith("event", GUILDS.event, { marker: 1 }, GUILDS);
        expect(botMessages).toHaveBeenCalledWith("event", GUILDS.event, { marker: 1 }, { fresh: false });
    });

    it("takes the talk server and hands fresh on", async () => {
        const data = body(await get("/api/discord/overview", { side: "talk", fresh: "1" }));
        expect(data.guildId).toBe(GUILDS.talk);
        expect(botMessages).toHaveBeenCalledWith("talk", GUILDS.talk, { marker: 1 }, { fresh: true });
    });

    it("refuses an unknown side", async () => {
        const res = await get("/api/discord/overview", { side: "voice" });
        expect(status(res)).toBe(400);
        expect(json(res).error).toEqual(expect.objectContaining({ code: "bad_side" }));
        expect(botMessages).not.toHaveBeenCalled();
    });
});
