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
    editPayload: jest.fn(async (channelId, messageId) => ({ channelId, messageId, url: "edited-url" })),
    readMessage: jest.fn(),
    deleteMessage: jest.fn(async () => true),
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
const LIVE_POST = { guildId: "g1", channelId: CHANNEL, messageId: "400000000000000001", reserve: true, chars: false, hash: "the-hash", text: "" };

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
            "POST /api/rosters/image/attach roster",
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
        expect(data(res)).toEqual({ canPost: true, channelId: CHANNEL, channels: [expect.objectContaining({ id: CHANNEL })], live: null });
        expect(discord.listTextChannels).toHaveBeenCalledWith("g1");
    });

    it("offers a reader nothing to post with", async () => {
        mockUser = READER;
        rosterStore.setImageChannel(roster.id, CHANNEL);
        rosterStore.setImagePost(roster.id, LIVE_POST);
        const res = await get("/api/rosters/image/info", { id: roster.id });
        expect(data(res)).toEqual({ canPost: false, channelId: null, channels: [], live: null });
        expect(discord.listTextChannels).not.toHaveBeenCalled();
    });

    it("tells a manager about the picture keeping itself current, never its hash", async () => {
        rosterStore.setImagePost(roster.id, LIVE_POST);
        const res = await get("/api/rosters/image/info", { id: roster.id });
        expect(data(res).live).toEqual({
            channelId: CHANNEL,
            url: `https://discord.com/channels/g1/${CHANNEL}/${LIVE_POST.messageId}`,
            reserve: true,
            chars: false,
            text: "",
        });
        expect(JSON.stringify(data(res))).not.toContain(LIVE_POST.hash);
    });

    it("gives no live picture that lies on another server (a roster without a server of its own)", async () => {
        rosterStore.setImagePost(roster.id, { ...LIVE_POST, guildId: "g2" });
        expect(data(await get("/api/rosters/image/info", { id: roster.id })).live).toBeNull();
    });

    it("gives no live picture for a closed roster: nothing updates it any more", async () => {
        rosterStore.setImagePost(roster.id, LIVE_POST);
        rosterStore.closeRoster(roster.id);
        expect(data(await get("/api/rosters/image/info", { id: roster.id })).live).toBeNull();
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

    it("remembers the post with its switches and the hash of what it shows", async () => {
        await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL, reserve: true });
        expect(rosterStore.getRoster(roster.id).imagePost).toEqual({
            guildId: "g1", channelId: CHANNEL, messageId: "m1", reserve: true, chars: false,
            hash: expect.stringMatching(/^[0-9a-f]{64}$/), text: "",
        });
        expect(discord.deleteMessage).not.toHaveBeenCalled();
    });

    it("puts the orga's text in place of the line, keeps it within 500 characters and in the hash", async () => {
        await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL });
        const plainHash = rosterStore.getRoster(roster.id).imagePost.hash;
        await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL, text: `  @everyone ${"x".repeat(600)}` });
        const sent = discord.postPayload.mock.calls[1][1].content;
        expect(sent.startsWith("@everyone x")).toBe(true);
        expect(sent).toHaveLength(500);
        const stored = rosterStore.getRoster(roster.id).imagePost;
        expect(stored.text).toBe(sent);
        expect(stored.hash).not.toBe(plainHash);
    });

    it("uses the text of a closed roster's post once and keeps it nowhere", async () => {
        rosterStore.closeRoster(roster.id);
        expect(status(await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL, text: "Letzter Stand" }))).toBe(200);
        expect(discord.postPayload.mock.calls[0][1].content).toBe("Letzter Stand");
        expect(rosterStore.getRoster(roster.id).imagePost).toBeNull();
    });

    it("a new post deletes the old picture, after the new one is remembered", async () => {
        rosterStore.setImagePost(roster.id, LIVE_POST);
        const order = [];
        discord.postPayload.mockImplementationOnce(async (channelId) => {
            order.push("post");
            return { guildId: "g1", channelId, messageId: "m2", url: "u" };
        });
        discord.deleteMessage.mockImplementationOnce(async () => {
            order.push(`delete, store has ${rosterStore.getRoster(roster.id).imagePost.messageId}`);
            return true;
        });
        expect(status(await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL }))).toBe(200);
        expect(order).toEqual(["post", "delete, store has m2"]);
        expect(discord.deleteMessage).toHaveBeenCalledTimes(1);
        expect(discord.deleteMessage).toHaveBeenCalledWith(CHANNEL, LIVE_POST.messageId);
    });

    it("leaves an old picture on another server alone: not ours to delete", async () => {
        rosterStore.setImagePost(roster.id, { ...LIVE_POST, guildId: "g2" });
        expect(status(await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL }))).toBe(200);
        expect(discord.deleteMessage).not.toHaveBeenCalled();
        expect(rosterStore.getRoster(roster.id).imagePost.guildId).toBe("g1");
    });

    it("takes the new message back when the roster is deleted during the post", async () => {
        discord.postPayload.mockImplementationOnce(async (channelId) => {
            rosterStore.deleteRoster(roster.id);
            return { guildId: "g1", channelId, messageId: "m2", url: "u" };
        });
        expect(status(await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL }))).toBe(404);
        expect(discord.deleteMessage).toHaveBeenCalledWith(CHANNEL, "m2");
    });

    it("a failed post leaves the old picture alone", async () => {
        rosterStore.setImagePost(roster.id, LIVE_POST);
        discord.postPayload.mockRejectedValueOnce(Object.assign(new Error("x"), { code: 50013 }));
        expect(status(await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL }))).toBe(403);
        expect(discord.deleteMessage).not.toHaveBeenCalled();
        expect(rosterStore.getRoster(roster.id).imagePost).toEqual(LIVE_POST);
    });

    it("may post a closed roster's picture, but neither remembers it nor deletes the last one", async () => {
        rosterStore.setImagePost(roster.id, LIVE_POST);
        rosterStore.closeRoster(roster.id);
        expect(status(await post("/api/rosters/image", { id: roster.id, channelId: CHANNEL }))).toBe(200);
        expect(discord.deleteMessage).not.toHaveBeenCalled();
        expect(rosterStore.getRoster(roster.id).imagePost).toEqual(LIVE_POST);
    });
});

describe("POST /api/rosters/image/attach", () => {
    const MESSAGE = "400000000000000009";
    const attach = (body = {}) => post("/api/rosters/image/attach", { id: roster.id, channelId: CHANNEL, message: MESSAGE, ...body });
    const found = (over = {}) => ({ guildId: "g1", channelId: CHANNEL, messageId: MESSAGE, url: "u", own: true, attachments: ["roster.png"], ...over });
    const expectUntouched = () => {
        expect(discord.editPayload).not.toHaveBeenCalled();
        expect(discord.deleteMessage).not.toHaveBeenCalled();
        expect(rosterStore.getRoster(roster.id).imagePost).toBeNull();
    };

    beforeEach(() => {
        discord.readMessage.mockImplementation(async () => found());
    });

    it("replaces the picture in that message at once and keeps it current from now on", async () => {
        const res = await attach({ reserve: true });
        expect(status(res)).toBe(200);
        expect(data(res)).toEqual({ url: "edited-url", channelId: CHANNEL });
        expect(discord.readMessage).toHaveBeenCalledWith(CHANNEL, MESSAGE, { guildId: "g1" });
        const [channelId, messageId, payload] = discord.editPayload.mock.calls[0];
        expect([channelId, messageId]).toEqual([CHANNEL, MESSAGE]);
        expect(payload.content).toMatch(/^Roster Donnerstag, Stand /);
        expect(payload.files[0].name).toBe("roster.png");
        expect(payload.attachments).toEqual([]);
        expect(discord.postPayload).not.toHaveBeenCalled();
        const stored = rosterStore.getRoster(roster.id);
        expect(stored.imageChannelId).toBe(CHANNEL);
        expect(stored.imagePost).toEqual({
            guildId: "g1", channelId: CHANNEL, messageId: MESSAGE, reserve: true, chars: false,
            hash: expect.stringMatching(/^[0-9a-f]{64}$/), text: "",
        });
    });

    it("refuses another message of the bot without roster.png and does not touch it", async () => {
        discord.readMessage.mockResolvedValueOnce(found({ attachments: ["setup.png"] }));
        const res = await attach();
        expect(status(res)).toBe(400);
        expect(code(res)).toBe("not_roster_picture");
        discord.readMessage.mockResolvedValueOnce(found({ attachments: [] }));
        expect(code(await attach())).toBe("not_roster_picture");
        expectUntouched();
    });

    it("refuses somebody else's message, even with a file of that name", async () => {
        discord.readMessage.mockResolvedValueOnce(found({ own: false }));
        const res = await attach();
        expect(status(res)).toBe(403);
        expect(code(res)).toBe("not_own_message");
        expectUntouched();
    });

    it("refuses what names no message, and a bare id without a channel", async () => {
        const bad = await attach({ message: "hallo" });
        expect(status(bad)).toBe(400);
        expect(code(bad)).toBe("bad_message");
        expect(code(await attach({ message: "" }))).toBe("bad_message");
        const none = await attach({ channelId: "" });
        expect(status(none)).toBe(400);
        expect(code(none)).toBe("no_channel");
        expect(discord.readMessage).not.toHaveBeenCalled();
    });

    it("takes the channel from the link or the pair, not from the picker", async () => {
        const server = "100000000000000001";
        const other = "300000000000000003";
        const onServer = rosterStore.createRoster({ name: "Link", guildId: server, managers: { userIds: [MANAGER.id], roleIds: [] } });
        activeGuildFor.mockReturnValue(server);
        mockChannels.set(other, { id: other, guildId: server });
        mockChannels.set(CHANNEL, { id: CHANNEL, guildId: server });
        discord.readMessage.mockImplementation(async (channelId) => found({ guildId: server, channelId }));
        const body = { id: onServer.id, channelId: CHANNEL, message: `https://discord.com/channels/${server}/${other}/${MESSAGE}` };
        expect(data(await post("/api/rosters/image/attach", body))).toMatchObject({ channelId: other });
        expect(discord.readMessage).toHaveBeenCalledWith(other, MESSAGE, { guildId: server });
        expect(rosterStore.getRoster(onServer.id).imagePost.channelId).toBe(other);
        discord.readMessage.mockClear();
        await post("/api/rosters/image/attach", { ...body, message: `${other}-${MESSAGE}` });
        expect(discord.readMessage).toHaveBeenCalledWith(other, MESSAGE, { guildId: server });
    });

    it("refuses a link to another server, a channel of another server and the server check of discord", async () => {
        const link = await attach({ message: `https://discord.com/channels/99999/${CHANNEL}/${MESSAGE}` });
        expect(status(link)).toBe(403);
        expect(code(link)).toBe("wrong_guild");
        const foreign = await attach({ message: `${FOREIGN}-${MESSAGE}` });
        expect(status(foreign)).toBe(403);
        expect(code(foreign)).toBe("other_server");
        expect(discord.readMessage).not.toHaveBeenCalled();
        discord.readMessage.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "wrong_guild" }));
        expect(code(await attach())).toBe("wrong_guild");
        expectUntouched();
    });

    it("says what Discord answered when reading fails", async () => {
        const refused = async (discordCode) => {
            discord.readMessage.mockRejectedValueOnce(Object.assign(new Error("x"), { code: discordCode }));
            const res = await attach();
            return [status(res), code(res)];
        };
        expect(await refused(10008)).toEqual([404, "message_not_found"]);
        expect(await refused("channel_not_found")).toEqual([404, "channel_not_found"]);
        expect(await refused(50001)).toEqual([403, "no_permission"]);
        expect(await refused("anything")).toEqual([502, "post_failed"]);
        expectUntouched();
    });

    it("says the bot is offline, and remembers nothing when the edit fails", async () => {
        discord.isOnline.mockReturnValueOnce(false);
        const offline = await attach();
        expect(status(offline)).toBe(503);
        expect(code(offline)).toBe("bot_offline");
        discord.editPayload.mockRejectedValueOnce(Object.assign(new Error("x"), { code: 50013 }));
        const refused = await attach();
        expect(status(refused)).toBe(403);
        expect(code(refused)).toBe("no_permission");
        expect(rosterStore.getRoster(roster.id).imagePost).toBeNull();
        expect(rosterStore.getRoster(roster.id).imageChannelId).toBeNull();
    });

    it("refuses a closed roster: nothing would keep the picture current", async () => {
        rosterStore.closeRoster(roster.id);
        const res = await attach();
        expect(status(res)).toBe(409);
        expect(code(res)).toBe("roster_closed");
        expect(discord.readMessage).not.toHaveBeenCalled();
        expectUntouched();
    });

    it("refuses the running picture of another roster: the two would overwrite each other", async () => {
        const other = rosterStore.createRoster({ name: "Montag", guildId: "g1" });
        rosterStore.setImagePost(other.id, { ...LIVE_POST, messageId: MESSAGE });
        const res = await attach();
        expect(status(res)).toBe(409);
        expect(code(res)).toBe("in_use");
        expectUntouched();
        expect(rosterStore.getRoster(other.id).imagePost.messageId).toBe(MESSAGE);
    });

    it("checks the manager, the write right and the roster like the post does", async () => {
        mockUser = WRITER;
        const writer = await attach();
        expect(status(writer)).toBe(403);
        expect(code(writer)).toBe("not_manager");
        mockUser = READER;
        expect(status(await attach())).toBe(403);
        mockUser = MANAGER;
        expect(status(await attach({ id: "nope" }))).toBe(404);
        expect(code(await attach({ id: "" }))).toBe("bad_request");
        expect(discord.readMessage).not.toHaveBeenCalled();
    });

    it("deletes the roster's previous picture on this server, after the new one is remembered", async () => {
        rosterStore.setImagePost(roster.id, LIVE_POST);
        let storedAtDelete = "";
        discord.deleteMessage.mockImplementationOnce(async () => {
            storedAtDelete = rosterStore.getRoster(roster.id).imagePost.messageId;
            return true;
        });
        expect(status(await attach())).toBe(200);
        expect(storedAtDelete).toBe(MESSAGE);
        expect(discord.deleteMessage).toHaveBeenCalledTimes(1);
        expect(discord.deleteMessage).toHaveBeenCalledWith(CHANNEL, LIVE_POST.messageId);
    });

    it("leaves a previous picture on another server alone", async () => {
        rosterStore.setImagePost(roster.id, { ...LIVE_POST, guildId: "g2" });
        expect(status(await attach())).toBe(200);
        expect(discord.deleteMessage).not.toHaveBeenCalled();
    });

    it("takes new switches and a new text when the same message comes again, and deletes nothing", async () => {
        rosterStore.setImagePost(roster.id, { ...LIVE_POST, messageId: MESSAGE });
        expect(status(await attach({ chars: true, text: "  Heute 20 Uhr " }))).toBe(200);
        expect(discord.editPayload.mock.calls[0][2].content).toBe("Heute 20 Uhr");
        expect(discord.deleteMessage).not.toHaveBeenCalled();
        expect(rosterStore.getRoster(roster.id).imagePost).toMatchObject({ messageId: MESSAGE, reserve: false, chars: true, text: "Heute 20 Uhr" });
    });

    it("keeps the text within 500 characters", async () => {
        expect(status(await attach({ text: "x".repeat(600) }))).toBe(200);
        expect(discord.editPayload.mock.calls[0][2].content).toHaveLength(500);
        expect(rosterStore.getRoster(roster.id).imagePost.text).toHaveLength(500);
    });

    it("stores nothing and deletes nothing when the roster is deleted during the edit", async () => {
        discord.editPayload.mockImplementationOnce(async (channelId, messageId) => {
            rosterStore.deleteRoster(roster.id);
            return { channelId, messageId, url: "u" };
        });
        const res = await attach();
        expect(status(res)).toBe(404);
        expect(code(res)).toBe("not_found");
        expect(discord.deleteMessage).not.toHaveBeenCalled();
        expect(rosterStore.getRoster(roster.id)).toBeFalsy();
    });

    it("stores nothing when the roster is closed during the edit or the message taken meanwhile", async () => {
        discord.editPayload.mockImplementationOnce(async (channelId, messageId) => {
            rosterStore.closeRoster(roster.id);
            return { channelId, messageId, url: "u" };
        });
        expect(code(await attach())).toBe("roster_closed");
        expect(rosterStore.getRoster(roster.id).imagePost).toBeNull();

        const open = rosterStore.createRoster({ name: "Frei", guildId: "g1", managers: { userIds: [MANAGER.id], roleIds: [] } });
        const other = rosterStore.createRoster({ name: "Montag", guildId: "g1" });
        discord.editPayload.mockImplementationOnce(async (channelId, messageId) => {
            rosterStore.setImagePost(other.id, { ...LIVE_POST, messageId: MESSAGE });
            return { channelId, messageId, url: "u" };
        });
        expect(code(await attach({ id: open.id }))).toBe("in_use");
        expect(rosterStore.getRoster(open.id).imagePost).toBeNull();
        // the message shows the wrong roster now: the owner's emptied hash makes the job redraw it
        expect(rosterStore.getRoster(other.id).imagePost).toMatchObject({ messageId: MESSAGE, hash: "" });
    });
});

describe("parseMessageRef", () => {
    const { parseMessageRef } = routeModule;

    it("reads Discord's link, also from the test clients and with a tail", () => {
        const want = { guildId: "11111", channelId: "22222", messageId: "33333" };
        expect(parseMessageRef("https://discord.com/channels/11111/22222/33333")).toEqual(want);
        expect(parseMessageRef("https://ptb.discord.com/channels/11111/22222/33333/")).toEqual(want);
        expect(parseMessageRef("https://canary.discordapp.com/channels/11111/22222/33333?x=1")).toEqual(want);
        expect(parseMessageRef("  https://discord.com/channels/11111/22222/33333  ")).toEqual(want);
    });

    it("reads the pair and the bare id", () => {
        expect(parseMessageRef("22222-33333")).toEqual({ guildId: "", channelId: "22222", messageId: "33333" });
        expect(parseMessageRef("33333")).toEqual({ guildId: "", channelId: "", messageId: "33333" });
    });

    it("gives nothing for anything else", () => {
        for (const raw of ["", null, undefined, "abc", "123", "https://evil.example/channels/11111/22222/33333", "https://discord.com/channels/11111/22222", "11111/22222"]) {
            expect(parseMessageRef(raw)).toBeNull();
        }
    });
});

describe("postFailure", () => {
    it("knows the message Discord no longer has", () => {
        expect(postFailure({ code: 10008 })).toEqual([404, "message_not_found", expect.any(String)]);
    });

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
