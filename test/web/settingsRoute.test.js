// The settings handlers, called directly: what the redesigned Einstellungen page
// needs beyond the config (channel list and bot status for the connection card)
// and that a per-account grant actually reaches the store.
jest.mock("../../src/web/apiMiddleware", () => ({
    requireAdmin: jest.fn(),
    requireFullAdmin: jest.fn(),
    requireCsrf: jest.fn(() => true),
}));
jest.mock("../../src/web/apiBody", () => ({ readJsonBody: jest.fn() }));
jest.mock("../../src/web/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../src/web/settingsStore", () => ({
    getConfig: jest.fn(() => ({})),
    saveConfig: jest.fn((partial) => partial),
    listRaidsheets: jest.fn(() => []),
    saveRaidsheet: jest.fn(),
    deleteRaidsheet: jest.fn(),
}));
jest.mock("../../src/web/ingestTokenStore", () => ({
    listTokens: jest.fn(() => []),
    createToken: jest.fn(),
    revokeToken: jest.fn(),
}));
jest.mock("../../src/web/discord", () => ({
    listRoles: jest.fn(() => []),
    listCategories: jest.fn(() => []),
    listTextChannels: jest.fn(() => []),
    resolveUserNames: jest.fn(async () => ({})),
    getClient: jest.fn(() => null),
    getGuild: jest.fn(() => null),
    listGuilds: jest.fn(() => []),
    botPermissionsIn: jest.fn(() => null),
    fetchGuildMembersCached: jest.fn(async () => []),
}));
jest.mock("../../src/utils/wowhead", () => ({ searchItems: jest.fn(async () => []) }));

const { requireAdmin, requireFullAdmin } = require("../../src/web/apiMiddleware");
const { readJsonBody } = require("../../src/web/apiBody");
const settingsStore = require("../../src/web/settingsStore");
const discord = require("../../src/web/discord");
const { getSettings, updateSettings, getDiscordServers, FULL_ADMIN_KEYS } = require("../../src/web/apiRoutes/settings");

function mockRes() {
    return { writeHead: jest.fn(), end: jest.fn() };
}
const body = (res) => JSON.parse(res.end.mock.calls[0][0]);

const ADMIN = { id: "1", name: "Admin", isAdmin: true };

beforeEach(() => {
    jest.clearAllMocks();
    requireAdmin.mockReturnValue(ADMIN);
    requireFullAdmin.mockReturnValue(ADMIN);
    discord.getClient.mockReset().mockReturnValue(null);
    discord.getGuild.mockReset().mockReturnValue(null);
});

describe("GET /api/settings for the redesigned page", () => {
    it("lists the text channels so the module fields can pick one by name", async () => {
        discord.listTextChannels.mockReturnValue([{ id: "c1", name: "log-uploads", category: "Raids" }]);
        const res = mockRes();
        await getSettings({}, res);
        expect(discord.listTextChannels).toHaveBeenCalledWith("g1");
        expect(body(res).data.channels).toEqual([{ id: "c1", name: "log-uploads", category: "Raids" }]);
    });

    it("reports the bot as online with the guild name when the client is ready", async () => {
        discord.getClient.mockReturnValue({ isReady: () => true, readyTimestamp: 1700000000000 });
        discord.getGuild.mockReturnValue({ name: "Pulse" });
        const res = mockRes();
        await getSettings({}, res);
        expect(body(res).data.bot).toEqual({ online: true, readySince: 1700000000000, guildName: "Pulse" });
    });

    it("reads a missing or broken client as offline instead of failing the page", async () => {
        const res = mockRes();
        await getSettings({}, res);
        expect(body(res).data.bot).toEqual({ online: false, readySince: 0, guildName: "" });

        discord.getClient.mockImplementation(() => { throw new Error("boom"); });
        const res2 = mockRes();
        await getSettings({}, res2);
        expect(body(res2).data.bot.online).toBe(false);
    });
});

describe("PATCH /api/settings userPermissions", () => {
    it("normalises and stores the per-account grants", async () => {
        readJsonBody.mockResolvedValue({
            userPermissions: { "123456789012345678": { lootcouncil: { write: true } } },
        });
        const res = mockRes();
        await updateSettings({ headers: {} }, res);
        expect(settingsStore.saveConfig).toHaveBeenCalledWith({
            userPermissions: { "123456789012345678": { lootcouncil: { read: true, write: true } } },
        });
    });

    it("stays full-admin-only", async () => {
        requireAdmin.mockReturnValue({ id: "7", isAdmin: false });
        requireFullAdmin.mockReturnValue(null);
        readJsonBody.mockResolvedValue({ userPermissions: {} });
        await updateSettings({ headers: {} }, mockRes());
        expect(settingsStore.saveConfig).not.toHaveBeenCalled();
    });
});

// Two Discord servers (#251): the event server and the talk server.
describe("Discord-Server settings", () => {
    const stored = {
        guildId: "200",
        discordServers: { eventGuildId: "200", talkGuildId: "300", talkOverviewChannelId: "301", talkPingChannelId: "" },
    };
    const guild = (id, name, memberCount) => ({ id, name, memberCount });

    it("keeps the server block full-admin-only", () => {
        expect(FULL_ADMIN_KEYS).toContain("discordServers");
    });

    it("stores only the sent fields of the block", async () => {
        readJsonBody.mockResolvedValue({ discordServers: { talkPingChannelId: " 302 ", bogus: "x" } });
        await updateSettings({ headers: {} }, mockRes());
        expect(settingsStore.saveConfig).toHaveBeenCalledWith({ discordServers: { talkPingChannelId: "302" } });
    });

    it("refuses the block for a limited settings user", async () => {
        requireAdmin.mockReturnValue({ id: "7", isAdmin: false });
        requireFullAdmin.mockReturnValue(null);
        readJsonBody.mockResolvedValue({ discordServers: { eventGuildId: "999999" } });
        await updateSettings({ headers: {} }, mockRes());
        expect(settingsStore.saveConfig).not.toHaveBeenCalled();
    });

    it("puts both server cards into GET /api/settings for a full admin only", async () => {
        settingsStore.getConfig.mockReturnValue(stored);
        discord.getGuild.mockImplementation((id) => (id === "200" ? guild("200", "Pulse Events", 212) : null));
        discord.botPermissionsIn.mockReturnValue([{ key: "ManageRoles", label: "Rollen verwalten", ok: false }]);
        const res = mockRes();
        await getSettings({}, res);
        const { servers, config } = body(res).data;
        expect(servers.event).toMatchObject({ role: "event", name: "Pulse Events", connected: true, missing: ["Rollen verwalten"] });
        expect(servers.talk).toMatchObject({ role: "talk", id: "300", connected: false });
        expect(config.discordServers).toEqual(stored.discordServers);

        requireAdmin.mockReturnValue({ id: "7", isAdmin: false });
        const res2 = mockRes();
        await getSettings({}, res2);
        expect(body(res2).data.servers).toBeNull();
        expect(body(res2).data.config.discordServers).toBeUndefined();
        settingsStore.getConfig.mockReturnValue({});
    });

    it("serves the section: cards, overlap and every server with role and channels", async () => {
        settingsStore.getConfig.mockReturnValue(stored);
        discord.getGuild.mockImplementation((id) => guild(id, id === "200" ? "Pulse Events" : "Pulse Talk", 10));
        discord.listGuilds.mockReturnValue([{ id: "200", name: "Pulse Events" }, { id: "300", name: "Pulse Talk" }, { id: "400", name: "Andere" }]);
        discord.listTextChannels.mockImplementation((id) => [{ id: `${id}1`, name: "chat", category: "" }]);
        discord.fetchGuildMembersCached.mockImplementation(async (id) => (id === "200"
            ? [{ id: "a", user: {} }, { id: "b", user: {} }]
            : [{ id: "b", user: {} }]));
        const res = mockRes();
        await getDiscordServers({}, res);
        const data = body(res).data;
        expect(data.discordServers).toEqual(stored.discordServers);
        expect(data.event.name).toBe("Pulse Events");
        expect(data.talk.name).toBe("Pulse Talk");
        expect(data.overlap).toEqual({ eventCount: 2, talkCount: 1, both: 1, error: null });
        expect(data.guilds.map((g) => [g.id, g.role, g.channels[0].id])).toEqual([
            ["200", "event", "2001"], ["300", "talk", "3001"], ["400", "", "4001"],
        ]);
        settingsStore.getConfig.mockReturnValue({});
    });

    it("answers the section to full admins only", async () => {
        requireFullAdmin.mockReturnValue(null);
        const res = mockRes();
        await getDiscordServers({}, res);
        expect(res.end).not.toHaveBeenCalled();
        expect(discord.listGuilds).not.toHaveBeenCalled();
    });
});
