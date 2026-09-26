// The settings API: routed end to end (area gate, CSRF, 401/403) and the
// handlers called directly - what the redesigned Einstellungen page needs beyond
// the config (channel list and bot status for the connection card) and that a
// per-account grant actually reaches the store.

const { mockRes, json, body, routerClient } = require("../../helpers/http");

jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(),
    // "Ansicht als Rolle": the caller's own rights, and starting/stopping the view
    getRealUser: jest.fn(),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../src/stores/reportStore", () => ({
    listReports: jest.fn(() => []),
    deleteReport: jest.fn(() => true),
    getReport: jest.fn(() => null),
    saveReport: jest.fn((report, id) => id || "new-id"),
}));
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({})),
    saveConfig: jest.fn((partial) => ({ ...partial })),
    listRecruitment: jest.fn(() => []),
    getRecruitment: jest.fn(),
    saveRecruitment: jest.fn(),
    deleteRecruitment: jest.fn(),
    listRecruitmentPosts: jest.fn(() => []),
    getRecruitmentPost: jest.fn(),
    saveRecruitmentPost: jest.fn(),
    deleteRecruitmentPost: jest.fn(),
    listRaidsheets: jest.fn(() => []),
    saveRaidsheet: jest.fn(),
    deleteRaidsheet: jest.fn(),
    listRaidTemplates: jest.fn(() => []),
    getRaidTemplate: jest.fn(),
    saveRaidTemplate: jest.fn(),
    saveRaidTemplates: jest.fn(),
    deleteRaidTemplate: jest.fn(),
    listNotify: jest.fn(() => []),
    getNotify: jest.fn(),
    saveNotify: jest.fn(),
    deleteNotify: jest.fn(),
    getRaidsheet: jest.fn(),
    // Default: no category sheet configured, so a raid links only its own copy.
    resolveEventSheetLink: jest.fn((eventSheet) => (eventSheet && eventSheet.url
        ? { url: eventSheet.url, name: eventSheet.sheetName || "", source: "event" }
        : null)),
}));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "") }));
jest.mock("../../../src/stores/raidEventStore", () => ({
    getRaidEvent: jest.fn(() => null),
    listRaidEvents: jest.fn(() => []),
    saveRaidEvents: jest.fn(),
}));
// The routes label category ids through categoryNames.js, which merges the live
// Discord list with the names it snapshots to disk. Reduced here to the live
// list, so these route tests keep asserting against the discord mock alone and
// touch no files; the merging itself is covered by categoryNames.test.js.
jest.mock("../../../src/services/discord/categoryNames", () => ({
    listKnownCategories: (guildId) => (guildId ? require("../../../src/services/discord/discord").listCategories(guildId) : []),
    rememberCategories: jest.fn(),
}));
jest.mock("../../../src/stores/logStore", () => ({
    listLogs: jest.fn(() => []),
    listLogsForEvent: jest.fn(() => []),
    deleteLog: jest.fn(),
    getLog: jest.fn(),
    getByReportRefId: jest.fn(),
    linkEvent: jest.fn(),
    unlinkEvent: jest.fn(),
    clearEvaluation: jest.fn(),
    clearSection: jest.fn(),
    // mirrors the real implementation (explicit sections win, legacy done = cla)
    evaluatedSections: jest.fn((log) => {
        if (!log) return [];
        if (Array.isArray(log.sections) && log.sections.length) return log.sections;
        return log.status === "done" ? ["cla"] : [];
    }),
}));
jest.mock("../../../src/utils/loot/lootImport", () => {
    class LootParseError extends Error {}
    const actual = jest.requireActual("../../../src/utils/loot/lootImport");
    return {
        parseLoot: jest.fn(() => []),
        detectImportDate: jest.fn(() => null),
        enrichItemNames: jest.fn((items) => Promise.resolve(items)),
        // Pure normalisation, no I/O: the roster keys its rows with
        // characterKey, and buildManualItem's shape (dedup key included) is what
        // the loot-add endpoint is tested for — a stub would test the stub.
        characterKey: actual.characterKey,
        characterKeyOf: actual.characterKeyOf,
        splitPlayer: actual.splitPlayer,
        buildManualItem: actual.buildManualItem,
        LootParseError,
    };
});
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/discordMock").withClientHelpers({
    listGuilds: jest.fn(() => []),
    listCategories: jest.fn(() => []),
    listAllChannels: jest.fn(() => []),
    listTextChannels: jest.fn(() => []),
    listRoles: jest.fn(() => []),
    createChannel: jest.fn(),
    duplicateChannel: jest.fn(),
    listEmojis: jest.fn(() => []),
    postRecruitment: jest.fn(),
    editRecruitment: jest.fn(),
    scanRecruitment: jest.fn(() => Promise.resolve([])),
    listApplications: jest.fn(() => Promise.resolve({ applications: [], error: null })),
    getClient: jest.fn(() => null),
    getGuild: jest.fn(() => null),
    getChannelCategoryMap: jest.fn(() => ({})),
    listMembersWithRoles: jest.fn(() => Promise.resolve({ members: [], error: null })),
    resolveUserNames: jest.fn(() => Promise.resolve({})),
    postAnnouncement: jest.fn(),
    postMissingPing: jest.fn(),
    postLink: jest.fn(),
    editLink: jest.fn(),
    botPermissionsIn: jest.fn(() => null),
    fetchGuildMembersCached: jest.fn(async () => []),
}));
jest.mock("../../../src/web/raidEventGroups", () => ({
    loadEventGroups: jest.fn(() => Promise.resolve({ groups: [], error: null })),
    eventLookbackSince: jest.fn(() => 0),
    fetchEventsCached: jest.fn(() => Promise.resolve({ events: [] })),
}));
const mockGetTemplates = jest.fn(() => Promise.resolve([]));
const mockCreateEvent = jest.fn(() => Promise.resolve({ id: "ev1" }));
const mockGetPastEvents = jest.fn(() => Promise.resolve([]));
// The clone asks Raid-Helper for the one event it needs, by id.
const mockGetEvent = jest.fn(() => Promise.resolve(null));
const mockGetSetup = jest.fn(() => Promise.resolve({ setup: [] }));
jest.mock("../../../src/classes/raidhelper", () =>
    jest.fn().mockImplementation(() => ({
        getTemplates: mockGetTemplates,
        createEvent: mockCreateEvent,
        getPastEvents: mockGetPastEvents,
        getEvent: mockGetEvent,
        getSetup: mockGetSetup,
    })));
jest.mock("../../../src/utils/loot/wowhead", () => {
    const actual = jest.requireActual("../../../src/utils/loot/wowhead");
    return {
        searchItems: jest.fn(() => Promise.resolve([])),
        // Pure URL builders, no network: the loot catalogue's icon and Wowhead
        // links are exactly these strings, and stubbing them tests nothing.
        iconUrl: actual.iconUrl,
        itemLink: actual.itemLink,
    };
});
jest.mock("../../../src/stores/ingestTokenStore", () => ({
    listTokens: jest.fn(() => []),
    createToken: jest.fn(),
    revokeToken: jest.fn(),
}));
// The handlers are also called directly below (without the router): the
// middleware and the body reader run for real unless a test steers them.
jest.mock("../../../src/web/http/apiMiddleware", () => {
    const actual = jest.requireActual("../../../src/web/http/apiMiddleware");
    return {
        requireAdmin: jest.fn(actual.requireAdmin),
        requireFullAdmin: jest.fn(actual.requireFullAdmin),
        requireCsrf: jest.fn(actual.requireCsrf),
    };
});
jest.mock("../../../src/web/http/apiBody", () => {
    const actual = jest.requireActual("../../../src/web/http/apiBody");
    return { readJsonBody: jest.fn(actual.readJsonBody), readRawBody: jest.fn(actual.readRawBody) };
});
const auth = require("../../../src/web/http/auth");
const settingsStore = require("../../../src/stores/settingsStore");
const { activeGuildFor } = require("../../../src/web/http/activeGuild");
const discord = require("../../../src/services/discord/discord");
const wowhead = require("../../../src/utils/loot/wowhead");
const { AREA_IDS, emptyAccess } = require("../../../src/config/permissions");
const { post, patch, get, handle } = routerClient(require("../../../src/web/apiRoutes/settings"));
const { requireAdmin, requireFullAdmin } = require("../../../src/web/http/apiMiddleware");
const { readJsonBody } = require("../../../src/web/http/apiBody");
const {
    getSettings, updateSettings, getDiscordServers, getRoleSync, getReminders, FULL_ADMIN_KEYS,
} = require("../../../src/web/apiRoutes/settings");
const realMiddleware = jest.requireActual("../../../src/web/http/apiMiddleware");
const realBody = jest.requireActual("../../../src/web/http/apiBody");

describe("web/apiRoutes/settings", () => {
    describe("through the router", () => {
        beforeEach(() => {
            requireAdmin.mockReset().mockImplementation(realMiddleware.requireAdmin);
            requireFullAdmin.mockReset().mockImplementation(realMiddleware.requireFullAdmin);
            readJsonBody.mockReset().mockImplementation(realBody.readJsonBody);
        });

        // Routed end to end: the handler has to be imported, not only listed (#251).
        describe("GET /api/settings/discord-servers", () => {
            it("serves the server cards to a full admin", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                settingsStore.getConfig.mockReturnValue({ guildId: "g1", discordServers: { eventGuildId: "g1" } });
                discord.listGuilds.mockReturnValue([{ id: "g1", name: "Events" }]);
                const res = mockRes();
                expect(await handle("/api/settings/discord-servers", { method: "GET" }, res)).toBe(true);
                expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                const data = json(res).data;
                expect(data.guilds.map((g) => g.role)).toEqual(["event"]);
                expect(data.overlap).toBeNull();
                settingsStore.getConfig.mockReturnValue({});
            });

            it("refuses a limited settings user", async () => {
                auth.getUser.mockReturnValue({
                    id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), settings: { read: true, write: true } },
                });
                const res = mockRes();
                await handle("/api/settings/discord-servers", { method: "GET" }, res);
                expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            });
        });

        describe("GET /api/settings", () => {
            it("returns 401 for an anonymous caller", async () => {
                auth.getUser.mockReturnValue(null);
                const res = mockRes();
                await handle("/api/settings", { method: "GET" }, res);
                expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            });

            it("returns config, raidsheets, roles, categories and the active guild for an admin", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                activeGuildFor.mockReturnValue("guild-1");
                settingsStore.getConfig.mockReturnValue({ adminRoleIds: ["r1"] });
                settingsStore.listRaidsheets.mockReturnValue([{ id: "s1", name: "Tier 4/5" }]);
                discord.listRoles.mockReturnValue([{ id: "role1", name: "Raider" }]);
                discord.listCategories.mockReturnValue([{ id: "cat1", name: "Raids" }]);

                const res = mockRes();
                await handle("/api/settings", { method: "GET" }, res);

                const data = json(res).data;
                expect(data).toMatchObject({
                    config: { adminRoleIds: ["r1"] },
                    canManageAccess: true,
                    raidsheets: [{ id: "s1", name: "Tier 4/5" }],
                    roles: [{ id: "role1", name: "Raider" }],
                    categories: [{ id: "cat1", name: "Raids" }],
                    activeGuildId: "guild-1",
                });
                expect(data.areas.map((a) => a.id)).toEqual(AREA_IDS);
            });

            // A role with write on "Einstellungen" may edit the bot config, but must
            // not see (nor save) who has access — that would let it escalate itself.
            it("hides the access config from a non-admin settings user", async () => {
                auth.getUser.mockReturnValue({
                    id: "7", name: "Bob", isAdmin: false,
                    access: { ...emptyAccess(), settings: { read: true, write: true } },
                });
                settingsStore.getConfig.mockReturnValue({
                    adminRoleIds: ["r1"], rolePermissions: { role1: { raids: { read: true, write: false } } },
                    baseAccess: { loot: { read: true, write: false } }, guildId: "g1",
                });

                const res = mockRes();
                await handle("/api/settings", { method: "GET" }, res);

                const data = json(res).data;
                expect(data.config).toEqual({ guildId: "g1" });
                expect(data.canManageAccess).toBe(false);
            });

            // The credentials to foreign systems are full-admin-only like the access
            // config: a limited settings user does not even learn whether one is set.
            it("hides the Anthropic and Warcraft Logs credentials from a non-admin settings user", async () => {
                auth.getUser.mockReturnValue({
                    id: "7", name: "Bob", isAdmin: false,
                    access: { ...emptyAccess(), settings: { read: true, write: true } },
                });
                settingsStore.getConfig.mockReturnValue({
                    guildId: "g1",
                    anthropic: { apiKey: "sk-secret", model: "claude-opus-5" },
                    warcraftlogsV2: { clientId: "wcl-id", clientSecret: "wcl-secret" },
                    blizzard: { clientId: "bz-id", clientSecret: "bz-secret", region: "eu" },
                });

                const res = mockRes();
                await handle("/api/settings", { method: "GET" }, res);

                const data = json(res).data;
                expect(data.config).toEqual({ guildId: "g1", blizzard: { clientId: "bz-id", region: "eu", hasClientSecret: true } });
                expect(JSON.stringify(json(res))).not.toContain("secret");
            });

            // The Battle.net secret follows the same contract as the other two: the
            // browser only learns that one is stored, never the value.
            it("masks the Battle.net client secret, reporting only whether one is set", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                settingsStore.getConfig.mockReturnValue({ guildId: "g1", blizzard: { clientId: "bz-id", clientSecret: "bz-secret", region: "eu", realmSlug: "thunderstrike", namespace: "" } });

                const res = mockRes();
                await handle("/api/settings", { method: "GET" }, res);

                expect(json(res).data.config.blizzard).toEqual({ clientId: "bz-id", region: "eu", realmSlug: "thunderstrike", namespace: "", hasClientSecret: true });
                expect(JSON.stringify(json(res))).not.toContain("bz-secret");

                settingsStore.getConfig.mockReturnValue({ guildId: "g1", blizzard: { clientId: "bz-id", clientSecret: "", region: "eu" } });
                const res2 = mockRes();
                await handle("/api/settings", { method: "GET" }, res2);
                expect(json(res2).data.config.blizzard).toEqual({ clientId: "bz-id", region: "eu", hasClientSecret: false });
            });

            // Same for the WCL v2 client secret: the id is shown, the secret is only "set".
            it("masks the Warcraft Logs v2 client secret, reporting only whether one is set", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                settingsStore.getConfig.mockReturnValue({ guildId: "g1", warcraftlogsV2: { clientId: "wcl-id", clientSecret: "wcl-secret" } });

                const res = mockRes();
                await handle("/api/settings", { method: "GET" }, res);

                expect(json(res).data.config.warcraftlogsV2).toEqual({ clientId: "wcl-id", hasClientSecret: true });
                expect(JSON.stringify(json(res))).not.toContain("wcl-secret");
            });

            // The Anthropic key never leaves the server — the page only learns that one is stored.
            it("masks the Anthropic key, reporting only whether one is set", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                settingsStore.getConfig.mockReturnValue({ guildId: "g1", anthropic: { apiKey: "sk-secret", model: "claude-opus-5" } });

                const res = mockRes();
                await handle("/api/settings", { method: "GET" }, res);

                expect(json(res).data.config.anthropic).toEqual({ model: "claude-opus-5", hasApiKey: true });
                expect(JSON.stringify(json(res))).not.toContain("sk-secret");
            });
        });

        describe("PATCH /api/settings", () => {
            it("returns 403 when the CSRF token is invalid", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(false);
                const res = await patch("/api/settings", { officerRoleId: "r1" });
                expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
                expect(settingsStore.saveConfig).not.toHaveBeenCalled();
            });

            it("only forwards fields present in the body, trimmed/split as needed", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);

                await patch("/api/settings", {
                    adminRoleIds: [" r1 ", "r2", ""],
                    officerRoleId: " off1 ",
                    categoryRoles: { cat1: ["role1"] },
                    blizzard: { clientSecret: "" },
                });

                expect(settingsStore.saveConfig).toHaveBeenCalledWith({
                    adminRoleIds: ["r1", "r2"],
                    officerRoleId: "off1",
                    categoryRoles: { cat1: ["role1"] },
                    blizzard: { clientSecret: "" },
                });
            });

            it("forwards the Anthropic key only when sent, and never echoes it back", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                settingsStore.saveConfig.mockReturnValue({ guildId: "g1", anthropic: { apiKey: "sk-new", model: "claude-opus-5" } });

                const res = await patch("/api/settings", { anthropic: { model: " claude-opus-5 " } });
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ anthropic: { model: "claude-opus-5" } });
                expect(json(res).data.config.anthropic).toEqual({ model: "claude-opus-5", hasApiKey: true });
                expect(JSON.stringify(json(res))).not.toContain("sk-new");

                await patch("/api/settings", { anthropic: { apiKey: " sk-new ", model: "" } });
                expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ anthropic: { apiKey: "sk-new", model: "" } });
            });

            it("forwards the WCL v2 client secret only when sent (omit = keep, \"\" = clear), never echoing it", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                settingsStore.saveConfig.mockReturnValue({ guildId: "g1", warcraftlogsV2: { clientId: "wcl-id", clientSecret: "wcl-new" } });

                const res = await patch("/api/settings", { warcraftlogsV2: { clientId: " wcl-id " } });
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ warcraftlogsV2: { clientId: "wcl-id" } });
                expect(json(res).data.config.warcraftlogsV2).toEqual({ clientId: "wcl-id", hasClientSecret: true });
                expect(JSON.stringify(json(res))).not.toContain("wcl-new");

                await patch("/api/settings", { warcraftlogsV2: { clientId: "wcl-id", clientSecret: " wcl-new " } });
                expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ warcraftlogsV2: { clientId: "wcl-id", clientSecret: "wcl-new" } });

                await patch("/api/settings", { warcraftlogsV2: { clientSecret: "" } });
                expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ warcraftlogsV2: { clientSecret: "" } });
            });

            it("stores the loot tool per category, dropping anything but the two known tools", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);

                await patch("/api/settings", {
                    categoryLootTool: { cat1: "gargul", cat2: "rclc", cat3: "", cat4: "nonsense", "  ": "gargul" },
                });

                expect(settingsStore.saveConfig).toHaveBeenCalledWith({
                    categoryLootTool: { cat1: "gargul", cat2: "rclc", cat3: "", cat4: "" },
                });
            });

            // The top-item list is sent whole (that is how an item is removed); the
            // router only guards the type, settingsStore does the cleaning.
            it("forwards the top-item list as sent", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);

                await patch("/api/settings", {
                    topItems: [{ id: 30883, name: "Kalter Fels", iconUrl: "https://x/i.jpg", quality: 4 }],
                });

                expect(settingsStore.saveConfig).toHaveBeenCalledWith({
                    topItems: [{ id: 30883, name: "Kalter Fels", iconUrl: "https://x/i.jpg", quality: 4 }],
                });
            });

            it("turns a malformed topItems value into an empty list", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                await patch("/api/settings", { topItems: "nope" });
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ topItems: [] });
            });

            it("ignores a malformed categoryLootTool instead of storing it", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                await patch("/api/settings", { categoryLootTool: "nope" });
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categoryLootTool: {} });
            });

            // A category sheet is rendered as an <a href> and posted to Discord, so
            // only a real http(s) link survives; everything else is stored as "",
            // which the settings store then drops (= no sheet assigned).
            it("stores a category sheet only when its url is an http(s) link", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);

                await patch("/api/settings", {
                    categorySheets: {
                        cat1: { url: " https://docs.google.com/spreadsheets/d/x ", name: " SSC/TK " },
                        cat2: { url: "javascript:alert(1)", name: "böse" },
                        cat3: { url: "", name: "" },
                        "  ": { url: "https://x", name: "" },
                    },
                });

                expect(settingsStore.saveConfig).toHaveBeenCalledWith({
                    categorySheets: {
                        cat1: { url: "https://docs.google.com/spreadsheets/d/x", name: "SSC/TK" },
                        cat2: { url: "", name: "böse" },
                        cat3: { url: "", name: "" },
                    },
                });
            });

            it("ignores a malformed categorySheets instead of storing it", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                await patch("/api/settings", { categorySheets: "nope" });
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categorySheets: {} });
            });

            it("omits blizzard entirely when not present in the body, keeping the stored secret", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);

                await patch("/api/settings", { officerRoleId: "off1" });

                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ officerRoleId: "off1" });
            });

            it("forwards the Battle.net client secret only when sent (omit = keep, \"\" = clear), never echoing it", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                settingsStore.saveConfig.mockReturnValue({ guildId: "g1", blizzard: { clientId: "bz-id", clientSecret: "bz-new", region: "eu" } });

                // the secret left out: the stored one stays; unknown fields are dropped
                const res = await patch("/api/settings", { blizzard: { clientId: " bz-id ", region: "EU ", realmSlug: "thunderstrike", namespace: "", hasClientSecret: true, bogus: 1 } });
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ blizzard: { clientId: "bz-id", region: "EU", realmSlug: "thunderstrike", namespace: "" } });
                expect(json(res).data.config.blizzard).toEqual({ clientId: "bz-id", region: "eu", hasClientSecret: true });
                expect(JSON.stringify(json(res))).not.toContain("bz-new");

                await patch("/api/settings", { blizzard: { clientId: "bz-id", clientSecret: " bz-new " } });
                expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ blizzard: { clientId: "bz-id", clientSecret: "bz-new" } });

                await patch("/api/settings", { blizzard: { clientSecret: "" } });
                expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ blizzard: { clientSecret: "" } });
            });

            it("normalises rolePermissions before saving them", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);

                await patch("/api/settings", {
                    rolePermissions: {
                        role1: { raids: { write: true }, unknownArea: { read: true } },
                        role2: { cla: { read: false, write: false } },
                    },
                });

                expect(settingsStore.saveConfig).toHaveBeenCalledWith({
                    // write implied read, the unknown area and the empty role dropped
                    rolePermissions: { role1: { raids: { read: true, write: true } } },
                });
            });

            it("normalises the base access before saving it", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);

                await patch("/api/settings", {
                    baseAccess: { loot: { read: true }, history: { write: true }, nonsense: { read: true }, cla: { read: false } },
                });

                expect(settingsStore.saveConfig).toHaveBeenCalledWith({
                    // write implied read; the unknown area and the empty grant dropped
                    baseAccess: { loot: { read: true, write: false }, history: { read: true, write: true } },
                });
            });

            // Otherwise a role with write access to "Einstellungen" could grant
            // itself (or anyone) full admin.
            it("refuses adminRoleIds/rolePermissions from a non-admin settings user", async () => {
                auth.getUser.mockReturnValue({
                    id: "7", name: "Bob", isAdmin: false,
                    access: { ...emptyAccess(), settings: { read: true, write: true } },
                });
                auth.checkCsrf.mockReturnValue(true);

                const res = await patch("/api/settings", { rolePermissions: { role1: { raids: { write: true } } } });

                expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
                expect(settingsStore.saveConfig).not.toHaveBeenCalled();
            });

            // The base access applies to everyone at once, so it is guarded like the
            // rest of the access config.
            it("refuses a baseAccess change from a non-admin settings user", async () => {
                auth.getUser.mockReturnValue({
                    id: "7", name: "Bob", isAdmin: false,
                    access: { ...emptyAccess(), settings: { read: true, write: true } },
                });
                auth.checkCsrf.mockReturnValue(true);

                const res = await patch("/api/settings", { baseAccess: { settings: { write: true } } });

                expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
                expect(settingsStore.saveConfig).not.toHaveBeenCalled();
            });

            // The client hides the Anthropic and Warcraft Logs sections from that
            // user (adminOnly); the server has to refuse them just the same.
            it("refuses the Anthropic and Warcraft Logs credentials from a non-admin settings user", async () => {
                auth.getUser.mockReturnValue({
                    id: "7", name: "Bob", isAdmin: false,
                    access: { ...emptyAccess(), settings: { read: true, write: true } },
                });
                auth.checkCsrf.mockReturnValue(true);

                let res = await patch("/api/settings", { officerRoleId: "off1", anthropic: { apiKey: "sk-mine" } });
                expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
                res = await patch("/api/settings", { warcraftlogsV2: { clientId: "x", clientSecret: "y" } });
                expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
                // even an empty block is a touch — it would clear the model / client id
                res = await patch("/api/settings", { anthropic: {} });
                expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
                expect(settingsStore.saveConfig).not.toHaveBeenCalled();
            });

            it("still lets that user save ordinary settings", async () => {
                auth.getUser.mockReturnValue({
                    id: "7", name: "Bob", isAdmin: false,
                    access: { ...emptyAccess(), settings: { read: true, write: true } },
                });
                auth.checkCsrf.mockReturnValue(true);

                await patch("/api/settings", { officerRoleId: "off1", blizzard: { clientId: "bz", clientSecret: "s" } });

                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ officerRoleId: "off1", blizzard: { clientId: "bz", clientSecret: "s" } });
            });
        });

        describe("POST /api/settings/raidsheets", () => {
            it("returns 400 when the name is missing", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                const res = await post("/api/settings/raidsheets", { spreadsheetId: "abc" });
                expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                expect(settingsStore.saveRaidsheet).not.toHaveBeenCalled();
            });

            it("saves the raidsheet and returns it", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                settingsStore.saveRaidsheet.mockReturnValue({ id: "s1", name: "Tier 4/5" });

                const res = await post("/api/settings/raidsheets", { name: "Tier 4/5" });

                expect(settingsStore.saveRaidsheet).toHaveBeenCalledWith({ name: "Tier 4/5" });
                expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
                expect(json(res)).toEqual({ data: { id: "s1", name: "Tier 4/5" } });
            });
        });

        describe("POST /api/settings/raidsheets/delete", () => {
            it("returns 404 when nothing was removed", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                settingsStore.deleteRaidsheet.mockReturnValue(false);
                const res = await post("/api/settings/raidsheets/delete", { id: "s1" });
                expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            });

            it("deletes and returns the id on success", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                settingsStore.deleteRaidsheet.mockReturnValue(true);
                const res = await post("/api/settings/raidsheets/delete", { id: "s1" });
                expect(settingsStore.deleteRaidsheet).toHaveBeenCalledWith("s1");
                expect(json(res)).toEqual({ data: { id: "s1" } });
            });
        });

        describe("GET /api/settings/item-search", () => {
            it("returns 401 for an anonymous caller", async () => {
                auth.getUser.mockReturnValue(null);
                const res = await get("/api/settings/item-search", { q: "krone" });
                expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
                expect(wowhead.searchItems).not.toHaveBeenCalled();
            });

            it("proxies the top-item search to wowhead.searchItems, defaulting to tbc", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                wowhead.searchItems.mockResolvedValue([{ id: 30883, name: "Kalter Fels" }]);
                const res = await get("/api/settings/item-search", { q: "kalter" });
                expect(wowhead.searchItems).toHaveBeenCalledWith("kalter", { edition: "tbc" });
                expect(json(res)).toEqual({ data: { items: [{ id: 30883, name: "Kalter Fels" }] } });
            });
        });
    });

    describe("handlers called directly", () => {
        const ADMIN = { id: "1", name: "Admin", isAdmin: true };

        beforeEach(() => {
            jest.clearAllMocks();
            requireAdmin.mockReturnValue(ADMIN);
            requireFullAdmin.mockReturnValue(ADMIN);
            activeGuildFor.mockReturnValue("g1");
            settingsStore.listRaidTemplates.mockReturnValue([{ id: "k1", name: "Kara", versionId: "tbc", size: 10, composition: { tank: 2, healer: 3 } }]);
            discord.getClient.mockReset().mockReturnValue(null);
            discord.getGuild.mockReset().mockReturnValue(null);
        });

        describe("GET /api/settings for the redesigned page", () => {
            it("lists the text channels so the module fields can pick one by name", async () => {
                discord.listTextChannels.mockReturnValue([{ id: "c1", name: "log-uploads", category: "Raids" }]);
                const res = mockRes();
                await getSettings({}, res);
                expect(discord.listTextChannels).toHaveBeenCalledWith("g1");
                expect(body(res).channels).toEqual([{ id: "c1", name: "log-uploads", category: "Raids" }]);
            });

            it("reports the bot as online with the guild name when the client is ready", async () => {
                discord.getClient.mockReturnValue({ isReady: () => true, readyTimestamp: 1700000000000 });
                discord.getGuild.mockReturnValue({ name: "Pulse" });
                const res = mockRes();
                await getSettings({}, res);
                expect(body(res).bot).toEqual({ online: true, readySince: 1700000000000, guildName: "Pulse" });
            });

            it("reads a missing or broken client as offline instead of failing the page", async () => {
                const res = mockRes();
                await getSettings({}, res);
                expect(body(res).bot).toEqual({ online: false, readySince: 0, guildName: "" });

                discord.getClient.mockImplementation(() => { throw new Error("boom"); });
                const res2 = mockRes();
                await getSettings({}, res2);
                expect(body(res2).bot.online).toBe(false);
            });
        });

        describe("default raid template per category (#266)", () => {
            it("lists the raid templates for the select, names only", async () => {
                const res = mockRes();
                await getSettings({}, res);
                expect(body(res).raidTemplates).toEqual([{ id: "k1", name: "Kara", versionId: "tbc", size: 10 }]);
            });

            it("stores the map, dropping an id no template has", async () => {
                readJsonBody.mockResolvedValue({ categoryRaidTemplate: { c1: "k1", c2: "gone" } });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categoryRaidTemplate: { c1: "k1" } });
            });
        });

        describe("setup DMs per category (#290)", () => {
            it("stores the switch as booleans, so switching off reaches the store", async () => {
                readJsonBody.mockResolvedValue({ categorySetupDms: { c1: true, c2: false, c3: "yes" } });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categorySetupDms: { c1: true, c2: false, c3: false } });
            });

            it("is a setting a limited settings user may change (not full-admin-only)", async () => {
                requireAdmin.mockReturnValue({ id: "7", isAdmin: false, access: { settings: { read: true, write: true } } });
                requireFullAdmin.mockReturnValue(null);
                readJsonBody.mockResolvedValue({ categorySetupDms: { c1: true } });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categorySetupDms: { c1: true } });
            });
        });

        describe("Discord-Event und Sprachkanal je Kategorie (#305)", () => {
            it("stores the switch as booleans and the voice channel as a string, so both can be cleared", async () => {
                readJsonBody.mockResolvedValue({
                    categoryDiscordEvent: { c1: true, c2: false, c3: "yes" },
                    categoryVoiceChannel: { c1: " 123456789012345678 ", c2: "" },
                });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({
                    categoryDiscordEvent: { c1: true, c2: false, c3: false },
                    categoryVoiceChannel: { c1: "123456789012345678", c2: "" },
                });
            });

            it("is a setting a limited settings user may change (not full-admin-only)", async () => {
                requireAdmin.mockReturnValue({ id: "7", isAdmin: false, access: { settings: { read: true, write: true } } });
                requireFullAdmin.mockReturnValue(null);
                readJsonBody.mockResolvedValue({ categoryDiscordEvent: { c1: true } });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categoryDiscordEvent: { c1: true } });
            });
        });

        describe("Kanal für Vielleicht/Absage je Kategorie (#335)", () => {
            it("stores the channel as a string, so a category can go back to the default", async () => {
                readJsonBody.mockResolvedValue({ categorySignupNoteChannel: { c1: " 123456789012345678 ", c2: "" } });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categorySignupNoteChannel: { c1: "123456789012345678", c2: "" } });
            });

            it("is a setting a limited settings user may change (not full-admin-only)", async () => {
                requireAdmin.mockReturnValue({ id: "7", isAdmin: false, access: { settings: { read: true, write: true } } });
                requireFullAdmin.mockReturnValue(null);
                readJsonBody.mockResolvedValue({ categorySignupNoteChannel: { c1: "123456789012345678" } });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categorySignupNoteChannel: { c1: "123456789012345678" } });
            });

            it("lists the text channels of both servers, named with their server, and the default channel", async () => {
                settingsStore.getConfig.mockReturnValue({ discordServers: { eventGuilds: [{ guildId: "200" }], talkGuildId: "300", signupNoteChannelId: "2001" } });
                discord.listGuilds.mockReturnValue([{ id: "200", name: "Pulse Events" }, { id: "300", name: "Pulse Talk" }, { id: "400", name: "Andere" }]);
                discord.listTextChannels.mockImplementation((id) => [{ id: `${id}1`, name: "abmeldungen", category: id === "200" ? "Raids" : "" }]);
                requireAdmin.mockReturnValue({ id: "7", isAdmin: false });
                const res = mockRes();
                await getSettings({}, res);
                expect(body(res).noteChannels).toEqual({
                    defaultId: "2001",
                    channels: [
                        { id: "2001", name: "abmeldungen", category: "Pulse Events · Raids" },
                        { id: "3001", name: "abmeldungen", category: "Pulse Talk" },
                    ],
                });
                settingsStore.getConfig.mockReturnValue({});
                discord.listTextChannels.mockReset().mockReturnValue([]);
                discord.listGuilds.mockReset().mockReturnValue([]);
            });

            it("keeps the server name out with a single server and reads an offline bot as no channels", async () => {
                settingsStore.getConfig.mockReturnValue({ guildId: "200" });
                discord.listTextChannels.mockImplementation((id) => [{ id: `${id}1`, name: "abmeldungen", category: "Raids" }]);
                const res = mockRes();
                await getSettings({}, res);
                expect(body(res).noteChannels).toEqual({ defaultId: "", channels: [{ id: "2001", name: "abmeldungen", category: "Raids" }] });

                discord.listTextChannels.mockReset().mockReturnValue([]);
                const res2 = mockRes();
                await getSettings({}, res2);
                expect(body(res2).noteChannels).toEqual({ defaultId: "", channels: [] });
                settingsStore.getConfig.mockReturnValue({});
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
                discordServers: { eventGuilds: [{ guildId: "200", label: "", overviewGuildId: "300", overviewChannelId: "301" }], talkGuildId: "300", talkPingChannelId: "" },
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
                readJsonBody.mockResolvedValue({ discordServers: { eventGuilds: [{ guildId: "999999" }] } });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig).not.toHaveBeenCalled();
            });

            it("puts both server cards into GET /api/settings for a full admin only", async () => {
                settingsStore.getConfig.mockReturnValue(stored);
                discord.getGuild.mockImplementation((id) => (id === "200" ? guild("200", "Pulse Events", 212) : null));
                discord.botPermissionsIn.mockReturnValue([{ key: "ManageRoles", label: "Rollen verwalten", ok: false }]);
                const res = mockRes();
                await getSettings({}, res);
                const { servers, config } = body(res);
                expect(servers.events[0]).toMatchObject({ role: "event", name: "Pulse Events", connected: true, missing: ["Rollen verwalten"] });
                expect(servers.talk).toMatchObject({ role: "talk", id: "300", connected: false });
                expect(config.discordServers).toEqual(stored.discordServers);

                requireAdmin.mockReturnValue({ id: "7", isAdmin: false });
                const res2 = mockRes();
                await getSettings({}, res2);
                expect(body(res2).servers).toBeNull();
                expect(body(res2).config.discordServers).toBeUndefined();
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
                const data = body(res);
                expect(data.discordServers).toEqual(stored.discordServers);
                expect(data.events[0].name).toBe("Pulse Events");
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
                expect(body(res)).toMatchObject({ roleSync: [], drift: [], driftTotal: 0, driftError: null });

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
                const data = body(res);
                expect(discord.listCategories).toHaveBeenCalledWith("200000");
                expect(data.categories).toEqual([
                    { id: "900000", name: "Raids Mittwoch", roleCount: 2 },
                    { id: "910000", name: "", roleCount: 0 },
                ]);
                expect(data.pingTargets.talk).toBe(false);
                expect(data.categoryReminders["910000"].missingHours).toBe(24);
                settingsStore.getConfig.mockReturnValue({});
            });

            it("names a category that only exists on a secondary event server (#361)", async () => {
                settingsStore.getConfig.mockReturnValue({
                    discordServers: { eventGuilds: [{ guildId: "200000" }, { guildId: "300000" }] },
                    categoryReminders: { 920000: { missingHours: 0, signedHours: 2, target: "event" } },
                });
                discord.listCategories.mockImplementation((id) => (id === "300000" ? [{ id: "920000", name: "PvP-Raids" }] : []));
                const res = mockRes();
                getReminders({}, res);
                expect(discord.listCategories).toHaveBeenCalledWith("200000");
                expect(discord.listCategories).toHaveBeenCalledWith("300000");
                expect(body(res).categories).toEqual([{ id: "920000", name: "PvP-Raids", roleCount: 0 }]);
                settingsStore.getConfig.mockReturnValue({});
            });
        });
    });
});
