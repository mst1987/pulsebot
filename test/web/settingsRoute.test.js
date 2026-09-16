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
}));
jest.mock("../../src/utils/wowhead", () => ({ searchItems: jest.fn(async () => []) }));

const { requireAdmin, requireFullAdmin } = require("../../src/web/apiMiddleware");
const { readJsonBody } = require("../../src/web/apiBody");
const settingsStore = require("../../src/web/settingsStore");
const discord = require("../../src/web/discord");
const { getSettings, updateSettings } = require("../../src/web/apiRoutes/settings");

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
