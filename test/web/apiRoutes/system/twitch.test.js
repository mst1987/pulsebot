let mockUser;
let mockConfig;

jest.mock("../../../../src/web/http/apiMiddleware", () => require("../../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../../src/web/http/apiBody", () => require("../../../helpers/http").apiBodyMock());
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn() }));
jest.mock("../../../../src/web/http/serverQuery", () => ({
    mayUseChannel: jest.fn(),
    guildOfChannel: jest.fn(),
    OTHER_SERVER: "Das gehört zu einem anderen Server.",
}));
jest.mock("../../../../src/stores/settings/settingsStore", () => ({
    getConfig: jest.fn(() => mockConfig),
    saveConfig: jest.fn((partial) => {
        for (const [guildId, block] of Object.entries(partial.serverSettings || {})) {
            mockConfig.serverSettings[guildId] = { ...mockConfig.serverSettings[guildId], ...block };
        }
        return mockConfig;
    }),
}));
jest.mock("../../../../src/services/discord/discord", () => ({
    listRoles: jest.fn(),
    findRolesAnywhere: jest.fn(),
    isNonTextChannel: jest.fn(),
    mentionInfoIn: jest.fn(),
}));
jest.mock("../../../../src/services/twitch/twitchJob", () => ({
    runTwitchCheck: jest.fn(),
    twitchStatusOf: jest.fn(),
    lastTwitchRun: jest.fn(),
}));

const { readJsonBody } = require("../../../../src/web/http/apiBody");
const { requireCsrf } = require("../../../../src/web/http/apiMiddleware");
const { activeGuildFor } = require("../../../../src/web/http/activeGuild");
const { mayUseChannel, guildOfChannel } = require("../../../../src/web/http/serverQuery");
const { saveConfig } = require("../../../../src/stores/settings/settingsStore");
const discord = require("../../../../src/services/discord/discord");
const twitchJob = require("../../../../src/services/twitch/twitchJob");
const { AREA_BY_PATH } = require("../../../../src/web/http/apiAccess");
const { mockRes, status, body, json } = require("../../../helpers/http");
const {
    getStreamers, postStreamer, putStreamer, deleteStreamer, postCheck, routes,
} = require("../../../../src/web/apiRoutes/system/twitch");

const GUILD_A = "100000";
const GUILD_B = "200000";
const CHANNEL_A = "111111";
const CHANNEL_B = "222222";
const ROLE_A = "555555";
const ROLE_B = "666666";
const SECRET = "geheim-123";

const stored = (over = {}) => ({ login: "foo", channelId: CHANNEL_A, roleId: "", text: "", games: [], source: "orga", ...over });

async function call(handler, payload) {
    if (payload !== undefined) readJsonBody.mockResolvedValueOnce(payload);
    const res = mockRes();
    await handler({}, res, new URL("http://localhost/api/settings/twitch"));
    return res;
}

const write = (handler, payload) => call(handler, { serverSettingsGuildId: GUILD_A, ...payload });
const code = (res) => json(res).error.code;
const listOf = (guildId = GUILD_A) => mockConfig.serverSettings[guildId].twitchStreamers;

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: "1", name: "Orga", isAdmin: false };
    mockConfig = {
        guildId: "",
        twitch: { clientId: "client", clientSecret: SECRET },
        discordServers: { servers: [{ guildId: GUILD_A }, { guildId: GUILD_B }], links: [] },
        serverSettings: {
            [GUILD_A]: { twitchStreamers: [stored()] },
            [GUILD_B]: { twitchStreamers: [stored({ channelId: CHANNEL_B, text: "von B" })] },
        },
    };
    activeGuildFor.mockReturnValue(GUILD_A);
    const owners = { [CHANNEL_A]: GUILD_A, [CHANNEL_B]: GUILD_B };
    guildOfChannel.mockImplementation((id) => owners[id] || "");
    // the real check: a full admin may everywhere, the others on the active server only
    mayUseChannel.mockImplementation((user, _req, id) => user.isAdmin || owners[id] === GUILD_A);
    discord.listRoles.mockImplementation((guildId) => (guildId === GUILD_A ? [{ id: ROLE_A, name: "Stream" }] : [{ id: ROLE_B, name: "Andere" }]));
    discord.findRolesAnywhere.mockImplementation(([id]) => (id === ROLE_B ? { [id]: { guildId: GUILD_B } } : {}));
    discord.isNonTextChannel.mockReturnValue(false);
    discord.mentionInfoIn.mockReturnValue({ botCanMentionAll: false, unmentionableRoleIds: [ROLE_A] });
    twitchJob.lastTwitchRun.mockReturnValue({ at: 123, error: "" });
    twitchJob.twitchStatusOf.mockImplementation((entries) => entries.map((e) => ({
        login: e.login, state: "offline", since: "", endedAt: 0, title: "", game: "", viewers: 0, messageGone: false, error: "",
    })));
    twitchJob.runTwitchCheck.mockResolvedValue({ checked: 1, live: 0 });
});

describe("the route table", () => {
    it("is part of the area settings on every path", () => {
        expect(routes.map((r) => `${r.method} ${r.path} ${r.area}`)).toEqual([
            "GET /api/settings/twitch settings",
            "POST /api/settings/twitch settings",
            "PUT /api/settings/twitch settings",
            "DELETE /api/settings/twitch settings",
            "POST /api/settings/twitch/check settings",
        ]);
        expect(AREA_BY_PATH["/api/settings/twitch"]).toBe("settings");
        expect(AREA_BY_PATH["/api/settings/twitch/check"]).toBe("settings");
    });
});

describe("GET /api/settings/twitch", () => {
    it("answers the list of the active server with its status and the limits", async () => {
        twitchJob.twitchStatusOf.mockReturnValueOnce([{
            login: "foo", state: "live", since: "2026-11-03T18:00:00Z", endedAt: 0, title: "Raid", game: "WoW", viewers: 7, messageGone: false, postedChannelId: "", error: "",
        }]);
        const res = await call(getStreamers);

        expect(status(res)).toBe(200);
        expect(twitchJob.twitchStatusOf).toHaveBeenCalledWith([{ guildId: GUILD_A, ...stored() }]);
        expect(body(res)).toEqual({
            guildId: GUILD_A,
            hasCredentials: true,
            mention: { botCanMentionAll: false, unmentionableRoleIds: [ROLE_A] },
            lastRun: { at: 123, error: "" },
            limits: { streamers: 25, textLength: 500, games: 5, gameNameLength: 60 },
            streamers: [{
                ...stored(),
                status: { state: "live", since: "2026-11-03T18:00:00Z", endedAt: 0, title: "Raid", game: "WoW", viewers: 7, messageGone: false, postedChannelId: "", error: "" },
            }],
        });
    });

    it("asks about the mention rights of the active server and passes on that nothing is known", async () => {
        discord.mentionInfoIn.mockReturnValue({ botCanMentionAll: null, unmentionableRoleIds: [] });
        const res = await call(getStreamers);
        expect(discord.mentionInfoIn).toHaveBeenCalledWith(GUILD_A);
        expect(body(res).mention).toEqual({ botCanMentionAll: null, unmentionableRoleIds: [] });
    });

    it("gives a limited settings user only yes or no about the credentials", async () => {
        const res = await call(getStreamers);
        expect(body(res).hasCredentials).toBe(true);
        expect(JSON.stringify(json(res))).not.toContain("clientId");
    });

    it("never carries the secret, only whether the credentials are set", async () => {
        const res = await call(getStreamers);
        expect(JSON.stringify(json(res))).not.toContain(SECRET);
        expect(JSON.stringify(json(res))).not.toContain("clientSecret");

        mockConfig.twitch = { clientId: "client", clientSecret: "" };
        expect(body(await call(getStreamers)).hasCredentials).toBe(false);
    });

    it("refuses without an active server", async () => {
        activeGuildFor.mockReturnValue("");
        const res = await call(getStreamers);
        expect(status(res)).toBe(400);
        expect(code(res)).toBe("no_active_server");
    });

    it("needs a signed-in user", async () => {
        mockUser = null;
        const res = await call(getStreamers);
        expect(status(res)).toBe(401);
    });
});

describe("POST /api/settings/twitch", () => {
    it("adds an entry from a channel link, with role, text and games", async () => {
        const res = await write(postStreamer, {
            login: "https://www.twitch.tv/Bar", channelId: CHANNEL_A, roleId: ROLE_A, text: "Hallo", games: ["WoW"], source: "raider",
        });

        expect(status(res)).toBe(200);
        expect(listOf()).toEqual([stored(), {
            login: "bar", channelId: CHANNEL_A, roleId: ROLE_A, text: "Hallo", games: ["WoW"], source: "orga",
        }]);
        expect(body(res).streamers.map((e) => e.login)).toEqual(["foo", "bar"]);
        expect(body(res).streamers[1].status.state).toBe("offline");
    });

    it("needs the CSRF token", async () => {
        requireCsrf.mockReturnValueOnce(false);
        const res = mockRes();
        await postStreamer({}, res, new URL("http://localhost/x"));
        expect(saveConfig).not.toHaveBeenCalled();
    });

    it.each([
        ["invalid_login", { login: "foo bar", channelId: CHANNEL_A }],
        ["invalid_login", { login: "https://www.twitch.tv/videos/1", channelId: CHANNEL_A }],
        ["duplicate_streamer", { login: "FOO", channelId: CHANNEL_A }],
        ["missing_channel", { login: "bar" }],
        ["invalid_role", { login: "bar", channelId: CHANNEL_A, roleId: "abc" }],
        ["text_too_long", { login: "bar", channelId: CHANNEL_A, text: "x".repeat(501) }],
        ["too_many_games", { login: "bar", channelId: CHANNEL_A, games: ["a", "b", "c", "d", "e", "f"] }],
    ])("refuses with 400 %s", async (expected, payload) => {
        const res = await write(postStreamer, payload);
        expect(status(res)).toBe(400);
        expect(code(res)).toBe(expected);
        expect(saveConfig).not.toHaveBeenCalled();
    });

    it("refuses a 26th streamer with too_many", async () => {
        mockConfig.serverSettings[GUILD_A].twitchStreamers = Array.from({ length: 25 }, (_, i) => stored({ login: `name${i}` }));
        const res = await write(postStreamer, { login: "bar", channelId: CHANNEL_A });
        expect(status(res)).toBe(400);
        expect(code(res)).toBe("too_many");
    });

    it("refuses @everyone as a ping, a full admin as well", async () => {
        mockUser = { id: "1", name: "Admin", isAdmin: true };
        const res = await write(postStreamer, { login: "bar", channelId: CHANNEL_A, roleId: GUILD_A });
        expect(status(res)).toBe(400);
        expect(code(res)).toBe("invalid_role");
        expect(saveConfig).not.toHaveBeenCalled();
    });

    it("lets a full admin use a channel or role the bot does not see, but none it knows elsewhere", async () => {
        mockUser = { id: "1", name: "Admin", isAdmin: true };

        expect(status(await write(postStreamer, { login: "bar", channelId: "999999", roleId: "888888" }))).toBe(200);

        const foreignChannel = await write(postStreamer, { login: "baz", channelId: CHANNEL_B });
        expect(status(foreignChannel)).toBe(403);
        expect(code(foreignChannel)).toBe("other_server");

        const foreignRole = await write(postStreamer, { login: "baz", channelId: CHANNEL_A, roleId: ROLE_B });
        expect(status(foreignRole)).toBe(403);
        expect(code(foreignRole)).toBe("other_server");
    });
});

describe("PUT /api/settings/twitch", () => {
    it("changes what is sent and keeps what is left out", async () => {
        mockConfig.serverSettings[GUILD_A].twitchStreamers = [stored({ roleId: ROLE_A, text: "alt", games: ["WoW"] })];
        const res = await write(putStreamer, { login: "FOO", text: "neu" });
        expect(status(res)).toBe(200);
        expect(listOf()).toEqual([stored({ roleId: ROLE_A, text: "neu", games: ["WoW"] })]);
    });

    it("removes the role with an empty one", async () => {
        mockConfig.serverSettings[GUILD_A].twitchStreamers = [stored({ roleId: ROLE_A })];
        await write(putStreamer, { login: "foo", roleId: "" });
        expect(listOf()[0].roleId).toBe("");
    });

    it("answers 404 for a login this server does not list", async () => {
        const res = await write(putStreamer, { login: "bar", text: "neu" });
        expect(status(res)).toBe(404);
        expect(code(res)).toBe("not_found");
    });

    it("does not check an unchanged channel or role again", async () => {
        mockConfig.serverSettings[GUILD_A].twitchStreamers = [stored({ channelId: "999999", roleId: "888888" })];
        const res = await write(putStreamer, { login: "foo", text: "neu" });
        expect(status(res)).toBe(200);
        expect(mayUseChannel).not.toHaveBeenCalled();
        expect(discord.listRoles).not.toHaveBeenCalled();
    });

    it("refuses what the check of the whole entry refuses", async () => {
        const res = await write(putStreamer, { login: "foo", channelId: "" });
        expect(status(res)).toBe(400);
        expect(code(res)).toBe("missing_channel");
    });
});

describe("DELETE /api/settings/twitch", () => {
    it("removes the entry of this server only", async () => {
        const res = await write(deleteStreamer, { login: "foo" });
        expect(status(res)).toBe(200);
        expect(body(res).streamers).toEqual([]);
        expect(listOf()).toEqual([]);
        expect(listOf(GUILD_B)).toHaveLength(1);
    });

    it("answers 404 for a login this server does not list", async () => {
        const res = await write(deleteStreamer, { login: "bar" });
        expect(status(res)).toBe(404);
        expect(code(res)).toBe("not_found");
        expect(saveConfig).not.toHaveBeenCalled();
    });
});

describe("POST /api/settings/twitch/check", () => {
    it("checks the active server and answers the result with the fresh view", async () => {
        const res = await write(postCheck, {});
        expect(twitchJob.runTwitchCheck).toHaveBeenCalledWith({ guildId: GUILD_A });
        expect(status(res)).toBe(200);
        expect(body(res).result).toEqual({ checked: 1, live: 0 });
        expect(body(res).streamers).toHaveLength(1);
    });

    it("answers that Twitch did not answer as an answer", async () => {
        twitchJob.runTwitchCheck.mockResolvedValue({ skipped: "no_credentials" });
        const res = await write(postCheck, {});
        expect(status(res)).toBe(200);
        expect(body(res).result).toEqual({ skipped: "no_credentials" });
        expect(JSON.stringify(json(res))).not.toContain(SECRET);
    });
});

describe("a channel that is no text channel", () => {
    beforeEach(() => {
        discord.isNonTextChannel.mockImplementation((id) => id === CHANNEL_A);
    });

    it("is refused on add", async () => {
        mockConfig.serverSettings[GUILD_A].twitchStreamers = [];
        const res = await write(postStreamer, { login: "bar", channelId: CHANNEL_A });
        expect(status(res)).toBe(400);
        expect(code(res)).toBe("invalid_channel");
        expect(saveConfig).not.toHaveBeenCalled();
    });

    it("is refused on a change to it", async () => {
        mockConfig.serverSettings[GUILD_A].twitchStreamers = [stored({ channelId: "333333" })];
        guildOfChannel.mockReturnValue(GUILD_A);
        mayUseChannel.mockReturnValue(true);
        const res = await write(putStreamer, { login: "foo", channelId: CHANNEL_A });
        expect(status(res)).toBe(400);
        expect(code(res)).toBe("invalid_channel");
        expect(saveConfig).not.toHaveBeenCalled();
    });

    it("does not block a new text on a channel that stays", async () => {
        const res = await write(putStreamer, { login: "foo", text: "Neu" });
        expect(status(res)).toBe(200);
        expect(listOf()[0].text).toBe("Neu");
        expect(discord.isNonTextChannel).not.toHaveBeenCalled();
    });

    it("answers other_server first for a channel of another server", async () => {
        discord.isNonTextChannel.mockReturnValue(true);
        const res = await write(postStreamer, { login: "bar", channelId: CHANNEL_B });
        expect(status(res)).toBe(403);
        expect(code(res)).toBe("other_server");
    });

    it("lets a channel pass that the bot does not know (offline)", async () => {
        discord.isNonTextChannel.mockReturnValue(false);
        mockUser = { id: "1", name: "Admin", isAdmin: true };
        const res = await write(postStreamer, { login: "bar", channelId: "444444" });
        expect(status(res)).toBe(200);
        expect(listOf().map((e) => e.login)).toEqual(["foo", "bar"]);
    });
});

describe("an orga of server B on the data of server A", () => {
    const handlers = [
        ["POST", postStreamer, { login: "bar", channelId: CHANNEL_A }],
        ["PUT", putStreamer, { login: "foo", text: "fremd" }],
        ["DELETE", deleteStreamer, { login: "foo" }],
        ["check", postCheck, {}],
    ];

    it.each(handlers)("%s with server B active and a tab of A gets 409 and changes nothing", async (_name, handler, payload) => {
        activeGuildFor.mockReturnValue(GUILD_B);
        const before = JSON.stringify(mockConfig.serverSettings);

        const res = await call(handler, { serverSettingsGuildId: GUILD_A, ...payload });

        expect(status(res)).toBe(409);
        expect(code(res)).toBe("server_switched");
        expect(saveConfig).not.toHaveBeenCalled();
        expect(twitchJob.runTwitchCheck).not.toHaveBeenCalled();
        expect(JSON.stringify(mockConfig.serverSettings)).toBe(before);
    });

    it.each(handlers)("%s naming server A in the body stays out with server B active", async (_name, handler, payload) => {
        activeGuildFor.mockReturnValue(GUILD_B);
        const res = await call(handler, { guildId: GUILD_A, serverSettingsGuildId: GUILD_A, ...payload });
        expect(status(res)).toBe(409);
    });

    it("a channel of another server gets 403 other_server", async () => {
        const res = await write(postStreamer, { login: "bar", channelId: CHANNEL_B });
        expect(status(res)).toBe(403);
        expect(code(res)).toBe("other_server");
        expect(saveConfig).not.toHaveBeenCalled();
    });

    it("a role of another server gets 403 other_server, on add and on change", async () => {
        const added = await write(postStreamer, { login: "bar", channelId: CHANNEL_A, roleId: ROLE_B });
        expect(status(added)).toBe(403);
        expect(code(added)).toBe("other_server");

        const changed = await write(putStreamer, { login: "foo", roleId: ROLE_B });
        expect(status(changed)).toBe(403);
        expect(code(changed)).toBe("other_server");
        expect(saveConfig).not.toHaveBeenCalled();
    });

    it("a role the bot does not know gets 403 as well for anyone but a full admin", async () => {
        const res = await write(postStreamer, { login: "bar", channelId: CHANNEL_A, roleId: "888888" });
        expect(status(res)).toBe(403);
    });

    it("an unlisted login of the other server gets 404, its entry stays untouched", async () => {
        mockConfig.serverSettings[GUILD_B].twitchStreamers = [stored({ login: "nurb", channelId: CHANNEL_B })];
        const res = await write(deleteStreamer, { login: "nurb" });
        expect(status(res)).toBe(404);
        expect(code(res)).toBe("not_found");
        expect(listOf(GUILD_B)).toHaveLength(1);
    });
});

describe("writes without a target", () => {
    it("refuses without an active server", async () => {
        activeGuildFor.mockReturnValue("");
        const res = await write(postCheck, {});
        expect(status(res)).toBe(400);
        expect(code(res)).toBe("no_active_server");
    });

    it("refuses a server of no list instead of saving nothing", async () => {
        mockConfig.discordServers = { servers: [], links: [] };
        const res = await write(postStreamer, { login: "bar", channelId: CHANNEL_A });
        expect(status(res)).toBe(400);
        expect(code(res)).toBe("unknown_server");
    });
});
