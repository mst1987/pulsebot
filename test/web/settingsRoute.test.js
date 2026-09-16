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
    listRaidTemplates: jest.fn(() => [{ id: "k1", name: "Kara", versionId: "tbc", size: 10, composition: { tank: 2, healer: 3 } }]),
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
// Reduced to the live list, like in apiRouter.test.js: no snapshot files touched.
jest.mock("../../src/web/categoryNames", () => ({
    listKnownCategories: (guildId) => require("../../src/web/discord").listCategories(guildId),
}));

const { requireAdmin, requireFullAdmin } = require("../../src/web/apiMiddleware");
const { readJsonBody } = require("../../src/web/apiBody");
const settingsStore = require("../../src/web/settingsStore");
const discord = require("../../src/web/discord");
const {
    getSettings, updateSettings, getDiscordServers, getRoleSync, getReminders, FULL_ADMIN_KEYS,
} = require("../../src/web/apiRoutes/settings");

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

describe("default raid template per category (#266)", () => {
    it("lists the raid templates for the select, names only", async () => {
        const res = mockRes();
        await getSettings({}, res);
        expect(body(res).data.raidTemplates).toEqual([{ id: "k1", name: "Kara", versionId: "tbc", size: 10 }]);
    });

    it("stores the map, dropping an id no template has", async () => {
        readJsonBody.mockResolvedValue({ categoryRaidTemplate: { c1: "k1", c2: "gone" } });
        await updateSettings({ headers: {} }, mockRes());
        expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categoryRaidTemplate: { c1: "k1" } });
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

describe("PATCH /api/settings botCommandAccess", () => {
    it("normalises and stores the bot command rules", async () => {
        readJsonBody.mockResolvedValue({
            botCommandAccess: {
                fillsetup: { mode: "roles", roleIds: ["123456789012345678", "nope"] },
                logcheck: { mode: "bogus" },
            },
        });
        await updateSettings({ headers: {} }, mockRes());
        expect(settingsStore.saveConfig).toHaveBeenCalledWith({
            botCommandAccess: { fillsetup: { mode: "roles", roleIds: ["123456789012345678"] } },
        });
    });

    it("cannot be saved by a settings user who is not a full admin", async () => {
        requireAdmin.mockReturnValue({ id: "7", isAdmin: false });
        requireFullAdmin.mockReturnValue(null);
        readJsonBody.mockResolvedValue({ botCommandAccess: { fillsetup: { mode: "everyone" } } });
        await updateSettings({ headers: {} }, mockRes());
        expect(requireFullAdmin).toHaveBeenCalled();
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

// Role sync and reminders (#264).
describe("role sync and reminder settings", () => {
    it("keeps the role mapping full-admin-only, the reminders not", async () => {
        expect(FULL_ADMIN_KEYS).toContain("roleSync");
        expect(FULL_ADMIN_KEYS).not.toContain("categoryReminders");

        requireAdmin.mockReturnValue({ id: "7", isAdmin: false });
        requireFullAdmin.mockReturnValue(null);
        readJsonBody.mockResolvedValue({ roleSync: [{ eventRoleId: "111111", talkRoleId: "222222" }] });
        await updateSettings({ headers: {} }, mockRes());
        expect(settingsStore.saveConfig).not.toHaveBeenCalled();

        readJsonBody.mockResolvedValue({ categoryReminders: { 123456: { missingHours: 24 } } });
        await updateSettings({ headers: {} }, mockRes());
        expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categoryReminders: { 123456: { missingHours: 24 } } });
    });

    it("passes a full admin's mapping on and reads a non-list as empty", async () => {
        readJsonBody.mockResolvedValue({ roleSync: "kaputt", categoryReminders: null });
        await updateSettings({ headers: {} }, mockRes());
        expect(settingsStore.saveConfig).toHaveBeenCalledWith({ roleSync: [], categoryReminders: {} });
    });

    it("serves the role sync view to full admins only", async () => {
        settingsStore.getConfig.mockReturnValue({ roleSync: [] });
        const res = mockRes();
        await getRoleSync({}, res);
        expect(body(res).data).toMatchObject({ roleSync: [], drift: [], driftTotal: 0, driftError: null });

        requireFullAdmin.mockReturnValue(null);
        const res2 = mockRes();
        await getRoleSync({}, res2);
        expect(res2.end).not.toHaveBeenCalled();
        settingsStore.getConfig.mockReturnValue({});
    });

    it("lists the configured categories with names for the reminders", async () => {
        settingsStore.getConfig.mockReturnValue({
            guildId: "200000",
            categoryIds: ["900000"],
            categoryRoles: { 900000: ["1", "2"] },
            categoryReminders: { 910000: { missingHours: 24, signedHours: 0, target: "event" } },
        });
        discord.listCategories.mockReturnValue([{ id: "900000", name: "Raids Mittwoch" }]);
        const res = mockRes();
        getReminders({}, res);
        const data = body(res).data;
        expect(discord.listCategories).toHaveBeenCalledWith("200000");
        expect(data.categories).toEqual([
            { id: "900000", name: "Raids Mittwoch", roleCount: 2 },
            { id: "910000", name: "", roleCount: 0 },
        ]);
        expect(data.pingTargets.talk).toBe(false);
        expect(data.categoryReminders["910000"].missingHours).toBe(24);
        settingsStore.getConfig.mockReturnValue({});
    });
});
