// apiRoutes/rosterImage ("Roster als Bild"): the PNG, what the dialog may offer and posting
// the picture - through the real router, with the real stores on scratch files and the
// Discord side mocked.
const { json, routerClient } = require("../../../helpers/http");
const { tempStoreFile } = require("../../../helpers/tempStore");

let mockUser = null;
jest.mock("../../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    getRealUser: jest.fn(() => mockUser),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
const mockChannels = new Map();
jest.mock("../../../../src/services/discord/discord", () => ({
    memberRoleIds: jest.fn(async () => []),
    isOnline: jest.fn(() => false),
    getGuild: jest.fn(() => null),
    listGuilds: jest.fn(() => []),
    listHumanMembers: jest.fn(async () => ({ members: [], error: null })),
    listRoles: jest.fn(() => []),
    listTextChannels: jest.fn(() => [{ id: "300000000000000001", name: "roster", category: "Raid", parentId: null }]),
    getClient: jest.fn(() => ({ channels: { cache: mockChannels } })),
    postPayload: jest.fn(async (channelId) => ({ guildId: "g1", channelId, messageId: "m1", url: "https://discord.com/channels/g1/c/m1" })),
}));
jest.mock("../../../../src/services/discord/discordImage", () => {
    const actual = jest.requireActual("../../../../src/services/discord/discordImage");
    return { ...actual, renderPng: jest.fn(actual.renderPng), withImages: jest.fn(actual.withImages) };
});
jest.mock("../../../../src/services/categories/categoryNames", () => ({ listKnownCategories: jest.fn(() => []) }));
jest.mock("../../../../src/services/events/eventSources", () => ({ listStoredEvents: jest.fn(() => []) }));
jest.mock("../../../../src/stores/loot/logStore", () => ({ listLogs: jest.fn(() => []) }));
jest.mock("../../../../src/stores/loot/reportStore", () => ({ listReports: jest.fn(() => []), getReport: jest.fn(() => null) }));

const auth = require("../../../../src/web/http/auth");
const { activeGuildFor } = require("../../../../src/web/http/activeGuild");
const rosterStore = require("../../../../src/stores/roster/rosterStore");
const raiderProfileStore = require("../../../../src/stores/roster/raiderProfileStore");
const discord = require("../../../../src/services/discord/discord");
const discordImage = require("../../../../src/services/discord/discordImage");
const routeModule = require("../../../../src/web/apiRoutes/roster/rosterImage");
const { postFailure } = routeModule;
const { get, post } = routerClient(routeModule);

const CHANNEL = "300000000000000001";
const FOREIGN = "300000000000000002";
const ADMIN = { id: "1", isAdmin: true };
const MANAGER = { id: "200001", isAdmin: false, access: { roster: { read: true, write: true } } };
const READER = { id: "200002", isAdmin: false, access: { roster: { read: true, write: false } } };
const WRITER = { id: "200003", isAdmin: false, access: { roster: { read: true, write: true } } };
const NOBODY = { id: "200004", isAdmin: false, access: {} };

const status = (res) => res.writeHead.mock.calls[0][0];
const headers = (res) => res.writeHead.mock.calls[0][1];
const data = (res) => json(res).data;
const code = (res) => (json(res).error || {}).code;

let roster;
beforeAll(() => {
    rosterStore.useFile(tempStoreFile("img-route-rosters.json"));
    raiderProfileStore.useFile(tempStoreFile("img-route-profiles.json"));
});
afterAll(() => {
    rosterStore.useFile(null);
    raiderProfileStore.useFile(null);
});
beforeEach(() => {
    jest.clearAllMocks();
    auth.checkCsrf.mockReturnValue(true);
    activeGuildFor.mockReturnValue("g1");
    discord.isOnline.mockReturnValue(true);
    mockChannels.clear();
    mockChannels.set(CHANNEL, { id: CHANNEL, guildId: "g1" });
    mockChannels.set(FOREIGN, { id: FOREIGN, guildId: "g2" });
    for (const r of rosterStore.listRosters("")) rosterStore.deleteRoster(r.id);
    raiderProfileStore.reset();
    roster = rosterStore.createRoster({ name: "Donnerstag", guildId: "g1", slots: { total: 10, tank: 2, healer: 3 }, managers: { userIds: [MANAGER.id], roleIds: [] } });
    raiderProfileStore.addCharacter("100001", { name: "Devi", className: "Priest", specs: ["Priest-Holy"] });
    rosterStore.upsertMember(roster.id, "100001", { chars: ["Devi"] });
    mockUser = MANAGER;
});

describe("apiRoutes/rosterImage routes", () => {
    it("are gated on the roster area", () => {
        expect(routeModule.routes.map((r) => `${r.method} ${r.path} ${r.area}`)).toEqual([
            "GET /api/rosters/image roster",
            "GET /api/rosters/image/info roster",
            "POST /api/rosters/image roster",
        ]);
    });
});

describe("GET /api/rosters/image", () => {
    it("answers the roster as a PNG for a reader", async () => {
        mockUser = READER;
        const res = await get("/api/rosters/image", { id: roster.id });
        expect(status(res)).toBe(200);
        expect(headers(res)).toMatchObject({ "Content-Type": "image/png", "Cache-Control": "private, no-store" });
        const png = res.end.mock.calls[0][0];
        expect(Buffer.isBuffer(png)).toBe(true);
        expect(png.subarray(1, 4).toString()).toBe("PNG");
    });

    it("passes the switches on: bench shows only with reserve=1", async () => {
        rosterStore.upsertMember(roster.id, "100002", { status: "bench" });
        const plain = await get("/api/rosters/image", { id: roster.id });
        const withReserve = await get("/api/rosters/image", { id: roster.id, reserve: "1", chars: "1" });
        const size = (res) => res.end.mock.calls[0][0].length;
        expect(size(withReserve)).not.toBe(size(plain));
    });

    it("is 400 without id and 404 for an unknown roster or one of another server", async () => {
        expect(code(await get("/api/rosters/image"))).toBe("bad_request");
        expect(status(await get("/api/rosters/image", { id: "nope" }))).toBe(404);
        activeGuildFor.mockReturnValue("g2");
        const other = await get("/api/rosters/image", { id: roster.id });
        expect(status(other)).toBe(404);
        expect(code(other)).toBe("not_found");
    });

    it("is closed to somebody without the roster area", async () => {
        mockUser = NOBODY;
        expect(status(await get("/api/rosters/image", { id: roster.id }))).toBe(403);
    });
});

describe("GET /api/rosters/image/info", () => {
    it("offers a manager the channels and the last channel", async () => {
        rosterStore.setImageChannel(roster.id, CHANNEL);
        const res = await get("/api/rosters/image/info", { id: roster.id });
        expect(status(res)).toBe(200);
        expect(data(res)).toEqual({ canPost: true, channelId: CHANNEL, channels: [expect.objectContaining({ id: CHANNEL })] });
        expect(discord.listTextChannels).toHaveBeenCalledWith("g1");
    });

    it("offers a reader nothing to post with", async () => {
        mockUser = READER;
        rosterStore.setImageChannel(roster.id, CHANNEL);
        const res = await get("/api/rosters/image/info", { id: roster.id });
        expect(data(res)).toEqual({ canPost: false, channelId: null, channels: [] });
        expect(discord.listTextChannels).not.toHaveBeenCalled();
    });

    it("is 400 without id and 404 for another server's roster", async () => {
        expect(status(await get("/api/rosters/image/info"))).toBe(400);
        activeGuildFor.mockReturnValue("g2");
        expect(status(await get("/api/rosters/image/info", { id: roster.id }))).toBe(404);
    });
});

describe("POST /api/rosters/image", () => {
    it("posts the picture with one short line and keeps the channel", async () => {
        const res = await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL, reserve: true });
        expect(status(res)).toBe(200);
        expect(data(res)).toEqual({ url: "https://discord.com/channels/g1/c/m1", channelId: CHANNEL });
        const [channelId, payload, opts] = discord.postPayload.mock.calls[0];
        expect(channelId).toBe(CHANNEL);
        expect(opts).toEqual({ guildId: "g1" });
        expect(payload.content).toMatch(/^Roster Donnerstag, Stand \d\d\.\d\d\.\d{4}$/);
        expect(payload.files).toHaveLength(1);
        expect(payload.files[0].name).toBe("roster.png");
        expect(payload.files[0].attachment.subarray(1, 4).toString()).toBe("PNG");
        expect(payload.content).not.toMatch(/@/);
        expect(rosterStore.getRoster(roster.id).imageChannelId).toBe(CHANNEL);
    });

    it("lets a full admin post too, but not a writer who manages another roster", async () => {
        mockUser = ADMIN;
        expect(status(await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL }))).toBe(200);
        mockUser = WRITER;
        const res = await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL });
        expect(status(res)).toBe(403);
        expect(code(res)).toBe("not_manager");
    });

    it("refuses a reader by the area's write right", async () => {
        mockUser = READER;
        expect(status(await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL }))).toBe(403);
        expect(discord.postPayload).not.toHaveBeenCalled();
    });

    it("is 404 for an unknown roster or one of another server, 400 without id or channel", async () => {
        expect(code(await post("/api/rosters/image", { channelId: CHANNEL }))).toBe("bad_request");
        expect(status(await post("/api/rosters/image", { id: "nope", channelId: CHANNEL }))).toBe(404);
        expect(code(await post("/api/rosters/image", { id: roster.id, channelId: "" }))).toBe("no_channel");
        activeGuildFor.mockReturnValue("g2");
        expect(status(await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL }))).toBe(404);
        expect(discord.postPayload).not.toHaveBeenCalled();
    });

    it("refuses a channel of another server", async () => {
        const res = await post("/api/rosters/image", { id: roster.id, channelId: FOREIGN });
        expect(status(res)).toBe(403);
        expect(code(res)).toBe("other_server");
        expect(discord.postPayload).not.toHaveBeenCalled();
    });

    it("says the bot is offline instead of blaming the channel's server", async () => {
        discord.isOnline.mockReturnValue(false);
        const res = await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL });
        expect(status(res)).toBe(503);
        expect(code(res)).toBe("bot_offline");
        expect(discord.postPayload).not.toHaveBeenCalled();
    });

    it("answers a full admin's post into another server's channel with 403 wrong_guild", async () => {
        mockUser = ADMIN;
        discord.postPayload.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "wrong_guild" }));
        const res = await post("/api/rosters/image", { id: roster.id, channelId: FOREIGN });
        expect(status(res)).toBe(403);
        expect(code(res)).toBe("wrong_guild");
        expect(discord.postPayload).toHaveBeenCalledWith(FOREIGN, expect.any(Object), { guildId: "g1" });
        expect(rosterStore.getRoster(roster.id).imageChannelId).toBeNull();
    });

    it("draws the picture once and sends that PNG as it is", async () => {
        expect(status(await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL }))).toBe(200);
        expect(discordImage.renderPng).toHaveBeenCalledTimes(1);
        expect(discordImage.withImages).not.toHaveBeenCalled();
        const payload = discord.postPayload.mock.calls[0][1];
        expect(payload.files[0].attachment).toBe(discordImage.renderPng.mock.results[0].value);
        expect(payload.attachments).toEqual([]);
    });

    it("takes the active server for a roster from before rosters knew theirs", async () => {
        const old = rosterStore.createRoster({ name: "Alt", slots: { total: 10, tank: 2, healer: 3 }, managers: { userIds: [MANAGER.id], roleIds: [] } });
        expect(rosterStore.getRoster(old.id).guildId || "").toBe("");
        await get("/api/rosters/image/info", { id: old.id });
        expect(discord.listTextChannels).toHaveBeenCalledWith("g1");
        expect(status(await post("/api/rosters/image", { id: old.id, channelId: CHANNEL }))).toBe(200);
        expect(discord.postPayload.mock.calls[0][2]).toEqual({ guildId: "g1" });
    });

    it("answers a refused post with a clear code and keeps no channel", async () => {
        discord.postPayload.mockRejectedValueOnce(Object.assign(new Error("x"), { code: 50013 }));
        const res = await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL });
        expect(status(res)).toBe(403);
        expect(code(res)).toBe("no_permission");
        expect(rosterStore.getRoster(roster.id).imageChannelId).toBeNull();
    });

    it("may post a closed roster's picture (a snapshot changes nothing)", async () => {
        rosterStore.closeRoster(roster.id);
        expect(status(await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL }))).toBe(200);
    });
});

describe("postFailure", () => {
    it("maps Discord's refusals to codes the client translates", () => {
        expect(postFailure({ code: "bot_offline" })).toEqual([503, "bot_offline", expect.any(String)]);
        expect(postFailure({ code: "wrong_guild" })[1]).toBe("wrong_guild");
        expect(postFailure({ code: "channel_not_found" })[1]).toBe("channel_not_found");
        expect(postFailure({ code: 10003 })[0]).toBe(404);
        expect(postFailure({ code: 50001 })[1]).toBe("no_permission");
        expect(postFailure(new Error("boom"))).toEqual([502, "post_failed", expect.any(String)]);
        expect(postFailure(null)[1]).toBe("post_failed");
    });
});
