// The settings API: routed end to end (area gate, CSRF, 401/403) and the
// handlers called directly - what the redesigned Einstellungen page needs beyond
// the config (channel list and bot status for the connection card) and that a
// per-account grant actually reaches the store.

const { mockRes, json, body, routerClient } = require("../../helpers/http");
const { tempStoreFile } = require("../../helpers/tempStore");

jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(),
    // "Ansicht als Rolle": the caller's own rights, and starting/stopping the view
    getRealUser: jest.fn(),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(),
    setActiveGuild: jest.fn(),
}));
// A new language (the server's or a category's) redraws the public messages; never for real here.
jest.mock("../../../src/services/discord/languageChange", () => ({ afterServerLangChange: jest.fn(async () => ({})) }));
// The raider organizers redraw when the guild bank channel changes; never for real here.
jest.mock("../../../src/services/signups/availabilityPanel", () => ({
    refreshPanels: jest.fn(() => Promise.resolve({ edited: 0, failed: 0, unchanged: 0 })),
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
jest.mock("../../../src/services/events/raidEventGroups", () => ({
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
// The content switch (#563): the warning list and the archive export, steered per test.
jest.mock("../../../src/services/events/contentVersions", () => ({
    upcomingByVersion: jest.fn(() => ({})),
    versionsWithData: jest.fn(() => new Set(["tbc"])),
    archiveExport: jest.fn(() => ({ exportedAt: "2026-10-01T12:00:00.000Z", mainVersion: "forever", versions: ["tbc", "classic"], loot: [], attendance: [] })),
    archiveCsv: jest.fn(() => "type,versionId\r\nloot,tbc\r\n"),
    contentVersions: jest.fn(() => ({ mainVersion: "tbc", hideOtherVersions: false, versions: [] })),
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
    getSettings, updateSettings, getDiscordServers, getRoleSync, getReminders, FULL_ADMIN_KEYS, publicConfig,
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
            it("serves the server rows to a full admin", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                settingsStore.getConfig.mockReturnValue({ guildId: "100000", discordServers: { servers: [{ guildId: "100000", label: "" }], links: [] } });
                discord.listGuilds.mockReturnValue([{ id: "100000", name: "Events" }]);
                const res = mockRes();
                expect(await handle("/api/settings/discord-servers", { method: "GET" }, res)).toBe(true);
                expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                const data = json(res).data;
                expect(data.guilds.map((g) => g.id)).toEqual(["100000"]);
                expect(data.servers.map((g) => g.id)).toEqual(["100000"]);
                expect(data.overlap).toBeUndefined();
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
                // Einstellungen → Spielversion (#541) picks from these
                expect(data.gameVersions.map((v) => v.id)).toEqual(["tbc", "classic", "forever"]);
                expect(data.gameVersions[2]).toEqual({ id: "forever", label: expect.any(String), short: expect.any(String), color: "#4da3ff" });
                // "Standardwerte übernehmen" (#553): Classic has checked values, Forever none yet
                expect(data.versionDefaults.classic).toMatchObject({ wowheadPath: "classic", softresEdition: "classic", blizzardRealmSlug: "" });
                // Forever: only its Wowhead section (#750), no realm, armory or log site
                expect(data.versionDefaults.forever).toMatchObject({ wowheadPath: "forever", blizzardRealmSlug: "", blizzardNamespace: "", armoryUrlTemplate: "", wclUrlTemplate: "" });
                // "Funktionen je Version" (#761): every version with every feature, from the one source
                expect(data.versionCapabilities.features).toEqual(["logcheck", "lootCouncilBis", "simulation", "raidSheet", "softres", "armory", "wowheadLinks", "raidplanCatalog", "dungeonTimes"]);
                expect(Object.keys(data.versionCapabilities.versions)).toEqual(["tbc", "classic", "forever"]);
                expect(data.versionCapabilities.versions.tbc.raidSheet).toMatchObject({ possible: true, enabled: true, on: true, reason: "" });
                expect(data.versionCapabilities.versions.forever.wowheadLinks).toMatchObject({ on: true });
                expect(data.versionCapabilities.versions.forever.logcheck).toMatchObject({ possible: false, reason: "rules_not_ready" });
                expect(data.versionCapabilities.versions.forever.raidSheet).toMatchObject({ possible: false, reason: "no_sheet_layout" });
            });

            it("sends the Discord pictures of the accounts with a per-user grant, only those the bot knows", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                activeGuildFor.mockReturnValue("guild-1");
                settingsStore.getConfig.mockReturnValue({ userPermissions: { u1: { loot: { read: true } }, u2: { loot: { read: true } } } });
                discord.avatarUrlFor.mockImplementation((guildId, id) => (id === "u1" ? "https://cdn/u1.png" : ""));
                const res = mockRes();
                await handle("/api/settings", { method: "GET" }, res);
                expect(json(res).data.userAvatars).toEqual({ u1: "https://cdn/u1.png" });
                expect(discord.avatarUrlFor).toHaveBeenCalledWith("guild-1", "u2");
                discord.avatarUrlFor.mockImplementation(() => "");
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

            it("carries saved category roles over to the category's roster (#653)", async () => {
                const rosterStore = require("../../../src/stores/rosterStore");
                const roster = rosterStore.createRoster({ name: "R", categoryId: "catRoster", roleIds: ["old"] });
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                settingsStore.saveConfig.mockReturnValueOnce({ categoryRoles: { catRoster: ["new1", "new2"] } });
                await patch("/api/settings", { categoryRoles: { catRoster: ["new1", "new2"] } });
                expect(rosterStore.getRoster(roster.id).roleIds).toEqual(["new1", "new2"]);
                // a save without roles leaves the roster alone
                settingsStore.saveConfig.mockReturnValueOnce({});
                await patch("/api/settings", { officerRoleId: "x" });
                expect(rosterStore.getRoster(roster.id).roleIds).toEqual(["new1", "new2"]);
                rosterStore.deleteRoster(roster.id);
            });

            it("forwards the picture switches as booleans, known keys only", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                await patch("/api/settings", { discordVisuals: { overviewWeekStrip: false, setupImage: "yes", eventCover: true, other: false } });
                expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ discordVisuals: { overviewWeekStrip: false, eventCover: true } });
                await patch("/api/settings", { discordVisuals: null, officerRoleId: "x" });
                expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ officerRoleId: "x" });
            });

            it("forwards the dungeon record setting, its two fields only", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                await patch("/api/settings", { dungeonRecords: { post: true, channelId: " 123456789012345678 ", other: 1 } });
                expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ dungeonRecords: { post: true, channelId: "123456789012345678" } });
                await patch("/api/settings", { dungeonRecords: { post: "yes" } });
                expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ dungeonRecords: {} });
            });

            it("forwards the main version and the category map (#541)", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                await patch("/api/settings", { mainVersion: " forever ", categoryVersion: { cat1: "tbc" } });
                expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ mainVersion: "forever", categoryVersion: { cat1: "tbc" } });
                await patch("/api/settings", { categoryVersion: null });
                expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ categoryVersion: {} });
            });

            describe("the log channels of the active server (#921)", () => {
                const discord = require("../../../src/services/discord/discord");
                beforeEach(() => {
                    auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                    auth.checkCsrf.mockReturnValue(true);
                    settingsStore.getConfig.mockReturnValue({
                        mainVersion: "tbc",
                        categoryVersion: { catF: "forever" },
                        serverSettings: { "guild-1": { logChannels: [{ channelId: "old", versionId: "classic" }] } },
                    });
                    discord.listAllChannels.mockReturnValue([{ id: "inF", parentId: "catF" }, { id: "loose", parentId: null }]);
                });
                afterEach(() => {
                    activeGuildFor.mockReturnValue("");
                    settingsStore.getConfig.mockReturnValue({});
                    discord.listAllChannels.mockReturnValue([]);
                });

                it("saves the list under the active server: bare ids keep or derive their version, objects set it", async () => {
                    activeGuildFor.mockReturnValue("guild-1");
                    await patch("/api/settings", { serverSettingsGuildId: "guild-1", logChannels: ["old", "inF", "loose", { channelId: "set", versionId: "forever" }] });
                    expect(discord.listAllChannels).toHaveBeenCalledWith("guild-1");
                    expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({
                        serverSettings: { "guild-1": { logChannels: [
                            { channelId: "old", versionId: "classic" },
                            { channelId: "inF", versionId: "forever" },
                            { channelId: "loose", versionId: "tbc" },
                            { channelId: "set", versionId: "forever" },
                        ] } },
                    });
                });

                it("an empty list clears the server's channels", async () => {
                    activeGuildFor.mockReturnValue("guild-1");
                    await patch("/api/settings", { serverSettingsGuildId: "guild-1", logChannels: [] });
                    expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ serverSettings: { "guild-1": { logChannels: [] } } });
                });

                it("refuses the list without an active server", async () => {
                    const res = await patch("/api/settings", { logChannels: ["old"] });
                    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                    expect(json(res).error.code).toBe("no_active_server");
                    expect(settingsStore.saveConfig).not.toHaveBeenCalled();
                });

                // #921 review: the active server is per session; a tab loaded on another server must not write into this one
                it("refuses with 409 when the tab loaded another server, and changes nothing", async () => {
                    activeGuildFor.mockReturnValue("guild-B");
                    const res = await patch("/api/settings", { serverSettingsGuildId: "guild-1", logChannels: ["a1"], officerRoleId: "r1" });
                    expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
                    expect(json(res).error.code).toBe("server_switched");
                    expect(settingsStore.saveConfig).not.toHaveBeenCalled();
                });

                it("refuses with 409 when the tab sends no server", async () => {
                    activeGuildFor.mockReturnValue("guild-1");
                    const res = await patch("/api/settings", { logChannels: ["old"] });
                    expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
                    expect(json(res).error.code).toBe("server_switched");
                    expect(settingsStore.saveConfig).not.toHaveBeenCalled();
                });

                it("a save without server-bound keys needs no server", async () => {
                    activeGuildFor.mockReturnValue("guild-B");
                    const res = await patch("/api/settings", { officerRoleId: "r1" });
                    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                    expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ officerRoleId: "r1" });
                });
            });

            describe("a fixed version per category (#738)", () => {
                const seriesStore = require("../../../src/stores/eventSeriesStore");
                const { onCategoryVersionSwitch } = require("../../../src/services/events/categorySwitch");
                const BEFORE = { guildId: "g1", categoryIds: ["cat1"], mainVersion: "tbc", categoryVersion: { cat1: "tbc" } };
                beforeEach(() => {
                    auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                    auth.checkCsrf.mockReturnValue(true);
                    settingsStore.getConfig.mockReturnValue(BEFORE);
                    // #926: a save edits the active server's categories (g1, the only one here)
                    activeGuildFor.mockReturnValue("g1");
                    discord.listCategories.mockReturnValue([{ id: "cat1", name: "TBC Montag" }, { id: "cat2", name: "Freitag" }]);
                });
                afterEach(() => {
                    settingsStore.getConfig.mockReturnValue({});
                    seriesStore.deleteSeries("cat1");
                });

                it("refuses an active category without a version", async () => {
                    const res = await patch("/api/settings", { categoryIds: ["cat1", "cat2"], serverSettingsGuildId: "g1", categoryVersion: { cat1: "tbc" } });
                    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                    expect(json(res)).toMatchObject({ error: { code: "category_version_missing", message: expect.stringContaining("Freitag") } });
                    // an unknown version counts as none
                    const res2 = await patch("/api/settings", { categoryVersion: { cat1: "wotlk" } });
                    expect(res2.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                    // the active list alone is checked against the stored map too
                    const res3 = await patch("/api/settings", { categoryIds: ["cat1", "cat2"], serverSettingsGuildId: "g1" });
                    expect(res3.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                    expect(settingsStore.saveConfig).not.toHaveBeenCalled();
                });

                it("takes a new category with its version, without a new section", async () => {
                    const res = await patch("/api/settings", { categoryIds: ["cat1", "cat2"], serverSettingsGuildId: "g1", categoryVersion: { cat1: "tbc", cat2: "forever" } });
                    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                    expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ categoryIds: ["cat1", "cat2"], categoryVersion: { cat1: "tbc", cat2: "forever" } });
                    expect(json(res).data.switchedCategories).toEqual([]);
                });

                it("starts a new section on a switch, applies the series fix and tells the listeners", async () => {
                    seriesStore.saveSeries({ categoryId: "cat1", enabled: true, raidTemplateId: "t-tbc", weekdays: [1], time: "19:30" });
                    const seen = [];
                    const off = onCategoryVersionSwitch((sw, ctx) => { seen.push({ sw, user: ctx.user.id }); });
                    try {
                        const res = await patch("/api/settings", { categoryVersion: { cat1: "forever" }, categorySwitchFixes: { cat1: { series: "pause" } } });
                        expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                        const partial = settingsStore.saveConfig.mock.calls.at(-1)[0];
                        expect(partial.categoryVersion).toEqual({ cat1: "forever" });
                        expect(partial.categorySwitchFixes).toBeUndefined();
                        expect(partial.categoryEras.cat1).toEqual([
                            { versionId: "tbc", from: 0, name: "TBC Montag" },
                            { versionId: "forever", from: expect.any(Number), name: "TBC Montag" },
                        ]);
                        const [switched] = json(res).data.switchedCategories;
                        expect(switched).toMatchObject({ categoryId: "cat1", fromVersion: "tbc", toVersion: "forever", name: "TBC Montag", series: "paused" });
                        expect(seriesStore.getSeries("cat1")).toMatchObject({ enabled: false, updatedBy: "1" });
                        expect(seen).toEqual([{ sw: expect.objectContaining({ categoryId: "cat1", toVersion: "forever" }), user: "1" }]);
                    } finally {
                        off();
                    }
                });

                it("closes the category's roster and starts the new one with the dialog's choice (#739)", async () => {
                    const rosterStore = require("../../../src/stores/rosterStore");
                    const configStore = require("../../../src/stores/configStore");
                    const { registerRosterVersionSwitch } = require("../../../src/services/roster/rosterVersionSwitch");
                    rosterStore.useFile(tempStoreFile("switch-rosters.json"));
                    configStore.useFile(tempStoreFile("switch-config.json"));
                    const off = registerRosterVersionSwitch();
                    try {
                        const old = rosterStore.createRoster({ guildId: "g1", name: "Montag", categoryId: "cat1", versionId: "tbc", roleIds: ["500000000000000001"] });
                        rosterStore.upsertMember(old.id, "200000000000000001", { status: "core", chars: ["Kes"] });
                        // what the (mocked) settings store saves: the category plays Forever from now on
                        configStore.saveConfig({ categoryIds: ["cat1"], categoryVersion: { cat1: "forever" }, categoryRoles: { cat1: ["500000000000000001"] } });

                        const preview = json(await get("/api/settings/category-switch", { categoryId: "cat1", versionId: "forever" })).data;
                        expect(preview.roster).toEqual({ closing: { id: old.id, name: "Montag", members: 1 }, existing: null, canCreate: true });

                        const res = await patch("/api/settings", {
                            categoryVersion: { cat1: "forever" },
                            // the draft still holds the TBC roles: they never reach the new roster
                            categoryRoles: { cat1: ["500000000000000001"] },
                            categorySwitchFixes: { cat1: { series: "", roster: { create: true, copyMembers: true, roleIds: [] } } },
                        });
                        expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                        const [switched] = json(res).data.switchedCategories;
                        const next = rosterStore.rosterForCategory("cat1", "forever");
                        expect(switched.roster).toEqual({ closed: { id: old.id, name: "Montag" }, reopened: null, created: { id: next.id, name: "Montag", members: 1 }, mirrored: true });
                        expect(rosterStore.getRoster(old.id)).toMatchObject({ closedReason: "version_switch", roleIds: ["500000000000000001"] });
                        expect(next.roleIds).toEqual([]);
                        expect(next.members["200000000000000001"]).toMatchObject({ status: "trial", chars: [] });
                        expect(configStore.getConfig().categoryRoles.cat1 || []).toEqual([]);
                    } finally {
                        off();
                        rosterStore.useFile(null);
                        configStore.useFile(null);
                    }
                });

                it("refuses a PuG onboarding role as the new roster's role before anything is written (#930)", async () => {
                    const rosterStore = require("../../../src/stores/rosterStore");
                    const PUG = "500000000000000009";
                    rosterStore.useFile(tempStoreFile("switch-pug-rosters.json"));
                    settingsStore.getConfig.mockReturnValue({ ...BEFORE, pugRoles: { g1: { versions: { tbc: PUG }, classes: {} } } });
                    const seen = [];
                    const off = onCategoryVersionSwitch((sw) => { seen.push(sw.categoryId); });
                    try {
                        const old = rosterStore.createRoster({ guildId: "g1", name: "Montag", categoryId: "cat1", versionId: "tbc", roleIds: [] });
                        const body = (roleIds) => ({ categoryVersion: { cat1: "forever" }, categorySwitchFixes: { cat1: { roster: { create: true, roleIds } } } });
                        const res = await patch("/api/settings", body([PUG]));
                        expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
                        expect(json(res).error).toMatchObject({ code: "pug_onboarding_role", message: expect.stringContaining("Roster Montag (Mitglied)") });
                        // nothing written: no save, no switch, the old roster open, no new one
                        expect(settingsStore.saveConfig).not.toHaveBeenCalled();
                        expect(seen).toEqual([]);
                        expect(rosterStore.getRoster(old.id).closedAt).toBeFalsy();
                        expect(rosterStore.rosterForCategory("cat1", "forever")).toBeNull();
                        // a plain role passes
                        const ok = await patch("/api/settings", body(["500000000000000001"]));
                        expect(ok.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                        expect(seen).toEqual(["cat1"]);
                    } finally {
                        off();
                        rosterStore.useFile(null);
                    }
                });

                it("counts the managers the new roster takes over only from a closed old roster (#930)", async () => {
                    const rosterStore = require("../../../src/stores/rosterStore");
                    const PUG = "500000000000000009";
                    settingsStore.getConfig.mockReturnValue({ ...BEFORE, pugRoles: { g1: { versions: { tbc: PUG }, classes: {} } } });
                    const body = { categoryVersion: { cat1: "forever" }, categorySwitchFixes: { cat1: { roster: { create: true, roleIds: [] } } } };
                    const managed = () => rosterStore.createRoster({ guildId: "g1", name: "Montag", categoryId: "cat1", versionId: "tbc", managers: { userIds: [], roleIds: [PUG] } });
                    try {
                        // open old roster: the manager role is an old entry, the switch passes
                        rosterStore.useFile(tempStoreFile("switch-managers-open.json"));
                        managed();
                        expect((await patch("/api/settings", body)).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                        // closed old roster: the new one would bring the manager role back to life
                        rosterStore.useFile(tempStoreFile("switch-managers-closed.json"));
                        rosterStore.closeRoster(managed().id, { reason: "manual" });
                        settingsStore.saveConfig.mockClear();
                        const res = await patch("/api/settings", body);
                        expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
                        expect(json(res).error).toMatchObject({ code: "pug_onboarding_role", message: expect.stringContaining("Roster Montag (Manager)") });
                        expect(settingsStore.saveConfig).not.toHaveBeenCalled();
                    } finally {
                        rosterStore.useFile(null);
                    }
                });

                it("names the way out when switching back would reopen a roster with a PuG role (#930)", async () => {
                    const rosterStore = require("../../../src/stores/rosterStore");
                    const PUG = "500000000000000009";
                    rosterStore.useFile(tempStoreFile("switch-back-pug.json"));
                    settingsStore.getConfig.mockReturnValue({ ...BEFORE, pugRoles: { g1: { versions: { tbc: PUG }, classes: {} } } });
                    try {
                        // the Forever roster a former switch closed, its role became an onboarding role since
                        const back = rosterStore.createRoster({ guildId: "g1", name: "Forever Montag", categoryId: "cat1", versionId: "forever", roleIds: [PUG] });
                        rosterStore.closeRoster(back.id, { reason: "version_switch" });
                        const res = await patch("/api/settings", { categoryVersion: { cat1: "forever" } });
                        expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
                        const { message } = json(res).error;
                        expect(message).toContain("Roster Forever Montag (Mitglied)");
                        expect(message).toContain("abgeschlossenen Roster „Forever Montag“");
                        expect(message).toContain("das Roster löschen (Voll-Admin)");
                        expect(settingsStore.saveConfig).not.toHaveBeenCalled();
                    } finally {
                        rosterStore.useFile(null);
                    }
                });

                it("previews a switch for the dialog", async () => {
                    settingsStore.listRaidTemplates.mockReturnValue([{ id: "t-fe", name: "Onyxia", versionId: "forever" }, { id: "t-tbc", name: "Kara", versionId: "tbc" }]);
                    const res = await get("/api/settings/category-switch", { categoryId: "cat1", versionId: "forever" });
                    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                    expect(json(res).data).toMatchObject({
                        categoryId: "cat1", name: "TBC Montag", switching: true, from: { id: "tbc" }, to: { id: "forever" },
                        upcoming: [], series: null, defaultTemplate: null, templates: [{ id: "t-fe", name: "Onyxia" }],
                    });
                    settingsStore.listRaidTemplates.mockReturnValue([]);
                    const bad = await get("/api/settings/category-switch", { categoryId: "cat1", versionId: "wotlk" });
                    expect(bad.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                    const none = await get("/api/settings/category-switch", { versionId: "forever" });
                    expect(none.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
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

            // #818: the GitHub token of the addon downloads follows the same contract.
            it("masks the GitHub token and forwards it only when sent (omit = keep, \"\" = clear)", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                settingsStore.getConfig.mockReturnValue({ guildId: "g1", github: { token: "github_pat_SECRET" } });
                const read = mockRes();
                await handle("/api/settings", { method: "GET" }, read);
                expect(json(read).data.config.github).toEqual({ hasToken: true });
                expect(JSON.stringify(json(read))).not.toContain("github_pat_SECRET");

                settingsStore.saveConfig.mockReturnValue({ guildId: "g1", github: { token: "github_pat_NEW" } });
                const res = await patch("/api/settings", { github: { token: " github_pat_NEW " } });
                expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ github: { token: "github_pat_NEW" } });
                expect(json(res).data.config.github).toEqual({ hasToken: true });
                expect(JSON.stringify(json(res))).not.toContain("github_pat_NEW");

                await patch("/api/settings", { github: { token: "" } });
                expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ github: { token: "" } });
                settingsStore.saveConfig.mockClear();
                await patch("/api/settings", { github: {}, officerRoleId: "o" });
                expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ officerRoleId: "o" });
            });

            it("saves the addon list whole, normalised, and refuses anything but a list", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                await patch("/api/settings", { addonDownloads: [
                    { name: "LevelHelper", repo: "https://github.com/mst1987/levelhelper", versions: ["forever", "x"], assets: "LevelHelper-*.zip",
                        curseforge: "https://legacy.curseforge.com/wow/addons/levelhelper/files" },
                    { name: "", repo: "a/b" },
                ] });
                // an edit: the list and the edit mark, so an emptied list may stay empty
                expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ addonDownloads: [expect.objectContaining({
                    id: "levelhelper", repo: "mst1987/levelhelper", versions: ["forever"], assets: ["LevelHelper-*.zip"], enabled: true,
                    curseforge: "https://www.curseforge.com/wow/addons/levelhelper",
                })], addonDownloadsCustomized: true });
                expect(settingsStore.saveConfig.mock.calls.at(-1)[0].addonDownloads).toHaveLength(1);
                settingsStore.saveConfig.mockClear();
                const res = await patch("/api/settings", { addonDownloads: "nope" });
                expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                expect(settingsStore.saveConfig).not.toHaveBeenCalled();
            });

            it("lets an admin empty the addon list on purpose, the last addon removed", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                await patch("/api/settings", { addonDownloads: [] });
                expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ addonDownloads: [], addonDownloadsCustomized: true });
            });

            it("never wipes the addon list from a save that carries it along with other settings", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                let res = await patch("/api/settings", { github: { token: "github_pat_NEW" }, addonDownloads: [] });
                expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                expect(json(res).error.code).toBe("invalid_addons");
                res = await patch("/api/settings", { officerRoleId: "o", addonDownloads: [] });
                expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                expect(settingsStore.saveConfig).not.toHaveBeenCalled();
            });

            it("refuses a list of which no entry is an addon instead of storing it empty", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                const res = await patch("/api/settings", { addonDownloads: [{ name: "", repo: "" }, { id: "x" }] });
                expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                expect(settingsStore.saveConfig).not.toHaveBeenCalled();
            });

            it("saves the GitHub token without touching the addon list", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                await patch("/api/settings", { github: { token: "github_pat_NEW" } });
                const sent = settingsStore.saveConfig.mock.calls.at(-1)[0];
                expect(sent).toEqual({ github: { token: "github_pat_NEW" } });
                expect(sent).not.toHaveProperty("addonDownloads");
            });

            it("restores the default addons on \"Standard wiederherstellen\" and clears the edit mark", async () => {
                const { defaultAddons } = require("../../../src/services/addons/addonConfig");
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                await patch("/api/settings", { addonDownloadsReset: true });
                expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ addonDownloads: defaultAddons(), addonDownloadsCustomized: false });
                settingsStore.saveConfig.mockClear();
                // the edit mark cannot be set from outside
                await patch("/api/settings", { addonDownloadsCustomized: true });
                expect(settingsStore.saveConfig.mock.calls.at(-1)[0]).toEqual({});
            });

            it("keeps the GitHub token and the addon list from a non-admin settings user", async () => {
                auth.getUser.mockReturnValue({
                    id: "7", name: "Bob", isAdmin: false,
                    access: { ...emptyAccess(), settings: { read: true, write: true } },
                });
                auth.checkCsrf.mockReturnValue(true);
                settingsStore.getConfig.mockReturnValue({ guildId: "g1", github: { token: "github_pat_SECRET" }, addonDownloads: [{ id: "a" }] });
                const read = mockRes();
                await handle("/api/settings", { method: "GET" }, read);
                expect(json(read).data.config).not.toHaveProperty("github");
                expect(json(read).data.config).not.toHaveProperty("addonDownloads");
                let res = await patch("/api/settings", { github: { token: "mine" } });
                expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
                res = await patch("/api/settings", { addonDownloads: [] });
                expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
                res = await patch("/api/settings", { addonDownloadsReset: true });
                expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
                expect(settingsStore.saveConfig).not.toHaveBeenCalled();
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

                // the secret left out: the stored one stays; unknown fields are dropped, and so is
                // the realm - it is per game version since #542 (versionSettings)
                const res = await patch("/api/settings", { blizzard: { clientId: " bz-id ", region: "EU ", realmSlug: "thunderstrike", namespace: "", hasClientSecret: true, bogus: 1 } });
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ blizzard: { clientId: "bz-id" } });
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

            it("saves which roles count as orga, trimmed - and only for a full admin", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                await patch("/api/settings", { orgaRoleIds: [" r-lead ", "", "r-officer"] });
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ orgaRoleIds: ["r-lead", "r-officer"] });

                settingsStore.saveConfig.mockClear();
                auth.getUser.mockReturnValue({ id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), settings: { read: true, write: true } } });
                const res = await patch("/api/settings", { orgaRoleIds: ["r-mo"] });
                // a settings writer must not make their own raider role orga
                expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
                expect(settingsStore.saveConfig).not.toHaveBeenCalled();
            });

            it("refuses a role of the PuG onboarding as orga role, keeps an old entry (#930)", async () => {
                const rosterStore = require("../../../src/stores/rosterStore");
                jest.spyOn(rosterStore, "listRosters").mockReturnValue([]);
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                const pugRoles = { g1: { versions: { tbc: "r-pug-tbc" }, classes: { Mage: "r-pug-mage" } } };
                settingsStore.getConfig.mockReturnValue({ pugRoles, orgaRoleIds: ["r-pug-tbc"] });
                try {
                    const res = await patch("/api/settings", { orgaRoleIds: ["r-pug-tbc", "r-pug-mage"] });
                    expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
                    expect(json(res)).toMatchObject({ error: { code: "pug_onboarding_role", message: expect.stringContaining("Orga-Rolle") } });
                    expect(json(res).error.message).toContain("Magier");
                    expect(settingsStore.saveConfig).not.toHaveBeenCalled();
                    // the old orga entry does not block another save
                    await patch("/api/settings", { orgaRoleIds: ["r-pug-tbc", "r-lead"] });
                    expect(settingsStore.saveConfig).toHaveBeenCalledWith({ orgaRoleIds: ["r-pug-tbc", "r-lead"] });
                } finally {
                    settingsStore.getConfig.mockReturnValue({});
                    rosterStore.listRosters.mockRestore();
                }
            });

            it("refuses raising an onboarding role's area right and a new role-sync pair (#930)", async () => {
                const rosterStore = require("../../../src/stores/rosterStore");
                jest.spyOn(rosterStore, "listRosters").mockReturnValue([]);
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                const R = "300000000000000001";
                const sync = (toRoleId) => ({ fromGuildId: "100000000000000001", fromRoleId: R, toGuildId: "100000000000000002", toRoleId, direction: "both" });
                settingsStore.getConfig.mockReturnValue({
                    pugRoles: { "100000000000000001": { versions: { tbc: R }, classes: {} } },
                    rolePermissions: { [R]: { raids: { read: true, write: false } } },
                    roleSync: [sync("300000000000000002")],
                });
                try {
                    const res = await patch("/api/settings", { rolePermissions: { [R]: { raids: { read: true, write: true } } } });
                    expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
                    expect(json(res).error.message).toContain("Bereichsrecht raids (schreiben)");
                    const res2 = await patch("/api/settings", { roleSync: [sync("300000000000000002"), sync("300000000000000003")] });
                    expect(res2.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
                    expect(json(res2).error.message).toContain("mit Rolle 300000000000000003");
                    expect(settingsStore.saveConfig).not.toHaveBeenCalled();
                } finally {
                    settingsStore.getConfig.mockReturnValue({});
                    rosterStore.listRosters.mockRestore();
                }
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

        describe("PATCH /api/settings versionSettings (#542)", () => {
            beforeEach(() => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                auth.checkCsrf.mockReturnValue(true);
                settingsStore.listRaidsheets.mockReturnValue([{ id: "tier45", name: "Tier 4/5" }]);
                settingsStore.saveConfig.mockReturnValue({ guildId: "g1" });
            });

            it("forwards only the versions and fields sent, normalised", async () => {
                const res = await patch("/api/settings", { versionSettings: {
                    forever: { blizzardRegion: "EU", blizzardRealmSlug: "Everlook", wowheadPath: "", raidsheetId: "tier45" },
                    tbc: { armoryUrlTemplate: "https://armory.test/{char}" },
                    wotlk: { wowheadPath: "wotlk" },
                } });
                expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ versionSettings: {
                    forever: { blizzardRegion: "eu", blizzardRealmSlug: "everlook", wowheadPath: "", raidsheetId: "tier45" },
                    tbc: { armoryUrlTemplate: "https://armory.test/{char}" },
                } });
            });

            it("refuses a value it would have to throw away, naming the version", async () => {
                const res = await patch("/api/settings", { versionSettings: { forever: { armoryUrlTemplate: "https://armory.test/no-placeholder" } } });
                expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                expect(json(res).error).toEqual({ code: "invalid_version_settings", message: "WoW Forever: armoryUrlTemplate ist ungültig." });
                expect(settingsStore.saveConfig).not.toHaveBeenCalled();
            });

            // --- per-server overrides (#923) ---
            describe("per-server overrides on the active server (#923)", () => {
                const ACTIVE = "111111111111111111";
                const OTHER = "222222222222222222";
                beforeEach(() => activeGuildFor.mockReturnValue(ACTIVE));
                afterEach(() => activeGuildFor.mockReturnValue(""));

                it("stores the active server's own armory/log templates and realm per version, cleaned", async () => {
                    const res = await patch("/api/settings", { serverSettingsGuildId: ACTIVE, versionOverrides: {
                        tbc: { armoryUrlTemplate: " https://own.test/{char} ", wclUrlTemplate: "", wowheadPath: "classic" },
                        forever: { blizzardRealmSlug: "Everlook", blizzardRegion: "us" },
                        wotlk: {},
                    } });
                    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                    expect(settingsStore.saveConfig).toHaveBeenCalledWith({ serverSettings: {
                        [ACTIVE]: { versionOverrides: {
                            tbc: { armoryUrlTemplate: "https://own.test/{char}" },
                            forever: { blizzardRealmSlug: "everlook", blizzardRegion: "us" },
                        } },
                    } });
                });

                it("refuses an invalid server template with invalid_version_settings and stores nothing", async () => {
                    const res = await patch("/api/settings", { serverSettingsGuildId: ACTIVE, versionOverrides: { forever: { wclUrlTemplate: "https://wcl.test/no-placeholder" } } });
                    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                    expect(json(res).error).toEqual({ code: "invalid_version_settings", message: "WoW Forever: wclUrlTemplate ist ungültig." });
                    expect(settingsStore.saveConfig).not.toHaveBeenCalled();
                });

                it("refuses with 409 when the session switched to another server since the page loaded", async () => {
                    for (const sent of [{ serverSettingsGuildId: OTHER }, {}]) {
                        const res = await patch("/api/settings", { ...sent, versionOverrides: { tbc: { armoryUrlTemplate: "https://x.test/{char}" } } });
                        expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
                        expect(json(res).error.code).toBe("server_switched");
                    }
                    expect(settingsStore.saveConfig).not.toHaveBeenCalled();
                });

                it("needs an active server (no first-server fallback)", async () => {
                    activeGuildFor.mockReturnValue("");
                    const res = await patch("/api/settings", { serverSettingsGuildId: "", versionOverrides: {} });
                    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                    expect(json(res).error.code).toBe("no_active_server");
                    expect(settingsStore.saveConfig).not.toHaveBeenCalled();
                });

                it("never writes another server's block sent as serverSettings", async () => {
                    const res = await patch("/api/settings", { serverSettings: { [OTHER]: { versionOverrides: { tbc: { armoryUrlTemplate: "https://x.test/{char}" } } } } });
                    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                    const saved = settingsStore.saveConfig.mock.calls.map((c) => c[0]);
                    expect(saved.some((p) => p && p.serverSettings)).toBe(false);
                });

                it("goes next to the server's other keys in one PATCH", async () => {
                    const res = await patch("/api/settings", { serverSettingsGuildId: ACTIVE, logChannels: [], versionOverrides: { tbc: { wclUrlTemplate: "https://wcl.test/{char}" } } });
                    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                    expect(settingsStore.saveConfig.mock.calls[0][0].serverSettings[ACTIVE]).toEqual({
                        logChannels: [], versionOverrides: { tbc: { wclUrlTemplate: "https://wcl.test/{char}" } },
                    });
                });
            });
            // --- end per-server overrides (#923) ---

            it("takes a version colour as lower-case #rrggbb, an empty one resets it, a bad one is refused", async () => {
                const ok = await patch("/api/settings", { versionSettings: { forever: { color: "#AA3377" }, tbc: { color: "" } } });
                expect(ok.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ versionSettings: { forever: { color: "#aa3377" }, tbc: { color: "" } } });
                settingsStore.saveConfig.mockClear();
                const bad = await patch("/api/settings", { versionSettings: { forever: { color: "blue" } } });
                expect(bad.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                expect(json(bad).error.message).toBe("WoW Forever: color ist ungültig.");
                expect(settingsStore.saveConfig).not.toHaveBeenCalled();
            });

            it("refuses a raidsheet nobody has", async () => {
                const res = await patch("/api/settings", { versionSettings: { tbc: { raidsheetId: "gone" } } });
                expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                expect(json(res).error.message).toBe("TBC Anniversary: Raidsheet nicht gefunden.");
            });

            it("takes the features switched off as a list of known ids, in the matrix order (#761)", async () => {
                const res = await patch("/api/settings", { versionSettings: { tbc: { disabled: ["softres", "logcheck", "logcheck"] }, forever: { disabled: [] } } });
                expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ versionSettings: { tbc: { disabled: ["logcheck", "softres"] }, forever: { disabled: [] } } });
            });

            it("refuses an unknown feature or a list that is none, naming the version (#761)", async () => {
                const unknown = await patch("/api/settings", { versionSettings: { tbc: { disabled: ["logcheck", "teleport"] } } });
                expect(unknown.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                expect(json(unknown).error).toEqual({ code: "invalid_version_settings", message: "TBC Anniversary: unbekannte Funktion „teleport“." });
                const notAList = await patch("/api/settings", { versionSettings: { forever: { disabled: "logcheck" } } });
                expect(json(notAList).error.message).toBe("WoW Forever: disabled ist ungültig.");
                expect(settingsStore.saveConfig).not.toHaveBeenCalled();
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
                // no edition asked: the Wowhead path of the main version (#542)
                expect(wowhead.searchItems).toHaveBeenCalledWith("kalter", { edition: "", path: "tbc" });
                expect(json(res)).toEqual({ data: { items: [{ id: 30883, name: "Kalter Fels" }] } });
            });

            it("searches nothing while the main version has no Wowhead path, and honours an edition asked for", async () => {
                auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
                settingsStore.getConfig.mockReturnValue({ mainVersion: "forever", versionSettings: {} });
                const res = await get("/api/settings/item-search", { q: "kalter" });
                expect(wowhead.searchItems).not.toHaveBeenCalled();
                expect(json(res)).toEqual({ data: { items: [] } });
                await get("/api/settings/item-search", { q: "kalter", edition: "classic" });
                expect(wowhead.searchItems).toHaveBeenCalledWith("kalter", { edition: "classic", path: "" });
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

        describe("characters per signup per category", () => {
            beforeEach(() => {
                settingsStore.getConfig.mockReturnValue({});
                settingsStore.saveConfig.mockImplementation((partial) => ({ ...partial }));
            });

            it("keeps 1..8 per category (clamped, 8 = back to the default), drops what is no number", async () => {
                readJsonBody.mockResolvedValue({ categorySignupCharacters: { pug: 3, guild: "8", many: 25, zero: 0, bad: "x", " ": 2 } });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categorySignupCharacters: { pug: 3, guild: 8, many: 8, zero: 1 } });
            });
        });

        describe("the language of a category's posts", () => {
            const languageChange = require("../../../src/services/discord/languageChange");
            beforeEach(() => {
                // the store answers what was saved (earlier tests leave fixed answers behind)
                settingsStore.getConfig.mockReturnValue({});
                settingsStore.saveConfig.mockImplementation((partial) => ({ ...partial }));
            });

            it("stores de/en per category, \"\" for back to the server language, and redraws the posts", async () => {
                readJsonBody.mockResolvedValue({ categoryLanguage: { pug: "en", guild: "DE", other: "server" } });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categoryLanguage: { pug: "en", guild: "de", other: "" } });
                expect(languageChange.afterServerLangChange).toHaveBeenCalledTimes(1);
            });

            it("passes attendance settings per category whole, defaults filled in", async () => {
                // any whole number from 1 to 50 is kept, anything else becomes the default 11
                readJsonBody.mockResolvedValue({ categoryAttendance: {
                    pug: { show: false, window: "8" }, " ": { show: false }, guild: { window: 3 }, many: { window: 51 }, zero: { window: 0 },
                } });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categoryAttendance: {
                    pug: { show: false, window: 8, absences: true },
                    guild: { show: true, window: 3, absences: true },
                    many: { show: true, window: 11, absences: true },
                    zero: { show: true, window: 11, absences: true },
                } });
            });

            it("redraws nothing when the languages stay as they were", async () => {
                readJsonBody.mockResolvedValue({ categorySetupDms: { c1: true } });
                await updateSettings({ headers: {} }, mockRes());
                expect(languageChange.afterServerLangChange).not.toHaveBeenCalled();
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

        describe("Planung je Kategorie: Raidplan oder Sheet", () => {
            it("passes the known modes on and drops anything else", async () => {
                readJsonBody.mockResolvedValue({ categoryPlanning: { c1: "sheet", c2: "raidplan", c3: "both" } });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categoryPlanning: { c1: "sheet", c2: "raidplan" } });
            });

            it("is a setting a limited settings user may change (not full-admin-only)", async () => {
                requireAdmin.mockReturnValue({ id: "7", isAdmin: false, access: { settings: { read: true, write: true } } });
                requireFullAdmin.mockReturnValue(null);
                readJsonBody.mockResolvedValue({ categoryPlanning: { c1: "sheet" } });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categoryPlanning: { c1: "sheet" } });
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
                settingsStore.getConfig.mockReturnValue({ discordServers: { servers: [{ guildId: "200" }, { guildId: "300" }], links: [], talkGuildId: "300", signupNoteChannelId: "2001" } });
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
        // #927: Einstellungen -> Server -> Raid-Helper, per server; the key never leaves the server
        describe("Raid-Helper per server (#927)", () => {
            const KEY = "secret-test-key-ABCD1234";
            const stored = (raidhelper) => ({
                discordServers: { servers: [{ guildId: "200" }, { guildId: "300" }] },
                serverSettings: raidhelper ? { 200: { raidhelper } } : {},
            });
            const leaks = (value) => JSON.stringify(value).includes(KEY);

            beforeEach(() => activeGuildFor.mockReturnValue("200"));

            it("keeps the block full-admin-only", () => {
                expect(FULL_ADMIN_KEYS).toContain("raidhelper");
            });

            it("shows the active server's block masked: whether there is a key and its last 4 characters", async () => {
                settingsStore.getConfig.mockReturnValue(stored({ enabled: true, serverId: "", apiKey: KEY }));
                const res = mockRes();
                await getSettings({}, res);
                expect(body(res).raidhelper).toMatchObject({ enabled: true, hasKey: true, keyLast4: "1234", active: true, envKey: false });
                expect(body(res).raidhelperActive).toBe(true);
                expect(leaks(body(res))).toBe(false);
            });

            it("shows a server without a block as off without a key", async () => {
                settingsStore.getConfig.mockReturnValue(stored(null));
                activeGuildFor.mockReturnValue("300");
                const res = mockRes();
                await getSettings({}, res);
                expect(body(res).raidhelper).toMatchObject({ enabled: false, hasKey: false, keyLast4: "", active: false });
                // the category cards then offer only EventHelper
                expect(body(res).raidhelperActive).toBe(false);
            });

            it("strips the key from the config the page reads", () => {
                const out = publicConfig(stored({ enabled: true, apiKey: KEY }));
                expect(out.serverSettings[200].raidhelper).toMatchObject({ enabled: true, hasKey: true });
                expect(leaks(out)).toBe(false);
            });

            it("sets a key, switches on and answers masked", async () => {
                settingsStore.getConfig.mockReturnValue(stored(null));
                readJsonBody.mockResolvedValue({ raidhelper: { enabled: true, apiKey: ` ${KEY} ` }, serverSettingsGuildId: "200" });
                const res = mockRes();
                await updateSettings({ headers: {} }, res);
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ serverSettings: { 200: { raidhelper: expect.objectContaining({ enabled: true, apiKey: KEY, envKey: false }) } } });
                expect(body(res).raidhelper).toMatchObject({ enabled: true, hasKey: true, keyLast4: "1234" });
                expect(leaks(body(res))).toBe(false);
            });

            it("keeps the key when none is sent and clears it on an empty one", async () => {
                settingsStore.getConfig.mockReturnValue(stored({ enabled: true, apiKey: KEY, envKey: false }));
                readJsonBody.mockResolvedValue({ raidhelper: { enabled: false }, serverSettingsGuildId: "200" });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig.mock.calls[0][0].serverSettings[200].raidhelper).toMatchObject({ enabled: false, apiKey: KEY });

                readJsonBody.mockResolvedValue({ raidhelper: { apiKey: "" }, serverSettingsGuildId: "200" });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig.mock.calls[1][0].serverSettings[200].raidhelper).toMatchObject({ apiKey: "" });
            });

            it("keeps the .env key mark until a key is entered", async () => {
                settingsStore.getConfig.mockReturnValue(stored({ enabled: true, envKey: true }));
                readJsonBody.mockResolvedValue({ raidhelper: { serverId: "123456789012345678" }, serverSettingsGuildId: "200" });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig.mock.calls[0][0].serverSettings[200].raidhelper).toMatchObject({ envKey: true, serverId: "123456789012345678", apiKey: "" });
            });

            it("refuses a bad server id or key and saves nothing", async () => {
                settingsStore.getConfig.mockReturnValue(stored(null));
                for (const raidhelper of [{ serverId: "abc" }, { apiKey: "two words" }, { apiKey: "x".repeat(201) }]) {
                    readJsonBody.mockResolvedValue({ raidhelper, serverSettingsGuildId: "200" });
                    const res = mockRes();
                    await updateSettings({ headers: {} }, res);
                    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                    expect(leaks(body(res))).toBe(false);
                }
                expect(settingsStore.saveConfig).not.toHaveBeenCalled();
            });

            it("refuses without any server", async () => {
                settingsStore.getConfig.mockReturnValue({});
                activeGuildFor.mockReturnValue("");
                readJsonBody.mockResolvedValue({ raidhelper: { enabled: true } });
                const res = mockRes();
                await updateSettings({ headers: {} }, res);
                expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            });

            // #921: the active server is per session, not per tab — a tab loaded
            // on 200 whose session switched to 300 must not write 300's block
            it("refuses a PATCH for another server than the active one (409) and leaves its block alone", async () => {
                const before = { enabled: true, serverId: "", apiKey: KEY, envKey: false };
                settingsStore.getConfig.mockReturnValue({
                    discordServers: { servers: [{ guildId: "200" }, { guildId: "300" }] },
                    serverSettings: { 300: { raidhelper: before } },
                });
                activeGuildFor.mockReturnValue("300");
                for (const sent of [{ serverSettingsGuildId: "200" }, {}]) {
                    readJsonBody.mockResolvedValue({ raidhelper: { enabled: false }, ...sent });
                    const res = mockRes();
                    await updateSettings({ headers: {} }, res);
                    expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
                    expect(body(res).error.code).toBe("server_switched");
                    expect(leaks(body(res))).toBe(false);
                }
                expect(settingsStore.saveConfig).not.toHaveBeenCalled();
                expect(settingsStore.getConfig().serverSettings[300].raidhelper).toEqual(before);
            });

            it("saves for the server the page loaded when it is still the active one", async () => {
                settingsStore.getConfig.mockReturnValue(stored(null));
                activeGuildFor.mockReturnValue("300");
                readJsonBody.mockResolvedValue({ raidhelper: { enabled: true }, serverSettingsGuildId: "300" });
                const res = mockRes();
                await updateSettings({ headers: {} }, res);
                expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ serverSettings: { 300: { raidhelper: expect.objectContaining({ enabled: true }) } } });
            });

            it("without an active server edits the first server, as the page shows it (#927)", async () => {
                settingsStore.getConfig.mockReturnValue(stored(null));
                activeGuildFor.mockReturnValue("");
                readJsonBody.mockResolvedValue({ raidhelper: { enabled: true }, serverSettingsGuildId: "" });
                const res = mockRes();
                await updateSettings({ headers: {} }, res);
                expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                expect(settingsStore.saveConfig.mock.calls[0][0].serverSettings[200].raidhelper).toMatchObject({ enabled: true });
            });

            it("still needs an active server when log channels go along (no first-server fallback)", async () => {
                settingsStore.getConfig.mockReturnValue(stored(null));
                activeGuildFor.mockReturnValue("");
                readJsonBody.mockResolvedValue({ raidhelper: { enabled: true }, logChannels: [], serverSettingsGuildId: "" });
                const res = mockRes();
                await updateSettings({ headers: {} }, res);
                expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                expect(settingsStore.saveConfig).not.toHaveBeenCalled();
            });
        });

        describe("Discord-Server settings", () => {
            const stored = {
                guildId: "200",
                discordServers: {
                    servers: [{ guildId: "200", label: "" }, { guildId: "300", label: "" }],
                    links: [{ from: "200", to: "300", channelId: "301", lang: "en", versions: ["tbc"] }],
                },
            };
            const guild = (id, name, memberCount) => ({ id, name, memberCount });

            it("keeps the server block full-admin-only", () => {
                expect(FULL_ADMIN_KEYS).toContain("discordServers");
            });

            it("stores only the sent fields of the block", async () => {
                // #894: talkPingChannelId is gone and dropped like any unknown field
                readJsonBody.mockResolvedValue({ discordServers: { signupNoteChannelId: " 302 ", talkPingChannelId: "303", bogus: "x" } });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ discordServers: { signupNoteChannelId: "302" } });
            });

            it("stores the guild bank channel and redraws the organizers when it changes", async () => {
                const availabilityPanel = require("../../../src/services/signups/availabilityPanel");
                availabilityPanel.refreshPanels.mockClear();
                auth.checkCsrf.mockReturnValue(true);
                settingsStore.saveConfig.mockReturnValueOnce({ discordServers: { guildBankChannelId: "4001" } });
                readJsonBody.mockResolvedValue({ discordServers: { guildBankChannelId: " 4001 " } });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig).toHaveBeenCalledWith({ discordServers: { guildBankChannelId: "4001" } });
                expect(availabilityPanel.refreshPanels).toHaveBeenCalledWith({ config: { discordServers: { guildBankChannelId: "4001" } } });
            });

            it("leaves the organizers alone when the guild bank channel stays the same", async () => {
                const availabilityPanel = require("../../../src/services/signups/availabilityPanel");
                availabilityPanel.refreshPanels.mockClear();
                auth.checkCsrf.mockReturnValue(true);
                settingsStore.getConfig.mockReturnValue({ discordServers: { guildBankChannelId: "4001" } });
                settingsStore.saveConfig.mockReturnValueOnce({ discordServers: { guildBankChannelId: "4001", signupNoteChannelId: "302" } });
                readJsonBody.mockResolvedValue({ discordServers: { guildBankChannelId: "4001", signupNoteChannelId: "302" } });
                await updateSettings({ headers: {} }, mockRes());
                expect(availabilityPanel.refreshPanels).not.toHaveBeenCalled();
                settingsStore.getConfig.mockReturnValue({});
            });

            it("refuses the block for a limited settings user", async () => {
                requireAdmin.mockReturnValue({ id: "7", isAdmin: false });
                requireFullAdmin.mockReturnValue(null);
                readJsonBody.mockResolvedValue({ discordServers: { eventGuilds: [{ guildId: "999999" }] } });
                await updateSettings({ headers: {} }, mockRes());
                expect(settingsStore.saveConfig).not.toHaveBeenCalled();
            });

            it("puts the server cards into GET /api/settings for a full admin only, no talk card (#897)", async () => {
                settingsStore.getConfig.mockReturnValue(stored);
                discord.getGuild.mockImplementation((id) => (id === "200" ? guild("200", "Pulse Events", 212) : null));
                discord.botPermissionsIn.mockReturnValue([{ key: "ManageRoles", label: "Rollen verwalten", ok: false }]);
                const res = mockRes();
                await getSettings({}, res);
                const { servers, config } = body(res);
                expect(servers.events[0]).toMatchObject({ role: "event", name: "Pulse Events", connected: true, missing: ["Rollen verwalten"] });
                expect(servers.talk).toBeUndefined();
                expect(config.discordServers).toEqual(stored.discordServers);

                requireAdmin.mockReturnValue({ id: "7", isAdmin: false });
                const res2 = mockRes();
                await getSettings({}, res2);
                expect(body(res2).servers).toBeNull();
                expect(body(res2).config.discordServers).toBeUndefined();
                settingsStore.getConfig.mockReturnValue({});
            });

            it("serves the page: servers with categories and language, links, bot servers and versions (#891)", async () => {
                settingsStore.getConfig.mockReturnValue({ ...stored, categoryIds: ["2009"] });
                discord.getGuild.mockImplementation((id) => ({
                    ...guild(id, id === "200" ? "Pulse Events" : "Pulse Talk", 10),
                    preferredLocale: id === "300" ? "en-US" : "de",
                }));
                discord.listGuilds.mockReturnValue([{ id: "200", name: "Pulse Events" }, { id: "300", name: "Pulse Talk" }, { id: "400", name: "Andere" }]);
                discord.listTextChannels.mockImplementation((id) => [{ id: `${id}1`, name: "chat", category: "" }]);
                discord.listCategories.mockImplementation((id) => (id === "200" ? [{ id: "2009", name: "Raids" }, { id: "2008", name: "Chat" }] : []));
                const res = mockRes();
                await getDiscordServers({}, res);
                const data = body(res);
                // no talk fields on the page (#897), the global channels stay on it
                expect(data.discordServers).toEqual({
                    servers: stored.discordServers.servers,
                    links: stored.discordServers.links,
                    signupNoteChannelId: "",
                    guildBankChannelId: "",
                });
                expect(data.servers.map((s) => [s.id, s.name, s.raidCategories, s.lang, s.memberCount])).toEqual([
                    ["200", "Pulse Events", 1, "de", 10], ["300", "Pulse Talk", 0, "en", 10],
                ]);
                expect(data.guilds.map((g) => [g.id, g.lang, g.channels[0].id])).toEqual([
                    ["200", "de", "2001"], ["300", "en", "3001"], ["400", "de", "4001"],
                ]);
                expect(data.versions.map((v) => v.id)).toEqual(expect.arrayContaining(["tbc"]));
                expect(data.overlap).toBeUndefined();
                expect(data.talk).toBeUndefined();
                settingsStore.getConfig.mockReturnValue({});
                discord.listCategories.mockReturnValue([]);
            });

            describe("PATCH servers and links (#891)", () => {
                const patchStored = {
                    discordServers: {
                        servers: [{ guildId: "20000", label: "" }, { guildId: "30000", label: "" }],
                        links: [{ from: "20000", to: "30000", channelId: "30001", lang: "en", versions: ["tbc"] }],
                        talkGuildId: "30000", talkPingChannelId: "",
                    },
                };
                const save = async (discordServers) => {
                    settingsStore.getConfig.mockReturnValue(patchStored);
                    readJsonBody.mockResolvedValue({ discordServers });
                    const res = mockRes();
                    await updateSettings({ headers: {} }, res);
                    settingsStore.getConfig.mockReturnValue({});
                    return res;
                };
                const link = { from: "20000", to: "40000", channelId: "40001", lang: "", versions: [] };

                it("stores the servers and links as sent, without touching the talk fields", async () => {
                    await save({
                        servers: [{ guildId: "20000", label: " Raids " }, { guildId: "30000", label: "" }],
                        links: [...patchStored.discordServers.links, { ...link, lang: "de", versions: ["tbc", "tbc"] }],
                    });
                    expect(settingsStore.saveConfig).toHaveBeenCalledWith({
                        discordServers: {
                            servers: [{ guildId: "20000", label: "Raids" }, { guildId: "30000", label: "" }],
                            links: [
                                { from: "20000", to: "30000", channelId: "30001", lang: "en", versions: ["tbc"] },
                                { from: "20000", to: "40000", channelId: "40001", lang: "de", versions: ["tbc"] },
                            ],
                        },
                    });
                });

                it("checks links sent alone against the stored servers", async () => {
                    await save({ links: [link] });
                    expect(settingsStore.saveConfig).toHaveBeenCalledWith({ discordServers: { links: [link] } });
                });

                it.each([
                    ["an unknown source server", { links: [{ ...link, from: "99999" }] }, "Unbekannter Quell-Server."],
                    ["a source removed in the same save", { servers: [{ guildId: "30000" }], links: [link] }, "Unbekannter Quell-Server."],
                    ["a missing channel", { links: [{ ...link, channelId: "" }] }, "Kanal fehlt."],
                    ["a target that is no server id", { links: [{ ...link, to: "abc" }] }, "Unbekannter Ziel-Server."],
                    ["a duplicate link", { links: [link, { ...link, channelId: "40002" }] }, "Diese Verknüpfung gibt es schon."],
                    ["an unknown language", { links: [{ ...link, lang: "fr" }] }, "Unbekannte Sprache."],
                    ["an unknown version", { links: [{ ...link, versions: ["wotlk-x"] }] }, "Unbekannte Spielversion."],
                    ["a server id that is no snowflake", { servers: [{ guildId: "x" }] }, "Unbekannter Server."],
                    ["a server twice", { servers: [{ guildId: "20000" }, { guildId: "20000" }] }, "Server doppelt eingetragen."],
                    ["more than ten servers", { servers: Array.from({ length: 11 }, (_, i) => ({ guildId: String(1000 + i) })) }, "Höchstens 10 Server."],
                    ["the old eventGuilds list", { eventGuilds: [{ guildId: "20000" }] }, "Veraltetes Format – bitte die Seite neu laden."],
                    ["servers alone that drop a link's source", { servers: [{ guildId: "30000" }] },
                        "Der Server ist noch Quelle einer Verknüpfung – erst die Verknüpfung entfernen."],
                ])("refuses %s with a 400", async (_name, block, message) => {
                    const res = await save(block);
                    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                    expect(json(res).error).toMatchObject({ code: "invalid_discord_servers", message });
                    expect(settingsStore.saveConfig).not.toHaveBeenCalled();
                });

                it("caps a label at the schema's 60 characters", async () => {
                    await save({ servers: [{ guildId: "20000", label: "x".repeat(80) }, { guildId: "30000" }], links: patchStored.discordServers.links });
                    const sent = settingsStore.saveConfig.mock.calls[0][0].discordServers.servers;
                    expect(sent[0].label).toHaveLength(60);
                });

                // #897: the old ping server (a leftover talkGuildId) is an ordinary server now
                it("removes the old ping server like any other server", async () => {
                    const res = await save({ servers: [{ guildId: "20000" }], links: [] });
                    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                    expect(settingsStore.saveConfig).toHaveBeenCalledWith({ discordServers: { servers: [{ guildId: "20000", label: "" }], links: [] } });
                });

                it("keeps the stored state intact after the real normalisation", async () => {
                    // saveConfig/getConfig go to the real configStore on a temp file:
                    // a refused save leaves the stored block as it was.
                    const configStore = require("../../../src/stores/configStore");
                    configStore.useFile(tempStoreFile("ds-891-config.json"));
                    settingsStore.getConfig.mockImplementation(() => configStore.getConfig());
                    settingsStore.saveConfig.mockImplementation((p) => configStore.saveConfig(p));
                    try {
                        configStore.saveConfig({ guildId: "20000", discordServers: patchStored.discordServers });
                        readJsonBody.mockResolvedValue({ discordServers: { servers: [{ guildId: "30000", label: "" }] } });
                        const refused = mockRes();
                        await updateSettings({ headers: {} }, refused);
                        expect(refused.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                        expect(configStore.getConfig().discordServers).toMatchObject({
                            servers: [{ guildId: "20000" }, { guildId: "30000" }],
                            links: [{ from: "20000", to: "30000", channelId: "30001" }],
                        });

                        // removing a plain server with its links goes through as sent
                        configStore.saveConfig({ discordServers: { servers: [...patchStored.discordServers.servers, { guildId: "50000", label: "" }],
                            links: [...patchStored.discordServers.links, { from: "50000", to: "30000", channelId: "30002", lang: "", versions: [] }] } });
                        readJsonBody.mockResolvedValue({ discordServers: { servers: patchStored.discordServers.servers, links: patchStored.discordServers.links } });
                        const ok = mockRes();
                        await updateSettings({ headers: {} }, ok);
                        expect(ok.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
                        const stored = configStore.getConfig().discordServers;
                        expect(stored.servers.map((s) => s.guildId)).toEqual(["20000", "30000"]);
                        expect(stored.links).toEqual([{ from: "20000", to: "30000", channelId: "30001", lang: "en", versions: ["tbc"] }]);
                        expect(stored.talkGuildId).toBeUndefined();
                    } finally {
                        configStore.useFile(null);
                        settingsStore.getConfig.mockImplementation(() => ({}));
                        settingsStore.saveConfig.mockImplementation((partial) => ({ ...partial }));
                    }
                });
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
                readJsonBody.mockResolvedValue({ roleSync: [{ fromGuildId: "100000", fromRoleId: "111111", toGuildId: "300000", toRoleId: "222222", direction: "both" }] });
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
                expect(body(res)).toMatchObject({ roleSync: [], overlaps: [], drift: [], driftTotal: 0, driftError: null });

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
                    { id: "900000", name: "Raids Mittwoch", roleCount: 2, active: true },
                    { id: "910000", name: "", roleCount: 0, active: false },
                ]);
                expect(data).not.toHaveProperty("pingTargets");
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
                expect(body(res).categories).toEqual([{ id: "920000", name: "PvP-Raids", roleCount: 0, active: true }]);
                settingsStore.getConfig.mockReturnValue({});
            });
        });
    });
});

// "Andere Versionen ausblenden" (#563): the switch is saved, the settings page
// gets the coming raids per version, and the archive export is a download for
// full admins only.
describe("web/apiRoutes/settings: content switch (#563)", () => {
    const contentVersions = require("../../../src/services/events/contentVersions");

    beforeEach(() => {
        requireAdmin.mockReset().mockImplementation(realMiddleware.requireAdmin);
        requireFullAdmin.mockReset().mockImplementation(realMiddleware.requireFullAdmin);
        readJsonBody.mockReset().mockImplementation(realBody.readJsonBody);
        settingsStore.getConfig.mockReturnValue({});
    });

    it("saves hideOtherVersions as a boolean", async () => {
        auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
        auth.checkCsrf.mockReturnValue(true);
        await patch("/api/settings", { hideOtherVersions: true });
        expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ hideOtherVersions: true });
        await patch("/api/settings", { hideOtherVersions: "yes" });
        expect(settingsStore.saveConfig).toHaveBeenLastCalledWith({ hideOtherVersions: false });
    });

    it("sends the coming raids per version with the settings", async () => {
        auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
        contentVersions.upcomingByVersion.mockReturnValue({ tbc: [{ id: "e1", title: "BT", startTime: 100 }] });
        const res = await get("/api/settings");
        expect(json(res).data.upcomingByVersion).toEqual({ tbc: [{ id: "e1", title: "BT", startTime: 100 }] });
    });

    it("hands a full admin the archive as a CSV download", async () => {
        auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
        const res = await get("/api/settings/archive-export");
        const [code, headers] = res.writeHead.mock.calls[0];
        expect(code).toBe(200);
        expect(headers["Content-Type"]).toBe("text/csv; charset=utf-8");
        expect(headers["Content-Disposition"]).toBe("attachment; filename=\"eventhelper-archiv-tbc-classic-2026-10-01.csv\"");
        const text = res.end.mock.calls[0][0];
        expect(text.charCodeAt(0)).toBe(0xfeff);
        expect(text.slice(1)).toBe("type,versionId\r\nloot,tbc\r\n");
    });

    it("hands the same archive as JSON when asked", async () => {
        auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
        const res = await get("/api/settings/archive-export", { format: "json" });
        const [code, headers] = res.writeHead.mock.calls[0];
        expect(code).toBe(200);
        expect(headers["Content-Disposition"]).toContain(".json\"");
        expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({ versions: ["tbc", "classic"], loot: [], attendance: [] });
    });

    it("refuses the export to a settings user who is no full admin", async () => {
        auth.getUser.mockReturnValue({
            id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), settings: { read: true, write: true } },
        });
        const res = await get("/api/settings/archive-export");
        expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
    });
});
