const { EventEmitter } = require("events");

jest.mock("../../src/web/auth", () => ({
    getUser: jest.fn(),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../src/web/reportStore", () => ({ listReports: jest.fn(() => []) }));
jest.mock("../../src/web/settingsStore", () => ({
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
    saveRaidTemplate: jest.fn(),
    saveRaidTemplates: jest.fn(),
    deleteRaidTemplate: jest.fn(),
    listNotify: jest.fn(() => []),
    getNotify: jest.fn(),
    saveNotify: jest.fn(),
    deleteNotify: jest.fn(),
    getRaidsheet: jest.fn(),
}));
jest.mock("../../src/web/activeGuild", () => ({ activeGuildFor: jest.fn(() => "") }));
jest.mock("../../src/web/dashboardData", () => ({
    loadUpcomingSetups: jest.fn(() => Promise.resolve({ events: [], error: null })),
    loadRecentEvents: jest.fn(() => Promise.resolve({ events: [], error: null })),
    annotateUpcomingExtras: jest.fn((events) => events),
}));
jest.mock("../../src/web/raidEventStore", () => ({
    getRaidEvent: jest.fn(() => null),
    listRaidEvents: jest.fn(() => []),
    saveRaidEvents: jest.fn(),
}));
jest.mock("../../src/web/logStore", () => ({
    listLogs: jest.fn(() => []),
    listLogsForEvent: jest.fn(() => []),
    deleteLog: jest.fn(),
    getLog: jest.fn(),
    linkEvent: jest.fn(),
    unlinkEvent: jest.fn(),
}));
jest.mock("../../src/web/reportList", () => ({
    prepareReportList: jest.fn((reports, query) => ({
        items: reports, sort: (query && query.sort) || "date", dir: (query && query.dir) || "desc", page: 1, totalPages: 1, total: reports.length, pageSize: 15,
    })),
    prepareLogList: jest.fn((logs, query) => ({
        items: logs, sort: (query && query.sort) || "date", dir: (query && query.dir) || "desc", page: 1, totalPages: 1, total: logs.length, pageSize: 15,
    })),
    annotateLogCategories: jest.fn((items) => items),
    logPostedAt: jest.fn((l) => (l && l.postedAt) || 0),
}));
jest.mock("../../src/web/logEventMatch", () => ({
    annotateMatches: jest.fn((items) => items),
    autoMatches: jest.fn(() => []),
}));
jest.mock("../../src/web/logChannel", () => ({
    evaluateLog: jest.fn(),
    scanLogChannels: jest.fn(),
    backfillLogTitles: jest.fn(() => Promise.resolve(0)),
}));
jest.mock("../../src/web/manualLog", () => ({ linkLogByUrl: jest.fn() }));
jest.mock("../../src/utils/logcheck/report", () => {
    class ReportError extends Error {}
    return { buildReport: jest.fn(), ReportError };
});
jest.mock("../../src/classes/warcraftlogs", () => jest.fn());
jest.mock("../../src/web/lootStore", () => ({
    addImport: jest.fn(() => ({ added: 0, skipped: 0 })),
    listByEvent: jest.fn(() => []),
    listByCharacter: jest.fn(() => []),
    eventsWithLoot: jest.fn(() => []),
    clearEvent: jest.fn(() => 0),
    repairItemNames: jest.fn(() => Promise.resolve(0)),
}));
jest.mock("../../src/web/characterInfo", () => ({
    rememberFromLoot: jest.fn(),
    annotatedCharacters: jest.fn(() => []),
    resolveMissing: jest.fn(() => Promise.resolve({
        fromExport: 0, fromReports: 0, fromWcl: 0, checkedReports: 0, pendingReports: 0, missing: [], unlinked: [], error: "",
    })),
}));
jest.mock("../../src/web/characterStore", () => ({
    getCharacter: jest.fn(() => null),
    listCharacters: jest.fn(() => []),
}));
jest.mock("../../src/web/raiderCharactersStore", () => ({
    getCategoryAssignments: jest.fn(() => ({})),
    setCategoryAssignments: jest.fn(),
    resolveAssignmentProfiles: jest.fn(() => ({})),
}));
const mockIsConfigured = jest.fn(() => false);
const mockGetCharacterSummary = jest.fn(() => Promise.resolve(null));
const mockGetEquipment = jest.fn(() => Promise.resolve(null));
const mockResolve = jest.fn(() => ({ region: "eu", realm: "thunderstrike", namespace: "profile-classicann-eu" }));
let mockLastError = null;
jest.mock("../../src/classes/blizzard", () =>
    jest.fn().mockImplementation(() => ({
        isConfigured: mockIsConfigured,
        getCharacterSummary: mockGetCharacterSummary,
        getEquipment: mockGetEquipment,
        _resolve: mockResolve,
        get lastError() { return mockLastError; },
    })));
jest.mock("../../src/utils/lootImport", () => {
    class LootParseError extends Error {}
    return {
        parseLoot: jest.fn(() => []),
        detectImportDate: jest.fn(() => null),
        enrichItemNames: jest.fn((items) => Promise.resolve(items)),
        LootParseError,
    };
});
jest.mock("../../src/web/lootEventMatch", () => ({
    bestDayMatch: jest.fn(() => ({ match: null, ambiguous: false })),
    formatDayDisplay: jest.fn(() => "12.07.2026"),
    dayKey: jest.fn(() => "2026-07-12"),
}));
jest.mock("../../src/web/discord", () => ({
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
    getChannelCategoryMap: jest.fn(() => ({})),
    listMembersWithRoles: jest.fn(() => Promise.resolve({ members: [], error: null })),
    postAnnouncement: jest.fn(),
    postMissingPing: jest.fn(),
    postLink: jest.fn(),
    editLink: jest.fn(),
}));
jest.mock("../../src/web/raidEventGroups", () => ({
    loadEventGroups: jest.fn(() => Promise.resolve({ groups: [], error: null })),
    eventLookbackSince: jest.fn(() => 0),
}));
const mockGetTemplates = jest.fn(() => Promise.resolve([]));
const mockCreateEvent = jest.fn(() => Promise.resolve({ id: "ev1" }));
const mockGetPastEvents = jest.fn(() => Promise.resolve([]));
const mockGetSetup = jest.fn(() => Promise.resolve({ setup: [] }));
jest.mock("../../src/classes/raidhelper", () =>
    jest.fn().mockImplementation(() => ({
        getTemplates: mockGetTemplates,
        createEvent: mockCreateEvent,
        getPastEvents: mockGetPastEvents,
        getSetup: mockGetSetup,
    })));
jest.mock("../../src/web/eventSheetStore", () => ({
    getEventSheet: jest.fn(() => null),
    markEventSheetFilled: jest.fn(),
    markEventSheetPosted: jest.fn(),
}));
jest.mock("../../src/web/eventSoftresStore", () => ({
    getEventSoftres: jest.fn(() => null),
    saveEventSoftres: jest.fn(),
    setEventSoftresLink: jest.fn(),
    markEventSoftresPosted: jest.fn(),
}));
jest.mock("../../src/utils/softres", () => ({
    parseInstancesFromTitle: jest.fn(() => []),
    targetSizeForInstances: jest.fn(() => 0),
    catalogue: jest.fn(() => []),
    editionOf: jest.fn(() => ""),
    createRaid: jest.fn(),
}));
jest.mock("../../src/utils/raidsheets", () => ({
    matchRaidsheet: jest.fn(() => null),
}));
jest.mock("../../src/utils/wowhead", () => ({
    searchItems: jest.fn(() => Promise.resolve([])),
}));
const mockDriveCopyFile = jest.fn();
const mockDriveDeleteFile = jest.fn(() => Promise.resolve());
const mockDriveShareAnyoneWriter = jest.fn(() => Promise.resolve());
jest.mock("../../src/classes/drive", () =>
    jest.fn().mockImplementation(() => ({
        copyFile: mockDriveCopyFile,
        deleteFile: mockDriveDeleteFile,
        shareAnyoneWriter: mockDriveShareAnyoneWriter,
    })));
jest.mock("../../src/classes/sheets", () => jest.fn().mockImplementation(() => ({})));
const mockFillSetupSheet = jest.fn();
jest.mock("../../src/utils/fillSetup", () => ({
    fillSetupSheet: (...args) => mockFillSetupSheet(...args),
}));

const auth = require("../../src/web/auth");
const reportStore = require("../../src/web/reportStore");
const settingsStore = require("../../src/web/settingsStore");
const { activeGuildFor } = require("../../src/web/activeGuild");
const dashboardData = require("../../src/web/dashboardData");
const discord = require("../../src/web/discord");
const raidEventGroups = require("../../src/web/raidEventGroups");
const raidEventStore = require("../../src/web/raidEventStore");
const logStore = require("../../src/web/logStore");
const lootStore = require("../../src/web/lootStore");
const characterInfo = require("../../src/web/characterInfo");
const characterStore = require("../../src/web/characterStore");
const raiderCharactersStore = require("../../src/web/raiderCharactersStore");
const lootImport = require("../../src/utils/lootImport");
const lootEventMatch = require("../../src/web/lootEventMatch");
const reportList = require("../../src/web/reportList");
const logEventMatch = require("../../src/web/logEventMatch");
const logChannel = require("../../src/web/logChannel");
const manualLog = require("../../src/web/manualLog");
const { buildReport, ReportError } = require("../../src/utils/logcheck/report");
const eventSheetStore = require("../../src/web/eventSheetStore");
const eventSoftresStore = require("../../src/web/eventSoftresStore");
const softres = require("../../src/utils/softres");
const wowhead = require("../../src/utils/wowhead");
const raidsheetsUtil = require("../../src/utils/raidsheets");
const { handle } = require("../../src/web/apiRouter");

function mockRes() {
    return { writeHead: jest.fn(), end: jest.fn() };
}

function body(res) {
    return JSON.parse(res.end.mock.calls[0][0]);
}

// Drive a mutating /api/* request through the router with a JSON body.
async function request(method, pathname, jsonBody, headers) {
    const req = new EventEmitter();
    req.method = method;
    req.headers = { "x-csrf-token": "tok", ...headers };
    const res = mockRes();
    const p = handle(pathname, req, res);
    req.emit("data", JSON.stringify(jsonBody || {}));
    req.emit("end");
    await p;
    return res;
}
const post = (pathname, jsonBody, headers) => request("POST", pathname, jsonBody, headers);
const patch = (pathname, jsonBody, headers) => request("PATCH", pathname, jsonBody, headers);

// GET requests that read query params need a real URL object (handle()'s 4th arg).
function urlFor(pathname, query) {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : "";
    return new URL(`http://localhost${pathname}${qs}`);
}
async function get(pathname, query) {
    const res = mockRes();
    await handle(pathname, { method: "GET" }, res, urlFor(pathname, query));
    return res;
}

describe("web/apiRouter", () => {
    describe("GET /api/session", () => {
        it("returns user + csrfToken + guilds + activeGuildId for a logged-in admin", async () => {
            auth.getUser.mockReturnValue({ id: "42", name: "Anna", isAdmin: true });
            auth.csrfToken.mockReturnValue("csrf-abc");
            discord.listGuilds.mockReturnValue([{ id: "g1", name: "Meine Gilde" }]);
            activeGuildFor.mockReturnValue("g1");
            const res = mockRes();
            const handled = await handle("/api/session", { method: "GET" }, res);
            expect(handled).toBe(true);
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(body(res)).toEqual({
                data: {
                    user: { id: "42", name: "Anna", isAdmin: true }, csrfToken: "csrf-abc",
                    guilds: [{ id: "g1", name: "Meine Gilde" }], activeGuildId: "g1",
                },
            });
        });

        it("returns user: null, no csrfToken, and no guilds for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            await handle("/api/session", { method: "GET" }, res);
            expect(auth.csrfToken).not.toHaveBeenCalled();
            expect(body(res)).toEqual({ data: { user: null, csrfToken: null, guilds: [], activeGuildId: "" } });
        });

        it("returns no guilds for a logged-in caller who isn't an admin", async () => {
            auth.getUser.mockReturnValue({ id: "7", name: "Bob", isAdmin: false });
            auth.csrfToken.mockReturnValue("csrf-bob");
            discord.listGuilds.mockReturnValue([{ id: "g1", name: "Meine Gilde" }]);
            const res = mockRes();
            await handle("/api/session", { method: "GET" }, res);
            expect(body(res)).toEqual({
                data: {
                    user: { id: "7", name: "Bob", isAdmin: false }, csrfToken: "csrf-bob",
                    guilds: [], activeGuildId: "",
                },
            });
        });
    });

    describe("POST /api/session/guild", () => {
        it("returns 403 when the CSRF token is invalid", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(false);
            const res = await post("/api/session/guild", { guildId: "g1" });
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "csrf", message: expect.any(String) } });
            expect(auth.setActiveGuild).not.toHaveBeenCalled();
        });

        it("returns 400 for an unknown guildId", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            discord.listGuilds.mockReturnValue([{ id: "g1", name: "Meine Gilde" }]);
            const res = await post("/api/session/guild", { guildId: "does-not-exist" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "unknown_guild", message: expect.any(String) } });
            expect(auth.setActiveGuild).not.toHaveBeenCalled();
        });

        it("switches to the given guild on success", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            discord.listGuilds.mockReturnValue([{ id: "g1", name: "Meine Gilde" }]);
            const res = await post("/api/session/guild", { guildId: "g1" });
            expect(auth.setActiveGuild).toHaveBeenCalledWith(expect.any(Object), "g1");
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(body(res)).toEqual({ data: { activeGuildId: "g1" } });
        });

        it("clears the selection when guildId is empty", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            discord.listGuilds.mockReturnValue([{ id: "g1", name: "Meine Gilde" }]);
            const res = await post("/api/session/guild", { guildId: "" });
            expect(auth.setActiveGuild).toHaveBeenCalledWith(expect.any(Object), "");
            expect(body(res)).toEqual({ data: { activeGuildId: "" } });
        });
    });

    describe("GET /api/dashboard", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            const handled = await handle("/api/dashboard", { method: "GET" }, res);
            expect(handled).toBe(true);
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
        });

        it("returns 403 for a logged-in non-admin", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Bob", isAdmin: false });
            const res = mockRes();
            await handle("/api/dashboard", { method: "GET" }, res);
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "forbidden", message: expect.any(String) } });
        });

        it("assembles stats, recent reports, upcoming/recent events, and the active guild for an admin", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            reportStore.listReports.mockReturnValue([
                { id: "r1", title: "Report 1", zone: "MC", generatedAt: 100, issueCount: 2 },
                { id: "r2", title: "Report 2", zone: "BWL", generatedAt: 200, issueCount: 0 },
            ]);
            settingsStore.getConfig.mockReturnValue({ categoryIds: ["a", "b"], adminRoleIds: ["r"] });
            settingsStore.listRecruitment.mockReturnValue([{ id: "t1" }]);
            settingsStore.listRecruitmentPosts.mockReturnValue([{ id: "p1" }, { id: "p2" }]);
            activeGuildFor.mockReturnValue("guild-1");
            dashboardData.loadUpcomingSetups.mockResolvedValue({ events: [{ id: "u1" }], error: null });
            dashboardData.loadRecentEvents.mockResolvedValue({ events: [{ id: "e1" }], error: null });

            const res = mockRes();
            const handled = await handle("/api/dashboard", { method: "GET" }, res);

            expect(handled).toBe(true);
            expect(dashboardData.loadUpcomingSetups).toHaveBeenCalledWith("guild-1", 3);
            expect(dashboardData.loadRecentEvents).toHaveBeenCalledWith("guild-1", 5);
            expect(body(res)).toEqual({
                data: {
                    stats: {
                        reportsTotal: 2,
                        reportsWithIssues: 1,
                        templates: 1,
                        posts: 2,
                        categories: 2,
                        adminRoles: 1,
                    },
                    recentReports: [
                        { id: "r1", title: "Report 1", zone: "MC", generatedAt: 100, issueCount: 2 },
                        { id: "r2", title: "Report 2", zone: "BWL", generatedAt: 200, issueCount: 0 },
                    ],
                    upcoming: { events: [{ id: "u1" }], error: null },
                    recentEvents: { events: [{ id: "e1" }], error: null },
                    activeGuildId: "guild-1",
                },
            });
        });
    });

    describe("GET /api/channels", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            await handle("/api/channels", { method: "GET" }, res);
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });

        it("returns the active guild's categories and channels for an admin", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            discord.listCategories.mockReturnValue([{ id: "cat1", name: "Raids" }]);
            discord.listAllChannels.mockReturnValue([{ id: "c1", name: "kara", type: 0, typeLabel: "Text", category: "Raids", parentId: "cat1" }]);

            const res = mockRes();
            await handle("/api/channels", { method: "GET" }, res);

            expect(body(res)).toEqual({
                data: {
                    categories: [{ id: "cat1", name: "Raids" }],
                    channels: [{ id: "c1", name: "kara", type: 0, typeLabel: "Text", category: "Raids", parentId: "cat1" }],
                    activeGuildId: "guild-1",
                },
            });
        });
    });

    describe("POST /api/channels", () => {
        it("returns 403 when the CSRF token is invalid", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(false);
            const res = await post("/api/channels", { name: "kara-signup" });
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "csrf", message: expect.any(String) } });
            expect(discord.createChannel).not.toHaveBeenCalled();
        });

        it("returns 400 when no guild is active", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("");
            const res = await post("/api/channels", { name: "kara-signup" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "no_guild", message: expect.any(String) } });
        });

        it("creates the channel and returns it on success", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            discord.createChannel.mockResolvedValue({ id: "c9", name: "kara-signup" });

            const res = await post("/api/channels", { name: " kara-signup ", type: "voice", parentId: "cat1" });

            expect(discord.createChannel).toHaveBeenCalledWith("guild-1", { name: "kara-signup", type: "voice", parentId: "cat1" });
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(body(res)).toEqual({ data: { id: "c9", name: "kara-signup" } });
        });

        it("returns 400 with the Discord error message on failure", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            discord.createChannel.mockRejectedValue(new Error("Kanalname fehlt."));

            const res = await post("/api/channels", {});

            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "create_failed", message: "Kanalname fehlt." } });
        });
    });

    describe("POST /api/channels/duplicate", () => {
        it("returns 400 when no channel id is given", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/channels/duplicate", { name: "clone" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "no_channel", message: expect.any(String) } });
            expect(discord.duplicateChannel).not.toHaveBeenCalled();
        });

        it("duplicates the channel and returns it on success", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            discord.duplicateChannel.mockResolvedValue({ id: "c10", name: "kara-signup-2" });

            const res = await post("/api/channels/duplicate", { channelId: "c1", name: "kara-signup-2" });

            expect(discord.duplicateChannel).toHaveBeenCalledWith("c1", "kara-signup-2");
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(body(res)).toEqual({ data: { id: "c10", name: "kara-signup-2" } });
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

            expect(body(res)).toEqual({
                data: {
                    config: { adminRoleIds: ["r1"] },
                    raidsheets: [{ id: "s1", name: "Tier 4/5" }],
                    roles: [{ id: "role1", name: "Raider" }],
                    categories: [{ id: "cat1", name: "Raids" }],
                    activeGuildId: "guild-1",
                },
            });
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

        it("omits blizzard entirely when not present in the body, keeping the stored secret", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);

            await patch("/api/settings", { officerRoleId: "off1" });

            expect(settingsStore.saveConfig).toHaveBeenCalledWith({ officerRoleId: "off1" });
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
            expect(body(res)).toEqual({ data: { id: "s1", name: "Tier 4/5" } });
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
            expect(body(res)).toEqual({ data: { id: "s1" } });
        });
    });

    describe("GET /api/raider-characters", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await get("/api/raider-characters", { category: "cat1" });
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });

        it("returns 400 when no category is given", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            const res = await get("/api/raider-characters", {});
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("returns the category's expected members, their assignments and known characters", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["role1"] } });
            discord.listMembersWithRoles.mockResolvedValue({
                members: [{ id: "u1", displayName: "Sedroc" }],
                error: null,
            });
            raiderCharactersStore.getCategoryAssignments.mockReturnValue({ u1: "Elesham" });
            characterStore.listCharacters.mockReturnValue([{ character: "Elesham" }, { character: "Mage" }]);

            const res = await get("/api/raider-characters", { category: "cat1" });

            expect(discord.listMembersWithRoles).toHaveBeenCalledWith("guild-1", ["role1"]);
            expect(body(res)).toEqual({
                data: {
                    members: [{ id: "u1", displayName: "Sedroc" }],
                    membersError: null,
                    roleIds: ["role1"],
                    assignments: { u1: "Elesham" },
                    knownCharacters: ["Elesham", "Mage"],
                },
            });
        });

        it("skips the member lookup when the category has no roles assigned yet", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            settingsStore.getConfig.mockReturnValue({ categoryRoles: {} });
            const res = await get("/api/raider-characters", { category: "cat1" });
            expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
            expect(body(res).data.members).toEqual([]);
        });
    });

    describe("POST /api/raider-characters", () => {
        it("returns 403 when the CSRF token is invalid", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(false);
            const res = await post("/api/raider-characters", { categoryId: "cat1", assignments: {} });
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(raiderCharactersStore.setCategoryAssignments).not.toHaveBeenCalled();
        });

        it("returns 400 when categoryId is missing", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/raider-characters", { assignments: { u1: "Elesham" } });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("returns 400 when assignments is missing/not an object", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/raider-characters", { categoryId: "cat1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("saves the whole category map and returns it", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            raiderCharactersStore.setCategoryAssignments.mockReturnValue({ u1: "Elesham" });

            const res = await post("/api/raider-characters", { categoryId: "cat1", assignments: { u1: "Elesham", u2: "" } });

            expect(raiderCharactersStore.setCategoryAssignments).toHaveBeenCalledWith("cat1", { u1: "Elesham", u2: "" });
            expect(body(res)).toEqual({ data: { assignments: { u1: "Elesham" } } });
        });
    });

    describe("GET /api/raids", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            await handle("/api/raids", { method: "GET" }, res);
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(raidEventGroups.loadEventGroups).not.toHaveBeenCalled();
        });

        it("returns the active guild's upcoming events grouped by category", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [{ id: "e1", title: "Kara" }] }],
                error: null,
            });

            const res = mockRes();
            await handle("/api/raids", { method: "GET" }, res);

            expect(raidEventGroups.loadEventGroups).toHaveBeenCalledWith("guild-1");
            expect(body(res)).toEqual({
                data: {
                    groups: [{ categoryId: "cat1", categoryName: "Raids", events: [{ id: "e1", title: "Kara" }] }],
                    error: null,
                    activeGuildId: "guild-1",
                },
            });
        });

        it("passes the Raid-Helper API error through instead of failing the request", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: "Raid-Helper nicht erreichbar." });

            const res = mockRes();
            await handle("/api/raids", { method: "GET" }, res);

            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(body(res)).toEqual({
                data: { groups: [], error: "Raid-Helper nicht erreichbar.", activeGuildId: "guild-1" },
            });
        });
    });

    describe("GET /api/raids/new", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            await handle("/api/raids/new", { method: "GET" }, res);
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });

        it("assembles defaults, leaderId, channels, templates and reusable events", async () => {
            auth.getUser.mockReturnValue({ id: "42", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            settingsStore.getConfig.mockReturnValue({ raidDefaults: { templateId: "t1", channelId: "c1" } });
            settingsStore.listRaidTemplates.mockReturnValue([{ id: "t1", name: "GDKP Kara" }]);
            discord.listTextChannels.mockReturnValue([{ id: "c1", name: "kara", category: "Raids" }]);
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [
                    { id: "e1", title: "Kara", templateId: "t1", description: "desc", channelId: "c1", channelName: "kara" },
                ] }],
                error: null,
            });

            const res = mockRes();
            await handle("/api/raids/new", { method: "GET" }, res);

            expect(body(res)).toEqual({
                data: {
                    defaults: { templateId: "t1", channelId: "c1" },
                    leaderId: "42",
                    channels: [{ id: "c1", name: "kara", category: "Raids" }],
                    templates: [{ id: "t1", name: "GDKP Kara" }],
                    reusableEvents: [{ id: "e1", title: "Kara", templateId: "t1", description: "desc", channelId: "c1", channelName: "kara" }],
                },
            });
        });
    });

    describe("POST /api/raids", () => {
        it("returns 400 for an invalid date", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/raids", { date: "not-a-date", channelId: "c1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "invalid_date", message: expect.any(String) } });
            expect(mockCreateEvent).not.toHaveBeenCalled();
        });

        it("creates the event directly on the given channel", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            mockCreateEvent.mockResolvedValue({ id: "ev1" });

            const res = await post("/api/raids", {
                date: "2026-07-12", time: "20:00", title: "GDKP Kara", templateId: "t1", channelId: "c1", leaderId: "42",
            });

            expect(mockCreateEvent).toHaveBeenCalledWith({
                channelId: "c1", leaderId: "42", templateId: "t1", date: "12-07-2026", time: "20:00", title: "GDKP Kara", description: "",
            });
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(body(res)).toEqual({ data: { id: "ev1" } });
        });

        it("clones the source event's channel when sourceEventId is given", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [{ id: "e1", channelId: "c-old" }] }],
                error: null,
            });
            discord.duplicateChannel.mockResolvedValue({ id: "c-new", name: "kara-clone" });
            mockCreateEvent.mockResolvedValue({ id: "ev2" });

            const res = await post("/api/raids", {
                date: "2026-07-12", time: "20:00", title: "Kara", sourceEventId: "e1", channelName: "kara-clone",
            });

            expect(discord.duplicateChannel).toHaveBeenCalledWith("c-old", "kara-clone");
            expect(mockCreateEvent).toHaveBeenCalledWith(expect.objectContaining({ channelId: "c-new" }));
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
        });

        it("returns 400 with Raid-Helper's reason when it rejects the event", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            mockCreateEvent.mockResolvedValue({ status: "failed", reason: "invalid token" });

            const res = await post("/api/raids", { date: "2026-07-12", time: "20:00", channelId: "c1" });

            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "create_failed", message: "invalid token" } });
        });
    });

    describe("GET /api/raids/detail", () => {
        // One event ("e1") in category "cat1", with a signup from user "1" only —
        // user "2" is expected (holds the raider role) but hasn't reacted yet.
        const event1 = {
            id: "e1",
            title: "GDKP Kara",
            startTime: 1753500000,
            channelId: "chan1",
            channelName: "kara-channel",
            categoryId: "cat1",
            signupCount: 1,
            signUps: [{ userId: "1", specName: "ProtPala" }],
        };
        const groupsFull = [{ categoryId: "cat1", categoryName: "Raids", events: [event1] }];

        function setupDefaults() {
            auth.getUser.mockReturnValue({ id: "42", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: groupsFull, error: null });
            settingsStore.listRaidsheets.mockReturnValue([]);
            raidsheetsUtil.matchRaidsheet.mockReturnValue(null);
            mockGetSetup.mockResolvedValue({ setup: [] });
            settingsStore.getConfig.mockReturnValue({});
            discord.listMembersWithRoles.mockResolvedValue({ members: [], error: null });
            discord.listRoles.mockReturnValue([]);
            settingsStore.listNotify.mockReturnValue([]);
            eventSheetStore.getEventSheet.mockReturnValue(null);
            eventSoftresStore.getEventSoftres.mockReturnValue(null);
            softres.parseInstancesFromTitle.mockReturnValue([]);
            softres.targetSizeForInstances.mockReturnValue(0);
            softres.catalogue.mockReturnValue([]);
            lootStore.listByEvent.mockReturnValue([]);
        }

        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await get("/api/raids/detail", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(raidEventGroups.loadEventGroups).not.toHaveBeenCalled();
        });

        it("returns the full read-only overview: setup, attendance, sheet/softres links and loot", async () => {
            setupDefaults();
            settingsStore.listRaidsheets.mockReturnValue([{ id: "sheet1", name: "Kara Sheet", keywords: ["kara"] }]);
            raidsheetsUtil.matchRaidsheet.mockReturnValue({ id: "sheet1", name: "Kara Sheet", keywords: ["kara"] });
            mockGetSetup.mockResolvedValue({ setup: [{ name: "Tankulus", specName: "ProtPala", group: 1 }] });
            settingsStore.getConfig.mockReturnValue({
                categoryRoles: { cat1: ["role1"] },
                categoryLootTool: { cat1: "gargul" },
            });
            discord.listMembersWithRoles.mockResolvedValue({
                members: [{ id: "1", displayName: "Anna" }, { id: "2", displayName: "Bob" }],
                error: null,
            });
            discord.listRoles.mockReturnValue([{ id: "role1", name: "Raider" }]);
            settingsStore.listNotify.mockReturnValue([{ id: "tpl1", name: "Standard-Aufruf" }]);
            eventSheetStore.getEventSheet.mockReturnValue({ eventId: "e1", url: "https://sheet.example/1", sheetName: "Kara" });
            eventSoftresStore.getEventSoftres.mockReturnValue({ eventId: "e1", url: "https://softres.it/1", instances: ["kara"] });
            softres.parseInstancesFromTitle.mockReturnValue([{ code: "kara", name: "Karazhan", edition: "tbc", slots: 10 }]);
            softres.targetSizeForInstances.mockReturnValue(10);
            softres.catalogue.mockReturnValue([
                { edition: "tbc", label: "The Burning Crusade", instances: [{ code: "kara", name: "Karazhan", slots: 10 }] },
                { edition: "classic", label: "Classic", instances: [] },
            ]);
            lootStore.listByEvent.mockReturnValue([{ eventId: "e1", itemName: "Sword", character: "Anna" }]);

            const res = await get("/api/raids/detail", { event: "e1" });

            expect(raidEventGroups.loadEventGroups).toHaveBeenCalledWith("guild-1", { sinceSeconds: 0 });
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            const data = body(res).data;
            expect(data.event).toEqual({
                id: "e1", title: "GDKP Kara", startTime: 1753500000,
                channelId: "chan1", channelName: "kara-channel", signupCount: 1,
                isPast: true, signupsKnown: true, signUpsFromSnapshot: false,
            });
            expect(data.categoryName).toBe("Raids");
            expect(data.guildId).toBe("guild-1");
            expect(data.notifyTemplates).toEqual([{ id: "tpl1", name: "Standard-Aufruf" }]);
            expect(data.roles).toEqual([{ id: "role1", name: "Raider" }]);
            expect(data.raidsheets).toEqual([{ id: "sheet1", name: "Kara Sheet", keywords: ["kara"] }]);
            expect(data.matchedSheetId).toBe("sheet1");
            expect(data.setup).toEqual({
                total: 1,
                groups: [{
                    group: 1,
                    label: "Gruppe 1",
                    players: [{
                        name: "Tankulus",
                        spec: "ProtPala",
                        specName: "Protection Pala",
                        className: "Paladin",
                        classColor: "#F58CBA",
                        iconUrl: "https://wow.zamimg.com/images/wow/icons/large/spell_holy_devotionaura.jpg",
                        role: "tank",
                        group: 1,
                    }],
                }],
                roleCounts: { tank: 1 },
            });
            expect(data.setupError).toBeNull();
            expect(data.tankCandidates).toEqual([{ name: "Tankulus", specName: "Protection Pala", className: "Paladin" }]);
            expect(data.eventSheet).toEqual({ eventId: "e1", url: "https://sheet.example/1", sheetName: "Kara" });
            expect(data.eventSoftres).toEqual({ eventId: "e1", url: "https://softres.it/1", instances: ["kara"] });
            expect(data.softresCatalogue).toEqual([
                { edition: "tbc", label: "The Burning Crusade", instances: [{ code: "kara", name: "Karazhan", slots: 10 }] },
            ]);
            expect(data.softresEdition).toBe("tbc");
            expect(data.softresSuggested).toEqual(["kara"]);
            expect(data.attendance).toEqual({
                responded: [{
                    id: "1",
                    displayName: "Anna",
                    profile: {
                        specName: "Protection Pala",
                        className: "Paladin",
                        classColor: "#F58CBA",
                        iconUrl: "https://wow.zamimg.com/images/wow/icons/large/spell_holy_devotionaura.jpg",
                    },
                }],
                missing: [{ id: "2", displayName: "Bob" }],
            });
            expect(data.attendanceRoleIds).toEqual(["role1"]);
            expect(data.membersError).toBeNull();
            expect(data.signupTarget).toBe(10);
            expect(data.lootItems).toEqual([{ eventId: "e1", itemName: "Sword", character: "Anna" }]);
            expect(data.lootTool).toBe("gargul");
        });

        it("returns the logs already assigned to this event and the guild's still-unassigned ones", async () => {
            setupDefaults();
            logStore.listLogsForEvent.mockReturnValue([{ id: "l1", eventId: "e1", title: "Kara" }]);
            logStore.listLogs.mockReturnValue([
                { id: "l1", eventId: "e1", guildId: "guild-1" },
                { id: "l2", guildId: "guild-1" },
                { id: "l3", guildId: "other-guild" },
            ]);
            const res = await get("/api/raids/detail", { event: "e1" });
            expect(logStore.listLogsForEvent).toHaveBeenCalledWith("e1");
            const data = body(res).data;
            expect(data.eventLogs).toEqual([{ id: "l1", eventId: "e1", title: "Kara" }]);
            expect(data.unlinkedLogs.map((l) => l.id)).toEqual(["l2"]);
        });

        it("returns 404 when the event isn't found in any group", async () => {
            setupDefaults();
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: null });
            const res = await get("/api/raids/detail", { event: "missing" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "not_found", message: "Event nicht gefunden." } });
        });

        it("returns 400 when Raid-Helper events can't be loaded and no fallback event was found either", async () => {
            setupDefaults();
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: "Raid-Helper nicht erreichbar.", stale: true });
            const res = await get("/api/raids/detail", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "events_unavailable", message: "Raid-Helper nicht erreichbar." } });
        });

        it("still opens the page with an eventsWarning when the event was found via the stale/persisted fallback", async () => {
            setupDefaults();
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: groupsFull, error: "Raid-Helper nicht erreichbar.", stale: true,
            });
            const res = await get("/api/raids/detail", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(body(res).data.eventsWarning).toBe("Raid-Helper nicht erreichbar.");
        });

        it("omits eventsWarning when the data is fresh (not stale)", async () => {
            setupDefaults();
            const res = await get("/api/raids/detail", { event: "e1" });
            expect(body(res).data.eventsWarning).toBeNull();
        });

        it("sets setupError when the Raid-Helper raidplan can't be loaded", async () => {
            setupDefaults();
            mockGetSetup.mockRejectedValue(new Error("raidplan down"));
            const res = await get("/api/raids/detail", { event: "e1" });
            const data = body(res).data;
            expect(data.setup).toBeNull();
            expect(data.setupError).toBe("raidplan down");
            expect(data.tankCandidates).toEqual([]);
        });

        it("returns an empty setup when no raidplan has been created yet", async () => {
            setupDefaults();
            mockGetSetup.mockResolvedValue({ setup: [] });
            const res = await get("/api/raids/detail", { event: "e1" });
            const data = body(res).data;
            expect(data.setup).toEqual({ total: 0, groups: [], roleCounts: {} });
            expect(data.setupError).toBeNull();
        });

        it("leaves attendance inactive when the category has no raider roles configured", async () => {
            setupDefaults();
            settingsStore.getConfig.mockReturnValue({ categoryRoles: {} });
            const res = await get("/api/raids/detail", { event: "e1" });
            expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
            const data = body(res).data;
            expect(data.attendance).toEqual({ responded: [], missing: [] });
            expect(data.attendanceRoleIds).toEqual([]);
            expect(data.membersError).toBeNull();
            expect(data.signupTarget).toBe(0);
        });

        it("reports membersError when Discord members can't be fetched", async () => {
            setupDefaults();
            settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["role1"] } });
            discord.listMembersWithRoles.mockResolvedValue({
                members: [], error: "Mitglieder konnten nicht geladen werden (GuildMembers-Intent aktiv?).",
            });
            const res = await get("/api/raids/detail", { event: "e1" });
            const data = body(res).data;
            expect(data.membersError).toBe("Mitglieder konnten nicht geladen werden (GuildMembers-Intent aktiv?).");
            expect(data.attendance).toEqual({ responded: [], missing: [] });
            expect(data.attendanceRoleIds).toEqual(["role1"]);
        });

        it("returns null eventSheet/eventSoftres when neither has been created yet, falling back to attendance headcount", async () => {
            setupDefaults();
            settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["role1"] } });
            discord.listMembersWithRoles.mockResolvedValue({
                members: [{ id: "1", displayName: "Anna" }, { id: "2", displayName: "Bob" }],
                error: null,
            });
            const res = await get("/api/raids/detail", { event: "e1" });
            const data = body(res).data;
            expect(data.eventSheet).toBeNull();
            expect(data.eventSoftres).toBeNull();
            expect(data.signupTarget).toBe(2);
        });

        it("returns an empty lootItems array when nothing has been imported for the event", async () => {
            setupDefaults();
            lootStore.listByEvent.mockReturnValue([]);
            const res = await get("/api/raids/detail", { event: "e1" });
            expect(body(res).data.lootItems).toEqual([]);
            expect(body(res).data.lootTool).toBe("");
        });

        it("returns 404 when no event id is given", async () => {
            setupDefaults();
            const res = await get("/api/raids/detail");
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        });

        it("treats a raidplan response without a setup array as empty", async () => {
            setupDefaults();
            mockGetSetup.mockResolvedValue({});
            const res = await get("/api/raids/detail", { event: "e1" });
            const data = body(res).data;
            expect(data.setup).toEqual({ total: 0, groups: [], roleCounts: {} });
            expect(data.tankCandidates).toEqual([]);
            expect(data.setupFromSnapshot).toBe(false);
        });

        // Raid-Helper serves no raidplan for a finished raid any more; the
        // snapshot taken while it still did stands in, so the Setup tab of a past
        // raid keeps showing the comp it actually ran with.
        it("falls back to the stored raidplan snapshot when Raid-Helper returns none", async () => {
            setupDefaults();
            mockGetSetup.mockResolvedValue({ setup: [] });
            raidEventStore.getRaidEvent.mockReturnValue({
                id: "e1", setup: [{ name: "Sedroc", specName: "Protection Warrior", groupNumber: 1 }],
            });

            const res = await get("/api/raids/detail", { event: "e1" });
            const data = body(res).data;

            expect(data.setup.total).toBe(1);
            expect(data.setupFromSnapshot).toBe(true);
        });

        it("uses the snapshot raidplan when the raidplan request fails outright", async () => {
            setupDefaults();
            mockGetSetup.mockRejectedValue(new Error("Raid-Helper down"));
            raidEventStore.getRaidEvent.mockReturnValue({
                id: "e1", setup: [{ name: "Sedroc", specName: "Protection Warrior", groupNumber: 1 }],
            });

            const res = await get("/api/raids/detail", { event: "e1" });
            const data = body(res).data;

            expect(data.setupError).toBeNull();
            expect(data.setup.total).toBe(1);
            expect(data.setupFromSnapshot).toBe(true);
        });

        it("still reports a raidplan error when there is no snapshot to fall back to", async () => {
            setupDefaults();
            mockGetSetup.mockRejectedValue(new Error("Raid-Helper down"));
            raidEventStore.getRaidEvent.mockReturnValue(null);

            const res = await get("/api/raids/detail", { event: "e1" });

            expect(body(res).data.setupError).toBe("Raid-Helper down");
        });

        // A PAST raid without signups: Raid-Helper has dropped them, so the
        // roster is unknown. Reporting every expected raider as "missing" (which
        // is what used to happen) is wrong — the page must say "no data".
        it("reports an unknown roster for a past event that carries no signUps", async () => {
            setupDefaults();
            const eventNoSignups = { ...event1, signUps: undefined };
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [eventNoSignups] }],
                error: null,
            });
            settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["role1"] } });
            discord.listMembersWithRoles.mockResolvedValue({
                members: [{ id: "1", displayName: "Anna" }],
                error: null,
            });
            const res = await get("/api/raids/detail", { event: "e1" });
            const data = body(res).data;
            expect(data.event.signupsKnown).toBe(false);
            expect(data.event.isPast).toBe(true);
            expect(data.attendance).toEqual({ responded: [], missing: [] });
        });

        // An UPCOMING raid without signups is a real "nobody reacted yet".
        it("still reconciles attendance for an upcoming event without signUps", async () => {
            setupDefaults();
            const upcoming = { ...event1, signUps: undefined, startTime: Math.floor(Date.now() / 1000) + 86400 };
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [upcoming] }],
                error: null,
            });
            settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["role1"] } });
            discord.listMembersWithRoles.mockResolvedValue({
                members: [{ id: "1", displayName: "Anna" }],
                error: null,
            });
            const res = await get("/api/raids/detail", { event: "e1" });
            const data = body(res).data;
            expect(data.event.signupsKnown).toBe(true);
            expect(data.attendance).toEqual({ responded: [], missing: [{ id: "1", displayName: "Anna" }] });
        });

        it("guesses a missing raider's class only from this event's own category, not a more recent signup in another category", async () => {
            setupDefaults();
            settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["role1"] } });
            discord.listMembersWithRoles.mockResolvedValue({
                members: [{ id: "2", displayName: "Sedroc" }],
                error: null,
            });
            // "2" hasn't reacted to e1 yet, but signed up Fury Warrior in an older
            // event of the SAME category, and Destro Warlock in a NEWER event of a
            // DIFFERENT category — the guess must ignore the other category.
            const sameCategoryPastEvent = { id: "past1", startTime: 100, signUps: [{ userId: "2", specName: "Fury" }] };
            const otherCategoryEvent = { id: "other1", startTime: 200, signUps: [{ userId: "2", specName: "Destro" }] };
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [
                    { categoryId: "cat1", categoryName: "Raids", events: [event1, sameCategoryPastEvent] },
                    { categoryId: "cat2", categoryName: "Other Raids", events: [otherCategoryEvent] },
                ],
                error: null,
            });
            const res = await get("/api/raids/detail", { event: "e1" });
            const data = body(res).data;
            expect(data.attendance.missing).toEqual([{
                id: "2",
                displayName: "Sedroc",
                profile: expect.objectContaining({ className: "Warrior", specName: "Fury Warrior" }),
            }]);
        });

        it("shows a manually assigned character for a missing raider, overriding the guessed class", async () => {
            setupDefaults();
            settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["role1"] } });
            discord.listMembersWithRoles.mockResolvedValue({
                members: [{ id: "2", displayName: "Sedroc" }],
                error: null,
            });
            raiderCharactersStore.resolveAssignmentProfiles.mockReturnValue({
                2: { character: "Elesham", className: "Shaman", spec: "Elemental" },
            });
            const res = await get("/api/raids/detail", { event: "e1" });
            expect(raiderCharactersStore.resolveAssignmentProfiles).toHaveBeenCalledWith("cat1");
            const data = body(res).data;
            expect(data.attendance.missing).toEqual([{
                id: "2",
                displayName: "Sedroc",
                character: "Elesham",
                profile: { specName: "Elemental", className: "Shaman", classColor: "#0070DE", iconUrl: expect.any(String) },
            }]);
        });
    });

    describe("POST /api/raids/notify", () => {
        it("returns 400 when the template or channel is missing", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getNotify.mockReturnValue(null);
            const res = await post("/api/raids/notify", { event: "e1", templateId: "t1", channelId: "" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "missing_fields", message: "Vorlage oder Channel fehlt." } });
            expect(discord.postAnnouncement).not.toHaveBeenCalled();
        });

        it("posts the announcement and returns the German success message", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getNotify.mockReturnValue({ id: "t1", title: "Anmeldung", body: "Bitte anmelden" });
            discord.postAnnouncement.mockResolvedValue({ guildId: "g1", channelId: "c1", messageId: "m1" });

            const res = await post("/api/raids/notify", { event: "e1", templateId: "t1", channelId: "c1", roleIds: ["r1", "r2"] });

            expect(discord.postAnnouncement).toHaveBeenCalledWith("c1", { id: "t1", title: "Anmeldung", body: "Bitte anmelden" }, ["r1", "r2"]);
            expect(body(res)).toEqual({ data: { message: "Anmelde-Aufruf gepostet." } });
        });

        it("returns 500 with the Discord error message on failure", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getNotify.mockReturnValue({ id: "t1" });
            discord.postAnnouncement.mockRejectedValue(new Error("Channel nicht gefunden oder kein Textkanal."));

            const res = await post("/api/raids/notify", { event: "e1", templateId: "t1", channelId: "c1" });

            expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "post_failed", message: "Channel nicht gefunden oder kein Textkanal." } });
        });
    });

    describe("POST /api/raids/ping-missing", () => {
        const event1 = {
            id: "e1", title: "GDKP Kara", channelId: "chan1", categoryId: "cat1",
            signUps: [{ userId: "1" }],
        };
        const groupsFull = [{ categoryId: "cat1", categoryName: "Raids", events: [event1] }];

        function setupDefaults() {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: groupsFull, error: null });
            settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["role1"] } });
            discord.listMembersWithRoles.mockResolvedValue({
                members: [{ id: "1", displayName: "Anna" }, { id: "2", displayName: "Bob" }],
                error: null,
            });
        }

        it("returns 400 when Raid-Helper events can't be loaded", async () => {
            setupDefaults();
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: "Raid-Helper nicht erreichbar." });
            const res = await post("/api/raids/ping-missing", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "events_unavailable", message: "Raid-Helper nicht erreichbar." } });
        });

        it("returns 404 when the event isn't found", async () => {
            setupDefaults();
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: null });
            const res = await post("/api/raids/ping-missing", { event: "missing" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "not_found", message: "Event nicht gefunden." } });
        });

        it("returns 400 when the category has no roles assigned", async () => {
            setupDefaults();
            settingsStore.getConfig.mockReturnValue({ categoryRoles: {} });
            const res = await post("/api/raids/ping-missing", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({
                error: { code: "no_roles", message: "Dieser Kategorie sind keine Rollen zugeordnet (Einstellungen → Events)." },
            });
            expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
        });

        it("returns 400 when Discord members can't be fetched", async () => {
            setupDefaults();
            discord.listMembersWithRoles.mockResolvedValue({ members: [], error: "GuildMembers-Intent fehlt." });
            const res = await post("/api/raids/ping-missing", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "members_unavailable", message: "GuildMembers-Intent fehlt." } });
        });

        // Once a raid has started, "missing" raiders are not missing — and if
        // Raid-Helper already dropped the roster, EVERY expected raider would be
        // pinged. Refuse rather than fire a pointless mass ping.
        it("refuses to ping for a raid that already started", async () => {
            setupDefaults();
            const started = { ...event1, startTime: Math.floor(Date.now() / 1000) - 3600 };
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [started] }],
                error: null,
            });

            const res = await post("/api/raids/ping-missing", { event: "e1" });

            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res).error.code).toBe("event_past");
            expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
            expect(discord.postMissingPing).not.toHaveBeenCalled();
        });

        it("returns a success message without posting when nobody is missing", async () => {
            setupDefaults();
            discord.listMembersWithRoles.mockResolvedValue({
                members: [{ id: "1", displayName: "Anna" }],
                error: null,
            });
            const res = await post("/api/raids/ping-missing", { event: "e1" });
            expect(discord.postMissingPing).not.toHaveBeenCalled();
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(body(res)).toEqual({ data: { message: "Niemand fehlt — es haben schon alle reagiert." } });
        });

        it("pings the missing raiders and reports the count", async () => {
            setupDefaults();
            discord.postMissingPing.mockResolvedValue({ channelId: "chan1", messageId: "m1" });

            const res = await post("/api/raids/ping-missing", { event: "e1", text: "Bitte melden" });

            expect(discord.postMissingPing).toHaveBeenCalledWith("chan1", ["2"], "Bitte melden");
            expect(body(res)).toEqual({ data: { message: "1 fehlende Raider gepingt." } });
        });

        it("returns 500 with the Discord error message on post failure", async () => {
            setupDefaults();
            discord.postMissingPing.mockRejectedValue(new Error("Channel nicht gefunden."));
            const res = await post("/api/raids/ping-missing", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "post_failed", message: "Channel nicht gefunden." } });
        });
    });

    describe("POST /api/raids/fill", () => {
        function setupDefaults() {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getRaidsheet.mockReturnValue({
                id: "sheet1", name: "Kara Sheet", spreadsheetId: "src-id", sheetName: "Setup", gid: "123",
            });
            eventSheetStore.getEventSheet.mockReturnValue(null);
            mockGetSetup.mockResolvedValue({ setup: [{ name: "Tankulus", specName: "ProtPala", group: 1 }] });
            mockDriveCopyFile.mockResolvedValue({ id: "copy-id", url: "https://docs.google.com/spreadsheets/d/copy-id/edit" });
            mockFillSetupSheet.mockResolvedValue({ playerCount: 1 });
            eventSheetStore.markEventSheetFilled.mockReturnValue({});
        }

        it("returns 400 when the raidsheet isn't found", async () => {
            setupDefaults();
            settingsStore.getRaidsheet.mockReturnValue(null);
            const res = await post("/api/raids/fill", { event: "e1", sheetId: "missing" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "sheet_not_found", message: "Raidsheet nicht gefunden." } });
        });

        it("returns 400 when the raidsheet has no spreadsheetId", async () => {
            setupDefaults();
            settingsStore.getRaidsheet.mockReturnValue({ id: "sheet1", name: "Kara Sheet", spreadsheetId: "" });
            const res = await post("/api/raids/fill", { event: "e1", sheetId: "sheet1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({
                error: { code: "no_spreadsheet_id", message: "Raidsheet hat keine Spreadsheet-ID (in den Einstellungen ergänzen)." },
            });
        });

        it("returns 400 when the Raid-Helper setup is empty, and cleans up the orphan copy", async () => {
            setupDefaults();
            mockGetSetup.mockResolvedValue({ setup: [] });
            const res = await post("/api/raids/fill", { event: "e1", sheetId: "sheet1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "empty_setup", message: "Setup nicht gefunden oder leer." } });
            // The orphan cleanup targets the FRESH copy just made, not any previous one.
            expect(mockDriveDeleteFile).toHaveBeenCalledWith("copy-id");
            expect(eventSheetStore.markEventSheetFilled).not.toHaveBeenCalled();
        });

        it("still returns empty_setup (logging, not throwing) when the orphan-copy cleanup itself fails", async () => {
            setupDefaults();
            mockGetSetup.mockResolvedValue({ setup: [] });
            mockDriveDeleteFile.mockRejectedValueOnce(new Error("cleanup boom"));
            const res = await post("/api/raids/fill", { event: "e1", sheetId: "sheet1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "empty_setup", message: "Setup nicht gefunden oder leer." } });
        });

        it("copies+fills concurrently, records the fill, and deletes the OLD copy (not the new one) in the background", async () => {
            setupDefaults();
            eventSheetStore.getEventSheet.mockReturnValue({ eventId: "e1", spreadsheetId: "old-copy-id", url: "https://old" });
            let setupResolved = false;
            let copyResolved = false;
            mockGetSetup.mockImplementation(() => new Promise((resolve) => {
                setImmediate(() => { setupResolved = true; resolve({ setup: [{ name: "Tankulus", specName: "ProtPala", group: 1 }] }); });
            }));
            mockDriveCopyFile.mockImplementation(() => new Promise((resolve) => {
                setImmediate(() => { copyResolved = true; resolve({ id: "copy-id", url: "https://docs.google.com/spreadsheets/d/copy-id/edit" }); });
            }));

            const res = await post("/api/raids/fill", {
                event: "e1", sheetId: "sheet1", tank3: "Bob", eventTitle: "GDKP Kara", eventStartTime: 1753500000,
            });

            // Both promises had to resolve — proves they ran concurrently via Promise.all,
            // not one strictly after the other (a sequential check-then-copy would still
            // pass this, but the explicit copyFile-args assertion below rules that out too).
            expect(setupResolved).toBe(true);
            expect(copyResolved).toBe(true);
            expect(mockDriveCopyFile).toHaveBeenCalledWith("src-id", "GDKP Kara — 26.07.2025");
            expect(mockGetSetup).toHaveBeenCalledWith("e1");

            expect(eventSheetStore.markEventSheetFilled).toHaveBeenNthCalledWith(1, "e1", expect.objectContaining({
                spreadsheetId: "copy-id",
                url: "https://docs.google.com/spreadsheets/d/copy-id/edit",
                sourceSheetId: "src-id",
            }));
            // The previous copy (old-copy-id) is deleted, never the fresh copy-id.
            expect(mockDriveDeleteFile).toHaveBeenCalledWith("old-copy-id");
            expect(mockDriveDeleteFile).not.toHaveBeenCalledWith("copy-id");
            expect(mockDriveShareAnyoneWriter).toHaveBeenCalledWith("copy-id");
            expect(mockFillSetupSheet).toHaveBeenCalledWith(
                expect.any(Object),
                [{ name: "Tankulus", specName: "ProtPala", group: 1 }],
                { tab: "Setup", tank3: "Bob" },
            );
            expect(eventSheetStore.markEventSheetFilled).toHaveBeenNthCalledWith(2, "e1", {
                sheetId: "sheet1", sheetName: "Kara Sheet", playerCount: 1,
            });
            expect(body(res).data.message).toMatch(/^Neues Sheet erstellt & gefüllt: 1 Spieler\. Wird am \d{2}\.\d{2}\.\d{4} automatisch gelöscht\.$/);
            expect(body(res).data.playerCount).toBe(1);
        });

        it("does not try to delete the previous copy when there is none", async () => {
            setupDefaults();
            eventSheetStore.getEventSheet.mockReturnValue(null);
            await post("/api/raids/fill", { event: "e1", sheetId: "sheet1" });
            expect(mockDriveDeleteFile).not.toHaveBeenCalled();
        });

        it("still completes the fill (logging, not throwing) when deleting the previous copy fails", async () => {
            setupDefaults();
            eventSheetStore.getEventSheet.mockReturnValue({ eventId: "e1", spreadsheetId: "old-copy-id", url: "https://old" });
            mockDriveDeleteFile.mockRejectedValueOnce(new Error("delete boom"));
            const res = await post("/api/raids/fill", { event: "e1", sheetId: "sheet1" });
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(body(res).data.playerCount).toBe(1);
        });

        it("returns 500 with the error message on a generic failure", async () => {
            setupDefaults();
            mockDriveCopyFile.mockRejectedValue(new Error("Drive lieferte keine Datei-ID für die Kopie."));
            const res = await post("/api/raids/fill", { event: "e1", sheetId: "sheet1" });
            expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "fill_failed", message: "Drive lieferte keine Datei-ID für die Kopie." } });
        });
    });

    describe("POST /api/raids/post-sheet", () => {
        const event1 = { id: "e1", title: "GDKP Kara", channelId: "chan1" };

        function setupDefaults() {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            eventSheetStore.getEventSheet.mockReturnValue({ eventId: "e1", url: "https://sheet.example/1" });
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [event1] }], error: null,
            });
        }

        it("returns 400 when there is no filled sheet yet", async () => {
            setupDefaults();
            eventSheetStore.getEventSheet.mockReturnValue(null);
            const res = await post("/api/raids/post-sheet", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "no_sheet", message: "Für dieses Event gibt es noch kein gefülltes Sheet." } });
            expect(discord.postLink).not.toHaveBeenCalled();
        });

        it("returns 400 when Raid-Helper events can't be loaded", async () => {
            setupDefaults();
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: "Raid-Helper nicht erreichbar." });
            const res = await post("/api/raids/post-sheet", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "events_unavailable", message: "Raid-Helper nicht erreichbar." } });
        });

        it("returns 404 when the event isn't found", async () => {
            setupDefaults();
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: null });
            const res = await post("/api/raids/post-sheet", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "not_found", message: "Event nicht gefunden." } });
        });

        it("posts the sheet link and returns the success message", async () => {
            setupDefaults();
            discord.postLink.mockResolvedValue({ channelId: "chan1", messageId: "m1" });
            const res = await post("/api/raids/post-sheet", { event: "e1", message: "Bitte prüfen" });
            expect(discord.postLink).toHaveBeenCalledWith("chan1", {
                url: "https://sheet.example/1", title: "Raidsheet – GDKP Kara", message: "Bitte prüfen",
                label: "Raidsheet öffnen", emoji: "📄",
            });
            expect(discord.editLink).not.toHaveBeenCalled();
            expect(eventSheetStore.markEventSheetPosted).toHaveBeenCalledWith("e1", { channelId: "chan1", messageId: "m1", message: "Bitte prüfen" });
            expect(body(res)).toEqual({ data: { message: "Raidsheet in den Channel gepostet." } });
        });

        it("edits the already-posted message in place instead of posting a new one", async () => {
            setupDefaults();
            eventSheetStore.getEventSheet.mockReturnValue({
                eventId: "e1", url: "https://sheet.example/1", postedChannelId: "chan1", postedMessageId: "old-m1",
            });
            discord.editLink.mockResolvedValue({ channelId: "chan1", messageId: "old-m1" });
            const res = await post("/api/raids/post-sheet", { event: "e1", message: "Neuer Text" });
            expect(discord.editLink).toHaveBeenCalledWith("chan1", "old-m1", expect.objectContaining({ message: "Neuer Text" }));
            expect(discord.postLink).not.toHaveBeenCalled();
            expect(body(res)).toEqual({ data: { message: "Raidsheet-Nachricht aktualisiert." } });
        });

        it("falls back to posting fresh when editing the tracked message fails", async () => {
            setupDefaults();
            eventSheetStore.getEventSheet.mockReturnValue({
                eventId: "e1", url: "https://sheet.example/1", postedChannelId: "chan1", postedMessageId: "old-m1",
            });
            discord.editLink.mockRejectedValue(new Error("Unknown Message"));
            discord.postLink.mockResolvedValue({ channelId: "chan1", messageId: "m2" });
            const res = await post("/api/raids/post-sheet", { event: "e1", message: "Neuer Text" });
            expect(discord.postLink).toHaveBeenCalledWith("chan1", expect.objectContaining({ message: "Neuer Text" }));
            expect(body(res)).toEqual({ data: { message: "Raidsheet-Nachricht aktualisiert." } });
        });

        it("returns 500 with the Discord error message on post failure", async () => {
            setupDefaults();
            discord.postLink.mockRejectedValue(new Error("Channel nicht gefunden."));
            const res = await post("/api/raids/post-sheet", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "post_failed", message: "Channel nicht gefunden." } });
        });
    });

    describe("POST /api/raids/post-softres", () => {
        const event1 = { id: "e1", title: "GDKP Kara", channelId: "chan1" };

        function setupDefaults() {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            eventSoftresStore.getEventSoftres.mockReturnValue({ eventId: "e1", url: "https://softres.it/1" });
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [event1] }], error: null,
            });
        }

        it("returns 400 when there is no softres list yet", async () => {
            setupDefaults();
            eventSoftresStore.getEventSoftres.mockReturnValue(null);
            const res = await post("/api/raids/post-softres", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "no_softres", message: "Für dieses Event gibt es noch keine Softres-Liste." } });
            expect(discord.postLink).not.toHaveBeenCalled();
        });

        it("returns 400 when Raid-Helper events can't be loaded", async () => {
            setupDefaults();
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: "Raid-Helper nicht erreichbar." });
            const res = await post("/api/raids/post-softres", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "events_unavailable", message: "Raid-Helper nicht erreichbar." } });
        });

        it("returns 404 when the event isn't found", async () => {
            setupDefaults();
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: null });
            const res = await post("/api/raids/post-softres", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "not_found", message: "Event nicht gefunden." } });
        });

        it("posts the softres link and returns the success message", async () => {
            setupDefaults();
            discord.postLink.mockResolvedValue({ channelId: "chan1", messageId: "m1" });
            const res = await post("/api/raids/post-softres", { event: "e1", message: "Bitte prüfen" });
            expect(discord.postLink).toHaveBeenCalledWith("chan1", {
                url: "https://softres.it/1", title: "Softres – GDKP Kara", message: "Bitte prüfen",
                label: "Softres öffnen", emoji: "🎁",
            });
            expect(eventSoftresStore.markEventSoftresPosted).toHaveBeenCalledWith("e1", { channelId: "chan1", messageId: "m1", message: "Bitte prüfen" });
            expect(body(res)).toEqual({ data: { message: "Softres-Link in den Channel gepostet." } });
        });

        it("edits the already-posted softres message in place instead of posting a new one", async () => {
            setupDefaults();
            eventSoftresStore.getEventSoftres.mockReturnValue({
                eventId: "e1", url: "https://softres.it/1", postedChannelId: "chan1", postedMessageId: "old-m1",
            });
            discord.editLink.mockResolvedValue({ channelId: "chan1", messageId: "old-m1" });
            const res = await post("/api/raids/post-softres", { event: "e1", message: "Neuer Text" });
            expect(discord.editLink).toHaveBeenCalledWith("chan1", "old-m1", expect.objectContaining({ message: "Neuer Text" }));
            expect(discord.postLink).not.toHaveBeenCalled();
            expect(body(res)).toEqual({ data: { message: "Softres-Nachricht aktualisiert." } });
        });

        it("returns 500 with the Discord error message on post failure", async () => {
            setupDefaults();
            discord.postLink.mockRejectedValue(new Error("Channel nicht gefunden."));
            const res = await post("/api/raids/post-softres", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "post_failed", message: "Channel nicht gefunden." } });
        });
    });

    describe("GET /api/raids/softres/item-search", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await get("/api/raids/softres/item-search", { q: "thunder" });
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(wowhead.searchItems).not.toHaveBeenCalled();
        });

        it("proxies the search to wowhead.searchItems", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            wowhead.searchItems.mockResolvedValue([{ id: 123, name: "Thunderfury", icon: "thunderfury" }]);
            const res = await get("/api/raids/softres/item-search", { q: "thunder", edition: "classic" });
            expect(wowhead.searchItems).toHaveBeenCalledWith("thunder", { edition: "classic" });
            expect(body(res)).toEqual({ data: { items: [{ id: 123, name: "Thunderfury", icon: "thunderfury" }] } });
        });
    });

    describe("POST /api/raids/softres", () => {
        function setupDefaults() {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            softres.editionOf.mockImplementation((code) => (code === "kara" ? "tbc" : ""));
        }

        it("returns 400 when no instances are selected", async () => {
            setupDefaults();
            const res = await post("/api/raids/softres", { event: "e1", instanceCodes: [] });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "no_instances", message: "Mindestens eine Instanz wählen." } });
            expect(softres.createRaid).not.toHaveBeenCalled();
        });

        it("returns 400 when the chosen instances span multiple editions", async () => {
            setupDefaults();
            softres.editionOf.mockImplementation((code) => (code === "kara" ? "tbc" : "wotlk"));
            const res = await post("/api/raids/softres", { event: "e1", instanceCodes: ["kara", "naxx"] });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({
                error: { code: "mixed_edition", message: "Alle gewählten Instanzen müssen zur selben Erweiterung gehören." },
            });
        });

        it("creates the list, saves it and returns 201 with the success message", async () => {
            setupDefaults();
            softres.createRaid.mockResolvedValue({
                raidId: "r1", token: "tok1", url: "https://softres.it/raid/r1", editUrl: "https://softres.it/raid/r1/tok1",
            });
            eventSoftresStore.saveEventSoftres.mockReturnValue({ eventId: "e1" });

            const res = await post("/api/raids/softres", {
                event: "e1", instanceCodes: ["kara"], amount: 3, faction: "Horde",
                hardReserves: [{ id: 123, raider: "Anna" }], hideReserves: true,
            });

            expect(softres.createRaid).toHaveBeenCalledWith({
                instances: ["kara"], edition: "tbc", amount: 3, faction: "Horde",
                hardReserves: [{ id: 123, raider: "Anna" }], hideReserves: true,
            });
            expect(eventSoftresStore.saveEventSoftres).toHaveBeenCalledWith("e1", {
                raidId: "r1", token: "tok1", url: "https://softres.it/raid/r1", editUrl: "https://softres.it/raid/r1/tok1",
                edition: "tbc", instances: ["kara"], amount: 3, hardReserveCount: 1,
            });
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(body(res)).toEqual({ data: { message: "Softres-Liste erstellt." } });
        });

        it("defaults hardReserves to [] when it isn't an array, and returns 500 with the error message on failure", async () => {
            setupDefaults();
            softres.createRaid.mockRejectedValue(new Error("softres.it lehnte die Anfrage ab: unbekannter Fehler"));
            const res = await post("/api/raids/softres", { event: "e1", instanceCodes: ["kara"], faction: "Horde", hardReserves: "not-an-array" });
            expect(softres.createRaid).toHaveBeenCalledWith(expect.objectContaining({ hardReserves: [] }));
            expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "softres_failed", message: "softres.it lehnte die Anfrage ab: unbekannter Fehler" } });
        });
    });

    describe("POST /api/raids/softres/link", () => {
        it("returns 400 for a URL that isn't a softres.it raid link", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/raids/softres/link", { event: "e1", softresUrl: "https://example.com/foo" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({
                error: { code: "invalid_url", message: "Das muss ein softres.it-Raid-Link sein (https://softres.it/raid/...)." },
            });
            expect(eventSoftresStore.setEventSoftresLink).not.toHaveBeenCalled();
        });

        it("saves the link and returns the success message", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            eventSoftresStore.setEventSoftresLink.mockReturnValue({ eventId: "e1" });
            const res = await post("/api/raids/softres/link", {
                event: "e1", softresUrl: "https://softres.it/raid/abc123", softresEditUrl: "https://softres.it/raid/abc123/tok",
            });
            expect(eventSoftresStore.setEventSoftresLink).toHaveBeenCalledWith("e1", {
                url: "https://softres.it/raid/abc123", editUrl: "https://softres.it/raid/abc123/tok",
            });
            expect(body(res)).toEqual({ data: { message: "Softres-Link aktualisiert." } });
        });
    });

    describe("GET /api/notify-templates", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            await handle("/api/notify-templates", { method: "GET" }, res);
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });

        it("returns the stored templates", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            settingsStore.listNotify.mockReturnValue([{ id: "tpl1", name: "Standard-Aufruf" }]);
            const res = mockRes();
            await handle("/api/notify-templates", { method: "GET" }, res);
            expect(body(res)).toEqual({ data: { templates: [{ id: "tpl1", name: "Standard-Aufruf" }] } });
        });
    });

    describe("POST /api/notify-templates (save template)", () => {
        it("creates a new template", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.saveNotify.mockReturnValue({ id: "tpl1", name: "Standard-Aufruf", title: "Anmeldung", body: "Bitte anmelden" });

            const res = await post("/api/notify-templates", { name: "Standard-Aufruf", title: "Anmeldung", body: "Bitte anmelden" });

            expect(settingsStore.saveNotify).toHaveBeenCalledWith({ name: "Standard-Aufruf", title: "Anmeldung", body: "Bitte anmelden" });
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(body(res)).toEqual({ data: { template: { id: "tpl1", name: "Standard-Aufruf", title: "Anmeldung", body: "Bitte anmelden" } } });
        });

        it("updates an existing template by id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.saveNotify.mockReturnValue({ id: "tpl1", name: "Renamed", title: "Anmeldung", body: "Neuer Text" });

            const res = await post("/api/notify-templates", { id: "tpl1", name: "Renamed", title: "Anmeldung", body: "Neuer Text" });

            expect(settingsStore.saveNotify).toHaveBeenCalledWith({ id: "tpl1", name: "Renamed", title: "Anmeldung", body: "Neuer Text" });
            expect(body(res)).toEqual({ data: { template: { id: "tpl1", name: "Renamed", title: "Anmeldung", body: "Neuer Text" } } });
        });
    });

    describe("POST /api/notify-templates/delete", () => {
        it("returns 404 when nothing was removed", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.deleteNotify.mockReturnValue(false);
            const res = await post("/api/notify-templates/delete", { id: "tpl1" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        });

        it("deletes and returns the id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.deleteNotify.mockReturnValue(true);
            const res = await post("/api/notify-templates/delete", { id: "tpl1" });
            expect(body(res)).toEqual({ data: { id: "tpl1" } });
        });
    });

    describe("GET /api/raid-templates", () => {
        it("returns the stored templates", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            settingsStore.listRaidTemplates.mockReturnValue([{ id: "t1", name: "GDKP Kara" }]);
            const res = mockRes();
            await handle("/api/raid-templates", { method: "GET" }, res);
            expect(body(res)).toEqual({ data: { templates: [{ id: "t1", name: "GDKP Kara" }] } });
        });
    });

    describe("POST /api/raid-templates", () => {
        it("returns 400 when saveRaidTemplate rejects a blank id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.saveRaidTemplate.mockReturnValue(null);
            const res = await post("/api/raid-templates", { name: "GDKP Kara" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("saves and returns the template", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.saveRaidTemplate.mockReturnValue({ id: "t1", name: "GDKP Kara" });
            const res = await post("/api/raid-templates", { id: "t1", name: "GDKP Kara" });
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(body(res)).toEqual({ data: { id: "t1", name: "GDKP Kara" } });
        });
    });

    describe("POST /api/raid-templates/delete", () => {
        it("returns 404 when nothing was removed", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.deleteRaidTemplate.mockReturnValue(false);
            const res = await post("/api/raid-templates/delete", { id: "t1" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        });

        it("deletes and returns the id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.deleteRaidTemplate.mockReturnValue(true);
            const res = await post("/api/raid-templates/delete", { id: "t1" });
            expect(body(res)).toEqual({ data: { id: "t1" } });
        });
    });

    describe("POST /api/raid-templates/import", () => {
        it("returns 400 when Raid-Helper has no templates", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            mockGetTemplates.mockResolvedValue([]);
            const res = await post("/api/raid-templates/import", {});
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("imports and returns added/updated counts plus the refreshed list", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            mockGetTemplates.mockResolvedValue([{ id: "t1", name: "GDKP Kara" }]);
            settingsStore.saveRaidTemplates.mockReturnValue({ added: 1, updated: 0 });
            settingsStore.listRaidTemplates.mockReturnValue([{ id: "t1", name: "GDKP Kara" }]);

            const res = await post("/api/raid-templates/import", {});

            expect(settingsStore.saveRaidTemplates).toHaveBeenCalledWith([{ id: "t1", name: "GDKP Kara" }]);
            expect(body(res)).toEqual({ data: { added: 1, updated: 0, templates: [{ id: "t1", name: "GDKP Kara" }] } });
        });
    });

    describe("GET /api/recruitment", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
        });

        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await get("/api/recruitment");
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });

        it("does not fetch applications outside the applications tab", async () => {
            await get("/api/recruitment", { view: "posts" });
            expect(discord.listApplications).not.toHaveBeenCalled();
        });

        it("does not fetch applications while editing a template or post", async () => {
            await get("/api/recruitment", { view: "applications", edit: "t1" });
            expect(discord.listApplications).not.toHaveBeenCalled();
            await get("/api/recruitment", { view: "applications", editpost: "p1" });
            expect(discord.listApplications).not.toHaveBeenCalled();
        });

        it("fetches applications only on the applications tab and returns them", async () => {
            settingsStore.getConfig.mockReturnValue({ applicationChannelId: "chan1" });
            discord.listApplications.mockResolvedValue({ applications: [{ threadId: "a1" }], error: null });

            const res = await get("/api/recruitment", { view: "applications" });

            expect(discord.listApplications).toHaveBeenCalledWith("chan1");
            expect(body(res).data).toMatchObject({
                view: "applications",
                applications: [{ threadId: "a1" }],
                applicationsError: null,
                applicationChannelId: "chan1",
            });
        });

        it("resolves editing/editingPost from the id query params", async () => {
            settingsStore.getRecruitment.mockReturnValue({ id: "t1", name: "Tpl" });
            settingsStore.getRecruitmentPost.mockReturnValue({ id: "p1", content: "hi" });

            const res = await get("/api/recruitment", { edit: "t1", editpost: "p1" });

            expect(settingsStore.getRecruitment).toHaveBeenCalledWith("t1");
            expect(settingsStore.getRecruitmentPost).toHaveBeenCalledWith("p1");
            expect(body(res).data).toMatchObject({
                editing: { id: "t1", name: "Tpl" },
                editingPost: { id: "p1", content: "hi" },
            });
        });

        it("filters posts to the active guild", async () => {
            activeGuildFor.mockReturnValue("guild-1");
            settingsStore.listRecruitmentPosts.mockReturnValue([
                { id: "p1", guildId: "guild-1" },
                { id: "p2", guildId: "guild-2" },
            ]);

            const res = await get("/api/recruitment");

            expect(body(res).data.posts).toEqual([{ id: "p1", guildId: "guild-1" }]);
        });
    });

    describe("POST /api/recruitment (save template)", () => {
        it("saves and returns the template", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.saveRecruitment.mockReturnValue({ id: "t1", name: "Tpl", content: "hi" });

            const res = await post("/api/recruitment", { name: "Tpl", content: "hi" });

            expect(settingsStore.saveRecruitment).toHaveBeenCalledWith({ name: "Tpl", content: "hi" });
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(body(res)).toEqual({ data: { id: "t1", name: "Tpl", content: "hi" } });
        });
    });

    describe("POST /api/recruitment/delete", () => {
        it("returns 404 when nothing was removed", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.deleteRecruitment.mockReturnValue(false);
            const res = await post("/api/recruitment/delete", { id: "t1" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        });

        it("deletes and returns the id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.deleteRecruitment.mockReturnValue(true);
            const res = await post("/api/recruitment/delete", { id: "t1" });
            expect(body(res)).toEqual({ data: { id: "t1" } });
        });
    });

    describe("POST /api/recruitment/post", () => {
        it("returns 400 when the template or channel is missing", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getRecruitment.mockReturnValue(null);
            const res = await post("/api/recruitment/post", { templateId: "t1", channelId: "c1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(discord.postRecruitment).not.toHaveBeenCalled();
        });

        it("posts the template and tracks the message", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getRecruitment.mockReturnValue({ id: "t1", content: "hi", title: "", body: "", buttonLabel: "" });
            discord.postRecruitment.mockResolvedValue({ guildId: "g1", channelId: "c1", messageId: "m1" });
            settingsStore.saveRecruitmentPost.mockReturnValue({ id: "p1" });

            const res = await post("/api/recruitment/post", { templateId: "t1", channelId: "c1" });

            expect(discord.postRecruitment).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "t1" }));
            expect(settingsStore.saveRecruitmentPost).toHaveBeenCalledWith(expect.objectContaining({
                guildId: "g1", channelId: "c1", messageId: "m1", source: "web",
            }));
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
        });

        it("returns 400 with the Discord error message on failure", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getRecruitment.mockReturnValue({ id: "t1", content: "hi" });
            discord.postRecruitment.mockRejectedValue(new Error("channel not found"));

            const res = await post("/api/recruitment/post", { templateId: "t1", channelId: "c1" });

            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "post_failed", message: "channel not found" } });
        });
    });

    describe("POST /api/recruitment/post-update", () => {
        it("returns 404 when the post is not found", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getRecruitmentPost.mockReturnValue(null);
            const res = await post("/api/recruitment/post-update", { id: "p1", content: "new" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(discord.editRecruitment).not.toHaveBeenCalled();
        });

        it("edits the Discord message and updates the tracked post", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getRecruitmentPost.mockReturnValue({ id: "p1", channelId: "c1", messageId: "m1" });
            settingsStore.saveRecruitmentPost.mockReturnValue({ id: "p1", content: "new" });

            const res = await post("/api/recruitment/post-update", { id: "p1", content: "new", buttonLabel: "Bewerben" });

            expect(discord.editRecruitment).toHaveBeenCalledWith("c1", "m1", { content: "new", title: "", body: "", buttonLabel: "Bewerben" });
            expect(settingsStore.saveRecruitmentPost).toHaveBeenCalledWith({ id: "p1", content: "new", title: "", body: "", buttonLabel: "Bewerben" });
            expect(body(res)).toEqual({ data: { id: "p1", content: "new" } });
        });
    });

    describe("POST /api/recruitment/post-delete", () => {
        it("deletes and returns the id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.deleteRecruitmentPost.mockReturnValue(true);
            const res = await post("/api/recruitment/post-delete", { id: "p1" });
            expect(body(res)).toEqual({ data: { id: "p1" } });
        });
    });

    describe("POST /api/recruitment/scan", () => {
        it("returns 400 when no guild is active", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("");
            const res = await post("/api/recruitment/scan", {});
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("imports found posts and returns the count", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            discord.scanRecruitment.mockResolvedValue([{ channelId: "c1", messageId: "m1" }, { channelId: "c2", messageId: "m2" }]);

            const res = await post("/api/recruitment/scan", {});

            expect(settingsStore.saveRecruitmentPost).toHaveBeenCalledTimes(2);
            expect(settingsStore.saveRecruitmentPost).toHaveBeenCalledWith(expect.objectContaining({ channelId: "c1", source: "scan" }));
            expect(body(res)).toEqual({ data: { count: 2 } });
        });
    });

    describe("GET /api/history", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await get("/api/history");
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });

        it("assembles events, raids, loot, logs and category tool config", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [{ id: "e1", title: "Kara", startTime: 100, categoryId: "cat1" }] }],
                error: null,
            });
            dashboardData.annotateUpcomingExtras.mockReturnValue([{ id: "e1", title: "Kara", lootCount: 2 }]);
            dashboardData.loadRecentEvents.mockResolvedValue({ events: [{ id: "e0", title: "Old Kara" }], error: null });
            lootStore.eventsWithLoot.mockReturnValue([{ eventId: "e1", label: "Kara", count: 2 }]);
            logStore.listLogs.mockReturnValue([{ id: "l1", title: "Log 1" }]);
            discord.listCategories.mockReturnValue([{ id: "cat1", name: "Raids" }]);
            settingsStore.getConfig.mockReturnValue({ categoryLootTool: { cat1: "gargul" } });

            const res = await get("/api/history");

            expect(dashboardData.loadRecentEvents).toHaveBeenCalledWith("guild-1", Infinity);
            expect(body(res).data).toEqual({
                events: [{ id: "e1", title: "Kara", startTime: 100, categoryId: "cat1" }],
                upcomingRaids: { events: [{ id: "e1", title: "Kara", lootCount: 2 }], error: null },
                pastRaids: { events: [{ id: "e0", title: "Old Kara" }], error: null },
                lootEvents: [{ eventId: "e1", label: "Kara", count: 2 }],
                logs: [{ id: "l1", title: "Log 1", postedAt: 0 }],
                categories: [{ id: "cat1", name: "Raids" }],
                categoryLootTool: { cat1: "gargul" },
                activeGuildId: "guild-1",
                chars: [],
            });
        });

        it("computes each log's posted-date via logPostedAt (falls back through messageId/detectedAt)", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            logStore.listLogs.mockReturnValue([{ id: "l1", title: "Log 1", detectedAt: 555 }]);
            reportList.logPostedAt.mockReturnValueOnce(555);
            const res = await get("/api/history");
            expect(reportList.logPostedAt).toHaveBeenCalledWith({ id: "l1", title: "Log 1", detectedAt: 555 });
            expect(body(res).data.logs).toEqual([{ id: "l1", title: "Log 1", detectedAt: 555, postedAt: 555 }]);
        });

        it("annotates loot characters with their class color and spec icon", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            characterInfo.annotatedCharacters.mockReturnValue([
                { key: "anna@t", character: "Anna", realm: "t", count: 3, className: "Paladin", spec: "Holy", source: "wcl", reportId: "r1" },
                { key: "bob@t", character: "Bob", realm: "t", count: 1, className: "", spec: "", source: "", reportId: "" },
            ]);

            const res = await get("/api/history");

            expect(body(res).data.chars).toEqual([
                {
                    key: "anna@t", character: "Anna", realm: "t", count: 3, className: "Paladin", spec: "Holy", source: "wcl", reportId: "r1",
                    classColor: expect.any(String), iconUrl: expect.any(String),
                },
                {
                    key: "bob@t", character: "Bob", realm: "t", count: 1, className: "", spec: "", source: "", reportId: "",
                    classColor: "", iconUrl: "",
                },
            ]);
            expect(body(res).data.chars[0].classColor).not.toBe("");
            expect(body(res).data.chars[0].iconUrl).toMatch(/^https:\/\//);
        });
    });

    describe("POST /api/history/log-delete", () => {
        it("deletes the log and returns its id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/history/log-delete", { logId: "l1" });
            expect(logStore.deleteLog).toHaveBeenCalledWith("l1");
            expect(body(res)).toEqual({ data: { id: "l1" } });
        });
    });

    describe("POST /api/history/import", () => {
        it("returns 400 when the export text is empty", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/history/import", { data: "" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "no_data", message: expect.any(String) } });
        });

        it("returns 400 with the parser's message on a LootParseError", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootImport.parseLoot.mockImplementation(() => { throw new lootImport.LootParseError("Ungültiges Format."); });
            const res = await post("/api/history/import", { data: "garbage" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "parse_failed", message: "Ungültiges Format." } });
        });

        it("returns 400 when parsing succeeds but finds no items", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootImport.parseLoot.mockReturnValue([]);
            const res = await post("/api/history/import", { data: "text" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "empty", message: expect.any(String) } });
        });

        it("imports under a manual label when event is __manual__", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootImport.parseLoot.mockReturnValue([{ itemName: "Sword" }]);
            lootStore.addImport.mockReturnValue({ added: 1, skipped: 0 });

            const res = await post("/api/history/import", { data: "text", event: "__manual__", manualLabel: "SSC/TK — 12.07." });

            expect(lootStore.addImport).toHaveBeenCalledWith(
                "manual-ssc-tk-12-07",
                [{ itemName: "Sword" }],
                { categoryId: "", eventLabel: "SSC/TK — 12.07." },
            );
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(body(res)).toEqual({ data: { eventId: "manual-ssc-tk-12-07", eventLabel: "SSC/TK — 12.07.", added: 1, skipped: 0 } });
        });

        it("returns 400 for __manual__ without a label", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootImport.parseLoot.mockReturnValue([{ itemName: "Sword" }]);
            const res = await post("/api/history/import", { data: "text", event: "__manual__" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "no_label", message: expect.any(String) } });
        });

        it("returns 409 when the auto-matched date is ambiguous", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootImport.parseLoot.mockReturnValue([{ itemName: "Sword" }]);
            lootImport.detectImportDate.mockReturnValue(123456);
            lootEventMatch.bestDayMatch.mockReturnValue({ match: null, ambiguous: true });

            const res = await post("/api/history/import", { data: "text", event: "__auto__" });

            expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "ambiguous", message: expect.any(String) } });
        });

        it("auto-matches a known event and marks the category's loot tool", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootImport.parseLoot.mockReturnValue([{ itemName: "Sword" }]);
            lootImport.detectImportDate.mockReturnValue(123456);
            const matchedEvent = { id: "e1", title: "Kara" };
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", events: [matchedEvent] }],
                error: null,
            });
            lootEventMatch.bestDayMatch.mockReturnValue({ match: matchedEvent, ambiguous: false });
            lootStore.addImport.mockReturnValue({ added: 3, skipped: 1 });

            const res = await post("/api/history/import", { data: "text", event: "__auto__", tool: "gargul" });

            expect(lootStore.addImport).toHaveBeenCalledWith("e1", [{ itemName: "Sword" }], { categoryId: "cat1", eventLabel: "Kara" });
            expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categoryLootTool: { cat1: "gargul" } });
            expect(body(res)).toEqual({ data: { eventId: "e1", eventLabel: "Kara", added: 3, skipped: 1 } });
        });

        it("imports directly against a given event id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootImport.parseLoot.mockReturnValue([{ itemName: "Sword" }]);
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", events: [{ id: "e1", title: "Kara" }] }],
                error: null,
            });
            lootStore.addImport.mockReturnValue({ added: 1, skipped: 0 });

            const res = await post("/api/history/import", { data: "text", event: "e1" });

            expect(lootStore.addImport).toHaveBeenCalledWith("e1", [{ itemName: "Sword" }], { categoryId: "cat1", eventLabel: "Kara" });
            expect(body(res)).toEqual({ data: { eventId: "e1", eventLabel: "Kara", added: 1, skipped: 0 } });
        });
    });

    describe("POST /api/history/category-tool", () => {
        it("returns 400 when no category is given", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/history/category-tool", { tool: "gargul" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("saves the category's loot tool", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/history/category-tool", { categoryId: "cat1", tool: "rclc" });
            expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categoryLootTool: { cat1: "rclc" } });
            expect(body(res)).toEqual({ data: { categoryId: "cat1", tool: "rclc" } });
        });

        it("clears the tool for an invalid value", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            await post("/api/history/category-tool", { categoryId: "cat1", tool: "nonsense" });
            expect(settingsStore.saveConfig).toHaveBeenCalledWith({ categoryLootTool: { cat1: "" } });
        });
    });

    describe("POST /api/history/clear", () => {
        it("clears the event's loot and returns the removed count", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootStore.clearEvent.mockReturnValue(4);
            const res = await post("/api/history/clear", { event: "e1" });
            expect(lootStore.clearEvent).toHaveBeenCalledWith("e1");
            expect(body(res)).toEqual({ data: { removed: 4 } });
        });
    });

    describe("GET /api/history/event", () => {
        it("returns the loot items and label for an event", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            lootStore.listByEvent.mockReturnValue([{ eventLabel: "Kara", itemName: "Sword" }]);
            const res = await get("/api/history/event", { event: "e1" });
            expect(lootStore.listByEvent).toHaveBeenCalledWith("e1");
            expect(body(res)).toEqual({ data: { eventId: "e1", label: "Kara", items: [{ eventLabel: "Kara", itemName: "Sword" }] } });
        });
    });

    describe("POST /api/history/characters-resolve", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await post("/api/history/characters-resolve", {});
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(characterInfo.resolveMissing).not.toHaveBeenCalled();
        });

        it("returns 403 when the CSRF token is invalid", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(false);
            const res = await post("/api/history/characters-resolve", {});
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(characterInfo.resolveMissing).not.toHaveBeenCalled();
        });

        it("composes the German summary message from the resolve result (minimal case)", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            characterInfo.resolveMissing.mockResolvedValue({
                fromExport: 1, fromReports: 2, fromWcl: 0, checkedReports: 0, pendingReports: 0, missing: [], unlinked: [], error: "",
            });

            const res = await post("/api/history/characters-resolve", {});

            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(body(res).data).toEqual(expect.objectContaining({
                fromExport: 1, fromReports: 2, fromWcl: 0,
                message: "3 Charakter(e) ergänzt.",
            }));
        });

        it("composes every optional part when present (reports/pending/unlinked/missing)", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            characterInfo.resolveMissing.mockResolvedValue({
                fromExport: 1, fromReports: 1, fromWcl: 2,
                checkedReports: 3, pendingReports: 2,
                missing: ["Charlie"], unlinked: ["Dora", "Eve"], error: "",
            });

            const res = await post("/api/history/characters-resolve", {});

            expect(body(res).data.message).toBe(
                "4 Charakter(e) ergänzt, 3 Log(s) ausgewertet, 2 weitere(s) Log(s) offen — nochmal ausführen, "
                + "2 ohne zugeordnetes Log (Log im CLA-Menü dem Event zuordnen), 1 weiterhin ohne Klasse.",
            );
        });

        it("returns 502 with the WCL error when resolveMissing reports one", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            characterInfo.resolveMissing.mockResolvedValue({
                fromExport: 0, fromReports: 0, fromWcl: 0, checkedReports: 0, pendingReports: 0, missing: [], unlinked: [],
                error: "WCL-API-Key fehlt (WARCRAFTLOGS_API_KEY in .env) — Specs können nicht aus den Logs gelesen werden.",
            });

            const res = await post("/api/history/characters-resolve", {});

            expect(res.writeHead).toHaveBeenCalledWith(502, expect.any(Object));
            expect(body(res)).toEqual({
                error: {
                    code: "wcl_unavailable",
                    message: "WCL-API-Key fehlt (WARCRAFTLOGS_API_KEY in .env) — Specs können nicht aus den Logs gelesen werden.",
                },
            });
        });
    });

    describe("GET /api/history/char", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            mockIsConfigured.mockReturnValue(false);
            mockGetCharacterSummary.mockResolvedValue(null);
            mockGetEquipment.mockResolvedValue(null);
            mockResolve.mockReturnValue({ region: "eu", realm: "thunderstrike", namespace: "profile-classicann-eu" });
            mockLastError = null;
            lootStore.listByCharacter.mockReturnValue([]);
            settingsStore.getConfig.mockReturnValue({});
            characterStore.getCharacter.mockReturnValue(null);
        });

        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await get("/api/history/char", { name: "Anna" });
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });

        it("returns loot + links but no gear when Blizzard is not configured", async () => {
            lootStore.listByCharacter.mockReturnValue([{ character: "Anna", realm: "thunderstrike", itemName: "Sword" }]);

            const res = await get("/api/history/char", { name: "Anna" });

            expect(lootStore.listByCharacter).toHaveBeenCalledWith("Anna");
            expect(mockGetCharacterSummary).not.toHaveBeenCalled();
            expect(mockGetEquipment).not.toHaveBeenCalled();
            expect(body(res).data).toEqual({
                character: "Anna",
                realm: "thunderstrike",
                items: [{ character: "Anna", realm: "thunderstrike", itemName: "Sword" }],
                armoryUrl: expect.stringContaining(encodeURIComponent("Anna")),
                wclUrl: expect.stringContaining(encodeURIComponent("Anna")),
                gear: null,
                gearConfigured: false,
                gearError: "",
                charSummary: null,
                gearNamespace: "profile-classicann-eu",
                info: null,
            });
        });

        it("falls back to the configured realm slug when no loot item carries a realm", async () => {
            settingsStore.getConfig.mockReturnValue({ blizzard: { realmSlug: "thunderstrike" } });

            const res = await get("/api/history/char", { name: "Anna" });

            expect(body(res).data.realm).toBe("thunderstrike");
        });

        it("returns an empty character/realm/gear response when name is missing", async () => {
            const res = await get("/api/history/char", {});
            expect(body(res).data.character).toBe("");
            expect(mockGetCharacterSummary).not.toHaveBeenCalled();
        });

        it("returns the resolved gear + charSummary + info when Blizzard is configured and succeeds", async () => {
            mockIsConfigured.mockReturnValue(true);
            mockGetCharacterSummary.mockResolvedValue({ name: "Anna", level: 70, className: "Paladin" });
            mockGetEquipment.mockResolvedValue([{ slot: "Head", itemId: 123, name: "Helm" }]);
            characterStore.getCharacter.mockReturnValue({ character: "Anna", className: "Paladin" });

            const res = await get("/api/history/char", { name: "Anna" });

            expect(body(res).data.gear).toEqual([{ slot: "Head", itemId: 123, name: "Helm" }]);
            expect(body(res).data.charSummary).toEqual({ name: "Anna", level: 70, className: "Paladin" });
            expect(body(res).data.gearConfigured).toBe(true);
            expect(body(res).data.gearError).toBe("");
            expect(body(res).data.info).toEqual({
                character: "Anna",
                className: "Paladin",
                classColor: "#F58CBA",
                iconUrl: "https://wow.zamimg.com/images/wow/icons/large/classicon_paladin.jpg",
            });
        });

        it("builds the 404 gearError with name/namespace/realm when the profile is not found", async () => {
            mockIsConfigured.mockReturnValue(true);
            mockGetEquipment.mockResolvedValue(null);
            mockLastError = { status: 404 };
            settingsStore.getConfig.mockReturnValue({ blizzard: { realmSlug: "thunderstrike", region: "eu" } });

            const res = await get("/api/history/char", { name: "Anna" });

            expect(body(res).data.gearError).toBe(
                "Charakter „Anna\" nicht in der Blizzard-API gefunden (404, Namespace profile-classicann-eu). "
                + "Realm-Slug „thunderstrike\"/Schreibweise prüfen oder den Namespace in den Einstellungen ändern (z.B. profile-classicann-eu).",
            );
        });

        it("builds the 403 gearError", async () => {
            mockIsConfigured.mockReturnValue(true);
            mockGetEquipment.mockResolvedValue(null);
            mockLastError = { status: 403 };

            const res = await get("/api/history/char", { name: "Anna" });

            expect(body(res).data.gearError).toBe("Zugriff verweigert (403) — die Profile-API ist für diesen Realm evtl. nicht freigegeben.");
        });

        it("builds the 401 gearError", async () => {
            mockIsConfigured.mockReturnValue(true);
            mockGetEquipment.mockResolvedValue(null);
            mockLastError = { status: 401 };

            const res = await get("/api/history/char", { name: "Anna" });

            expect(body(res).data.gearError).toBe("Authentifizierung fehlgeschlagen (401) — Battle.net Client-ID/Secret prüfen.");
        });

        it("builds the generic-status gearError for any other HTTP status", async () => {
            mockIsConfigured.mockReturnValue(true);
            mockGetEquipment.mockResolvedValue(null);
            mockLastError = { status: 500 };

            const res = await get("/api/history/char", { name: "Anna" });

            expect(body(res).data.gearError).toBe("Blizzard-API-Fehler (500).");
        });

        it("builds the network-error gearError when there is no status", async () => {
            mockIsConfigured.mockReturnValue(true);
            mockGetEquipment.mockResolvedValue(null);
            mockLastError = { message: "ECONNRESET" };

            const res = await get("/api/history/char", { name: "Anna" });

            expect(body(res).data.gearError).toBe("Blizzard-API nicht erreichbar (ECONNRESET).");
        });

        it("falls back to a generic network-error message when lastError carries no message either", async () => {
            mockIsConfigured.mockReturnValue(true);
            mockGetEquipment.mockResolvedValue(null);
            mockLastError = {};

            const res = await get("/api/history/char", { name: "Anna" });

            expect(body(res).data.gearError).toBe("Blizzard-API nicht erreichbar (Netzwerkfehler).");
        });
    });

    describe("GET /api/cla", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("");
            logStore.listLogs.mockReturnValue([]);
            reportStore.listReports.mockReturnValue([]);
            settingsStore.getConfig.mockReturnValue({});
            discord.getChannelCategoryMap.mockReturnValue({});
            mockGetPastEvents.mockResolvedValue([]);
        });

        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await get("/api/cla");
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });

        it("defaults to the reports view: unfiltered report count, guild-filtered log count", async () => {
            activeGuildFor.mockReturnValue("guild-1");
            logStore.listLogs.mockReturnValue([
                { id: "l1", guildId: "guild-1", eventId: "e1" },
                { id: "l2", guildId: "guild-2" },
                { id: "l3", guildId: "" },
            ]);
            reportStore.listReports.mockReturnValue([{ id: "r1" }, { id: "r2" }, { id: "r3" }]);

            const res = await get("/api/cla");

            expect(body(res).data.view).toBe("reports");
            expect(body(res).data.reportPage).not.toBeNull();
            expect(body(res).data.logPage).toBeNull();
            expect(body(res).data.reportPage.items).toEqual([{ id: "r1" }, { id: "r2" }, { id: "r3" }]);
            // counts.reports is unfiltered (reports carry no guildId); counts.logs is
            // the guild-filtered count (l2 belongs to another guild and is excluded).
            expect(body(res).data.counts).toEqual({ reports: 3, logs: 2 });
            expect(body(res).data.unlinkedCount).toBe(1); // l1 is linked, l3 is not (l2 filtered out)
            expect(body(res).data.matchEventsError).toBeNull();
            expect(body(res).data.activeGuildId).toBe("guild-1");
        });

        it("passes sort/dir/page through to prepareReportList", async () => {
            await get("/api/cla", { sort: "title", dir: "asc", page: "2" });
            expect(reportList.prepareReportList).toHaveBeenCalledWith([], { sort: "title", dir: "asc", page: "2" });
        });

        it("only computes the active view (reports) — prepareLogList is not called", async () => {
            await get("/api/cla");
            expect(reportList.prepareLogList).not.toHaveBeenCalled();
        });

        it("logChannelsConfigured is false when no log channels are configured", async () => {
            settingsStore.getConfig.mockReturnValue({ logChannelIds: [] });
            const res = await get("/api/cla");
            expect(body(res).data.logChannelsConfigured).toBe(false);
        });

        it("logChannelsConfigured is true when at least one log channel is configured", async () => {
            settingsStore.getConfig.mockReturnValue({ logChannelIds: ["c1"] });
            const res = await get("/api/cla");
            expect(body(res).data.logChannelsConfigured).toBe(true);
        });

        describe("view=logs", () => {
            it("computes only the logs view — prepareReportList is not called — and annotates/matches", async () => {
                activeGuildFor.mockReturnValue("guild-1");
                logStore.listLogs.mockReturnValue([{ id: "l1", guildId: "guild-1", channelId: "c1" }]);
                discord.getChannelCategoryMap.mockReturnValue({ c1: { name: "log-chan", categoryId: "cat1", categoryName: "Raids" } });
                mockGetPastEvents.mockResolvedValue([{ id: "e1", title: "Kara", startTime: 100, channelId: "c1" }]);

                const res = await get("/api/cla", { view: "logs" });

                expect(body(res).data.view).toBe("logs");
                expect(body(res).data.reportPage).toBeNull();
                expect(body(res).data.logPage).not.toBeNull();
                expect(reportList.prepareReportList).not.toHaveBeenCalled();
                expect(logChannel.backfillLogTitles).toHaveBeenCalledWith(body(res).data.logPage.items);
                expect(reportList.annotateLogCategories).toHaveBeenCalledWith(
                    expect.any(Array),
                    { c1: { name: "log-chan", categoryId: "cat1", categoryName: "Raids" } },
                );
                expect(logEventMatch.annotateMatches).toHaveBeenCalledWith(
                    expect.any(Array),
                    [{ id: "e1", title: "Kara", startTime: 100, channelId: "c1", channelName: "log-chan", categoryId: "cat1", categoryName: "Raids" }],
                );
            });

            it("passes sort/dir/page through to prepareLogList", async () => {
                activeGuildFor.mockReturnValue("guild-1");
                await get("/api/cla", { view: "logs", sort: "status", dir: "asc", page: "3" });
                expect(reportList.prepareLogList).toHaveBeenCalledWith([], { sort: "status", dir: "asc", page: "3" });
            });

            it("surfaces the Raid-Helper error as matchEventsError", async () => {
                activeGuildFor.mockReturnValue("guild-1");
                mockGetPastEvents.mockRejectedValue(new Error("API down"));

                const res = await get("/api/cla", { view: "logs" });

                expect(body(res).data.matchEventsError).toBe("API down");
            });
        });
    });

    describe("POST /api/cla", () => {
        it("creates a report and returns its id/url", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            buildReport.mockResolvedValue({ id: "abc123", url: "/r/abc123", report: {} });

            const res = await post("/api/cla", { link: "https://classic.warcraftlogs.com/reports/abc123" });

            expect(buildReport).toHaveBeenCalledWith("https://classic.warcraftlogs.com/reports/abc123");
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(body(res)).toEqual({ data: { id: "abc123", url: "/r/abc123" } });
        });

        it("returns 400 with the ReportError message on an expected failure", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            buildReport.mockRejectedValue(new ReportError("Konnte keine Report-ID aus dem Link lesen."));

            const res = await post("/api/cla", { link: "not-a-link" });

            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "build_failed", message: "Konnte keine Report-ID aus dem Link lesen." } });
        });

        it("returns a generic 500 message on an unexpected failure", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            buildReport.mockRejectedValue(new Error("boom"));

            const res = await post("/api/cla", { link: "https://x" });

            expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "build_failed", message: "Unerwarteter Fehler beim Erstellen der Auswertung." } });
        });
    });

    describe("POST /api/cla/eval", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
        });

        it("returns the new report's id/url on success and defaults to the CLA half", async () => {
            logChannel.evaluateLog.mockResolvedValue({ ok: true, id: "abc", url: "/r/abc", section: "cla" });
            const res = await post("/api/cla/eval", { logId: "l1" });
            expect(logChannel.evaluateLog).toHaveBeenCalledWith("l1", "cla");
            expect(body(res)).toEqual({ data: { id: "abc", url: "/r/abc", section: "cla" } });
        });

        it("passes the requested section through", async () => {
            logChannel.evaluateLog.mockResolvedValue({ ok: true, id: "abc", url: "/r/abc", section: "rpb" });
            await post("/api/cla/eval", { logId: "l1", section: "rpb" });
            expect(logChannel.evaluateLog).toHaveBeenCalledWith("l1", "rpb");
        });

        it("falls back to the CLA half for an unknown section", async () => {
            logChannel.evaluateLog.mockResolvedValue({ ok: true, id: "abc", url: "/r/abc", section: "cla" });
            await post("/api/cla/eval", { logId: "l1", section: "nonsense" });
            expect(logChannel.evaluateLog).toHaveBeenCalledWith("l1", "cla");
        });

        it("returns alreadyEvaluated + url (200, not an error) when that half was already done", async () => {
            logChannel.evaluateLog.mockResolvedValue({ ok: false, already: true, url: "/r/xyz", error: "Die CLA-Auswertung liegt für diesen Log bereits vor." });
            const res = await post("/api/cla/eval", { logId: "l1" });
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(body(res)).toEqual({ data: { alreadyEvaluated: true, url: "/r/xyz", section: "cla" } });
        });

        it("returns 400 with the failure message otherwise", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            logChannel.evaluateLog.mockResolvedValue({ ok: false, error: "Auswertung läuft bereits — bitte einen Moment warten." });
            const res = await post("/api/cla/eval", { logId: "l1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "eval_failed", message: "Auswertung läuft bereits — bitte einen Moment warten." } });
        });

        it("falls back to a generic message when the failure carries none", async () => {
            logChannel.evaluateLog.mockResolvedValue({ ok: false });
            const res = await post("/api/cla/eval", { logId: "l1" });
            expect(body(res)).toEqual({ error: { code: "eval_failed", message: "Auswertung fehlgeschlagen." } });
        });
    });

    describe("POST /api/cla/scan", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
        });

        it("scans and returns the found count + message", async () => {
            activeGuildFor.mockReturnValue("guild-1");
            logChannel.scanLogChannels.mockResolvedValue(3);
            const res = await post("/api/cla/scan", {});
            expect(logChannel.scanLogChannels).toHaveBeenCalledWith("guild-1");
            expect(body(res)).toEqual({ data: { found: 3, message: "3 neue(r) Log(s) gefunden." } });
        });

        it("returns a 500 with the thrown message on failure", async () => {
            logChannel.scanLogChannels.mockRejectedValue(new Error("timeout"));
            const res = await post("/api/cla/scan", {});
            expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "scan_failed", message: "timeout" } });
        });
    });

    describe("POST /api/cla/log-delete", () => {
        it("deletes the log and returns its id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/cla/log-delete", { logId: "l1" });
            expect(logStore.deleteLog).toHaveBeenCalledWith("l1");
            expect(body(res)).toEqual({ data: { logId: "l1" } });
        });
    });

    describe("POST /api/cla/log-link", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("");
            discord.getChannelCategoryMap.mockReturnValue({});
            mockGetPastEvents.mockResolvedValue([]);
        });

        it("returns 400 when the log is not found", async () => {
            logStore.getLog.mockReturnValue(null);
            const res = await post("/api/cla/log-link", { logId: "l1", eventId: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "not_found", message: "Log nicht gefunden." } });
            expect(logStore.linkEvent).not.toHaveBeenCalled();
        });

        it("returns 400 when no event id is given", async () => {
            logStore.getLog.mockReturnValue({ id: "l1" });
            const res = await post("/api/cla/log-link", { logId: "l1", eventId: "" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "no_event", message: "Kein Event gewählt." } });
        });

        it("surfaces the Raid-Helper error when events cannot be loaded", async () => {
            logStore.getLog.mockReturnValue({ id: "l1" });
            activeGuildFor.mockReturnValue("guild-1");
            mockGetPastEvents.mockRejectedValue(new Error("API down"));
            const res = await post("/api/cla/log-link", { logId: "l1", eventId: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "events_unavailable", message: "API down" } });
        });

        it("returns 400 when the event id is not among the resolved events", async () => {
            logStore.getLog.mockReturnValue({ id: "l1" });
            activeGuildFor.mockReturnValue("guild-1");
            discord.getChannelCategoryMap.mockReturnValue({ c1: { name: "chan", categoryId: "cat1", categoryName: "Raids" } });
            mockGetPastEvents.mockResolvedValue([{ id: "e2", title: "Other", startTime: 100, channelId: "c1" }]);

            const res = await post("/api/cla/log-link", { logId: "l1", eventId: "e1" });

            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "event_not_found", message: "Event nicht gefunden." } });
        });

        it("links the log to the re-resolved event on success", async () => {
            logStore.getLog.mockReturnValue({ id: "l1" });
            activeGuildFor.mockReturnValue("guild-1");
            discord.getChannelCategoryMap.mockReturnValue({ c1: { name: "chan", categoryId: "cat1", categoryName: "Raids" } });
            mockGetPastEvents.mockResolvedValue([{ id: "e2", title: "Other", startTime: 100, channelId: "c1" }]);

            const res = await post("/api/cla/log-link", { logId: "l1", eventId: "e2" });

            expect(logStore.linkEvent).toHaveBeenCalledWith("l1", { eventId: "e2", eventLabel: "Other", eventStartTime: 100, source: "manual" });
            expect(body(res)).toEqual({
                data: { logId: "l1", eventId: "e2", eventLabel: "Other", message: "Log „Other\" zugeordnet." },
            });
        });
    });

    describe("POST /api/cla/log-link-url", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            discord.getChannelCategoryMap.mockReturnValue({ c1: { name: "chan", categoryId: "cat1", categoryName: "Raids" } });
            mockGetPastEvents.mockResolvedValue([{ id: "e2", title: "Other", startTime: 100, channelId: "c1" }]);
        });

        it("returns 400 when no event id is given", async () => {
            const res = await post("/api/cla/log-link-url", { link: "https://classic.warcraftlogs.com/reports/AAA", eventId: "" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "no_event", message: "Kein Event gewählt." } });
            expect(manualLog.linkLogByUrl).not.toHaveBeenCalled();
        });

        it("returns 400 when the event id is not among the resolved events", async () => {
            const res = await post("/api/cla/log-link-url", { link: "https://classic.warcraftlogs.com/reports/AAA", eventId: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "event_not_found", message: "Event nicht gefunden." } });
            expect(manualLog.linkLogByUrl).not.toHaveBeenCalled();
        });

        it("surfaces an invalid-link failure from the helper", async () => {
            manualLog.linkLogByUrl.mockReturnValue({ error: "Kein gültiger Warcraft-Logs-Link." });
            const res = await post("/api/cla/log-link-url", { link: "nope", eventId: "e2" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "invalid_link", message: "Kein gültiger Warcraft-Logs-Link." } });
        });

        it("registers + links the pasted URL and backfills the title", async () => {
            const log = { id: "l9", reportId: "AAA" };
            manualLog.linkLogByUrl.mockReturnValue({ log, created: true });

            const res = await post("/api/cla/log-link-url", { link: "https://classic.warcraftlogs.com/reports/AAA", eventId: "e2" });

            expect(manualLog.linkLogByUrl).toHaveBeenCalledWith(
                "https://classic.warcraftlogs.com/reports/AAA",
                expect.objectContaining({ id: "e2", title: "Other" }),
                "guild-1",
            );
            expect(logChannel.backfillLogTitles).toHaveBeenCalledWith([log]);
            expect(body(res)).toEqual({
                data: { logId: "l9", eventId: "e2", eventLabel: "Other", message: "WCL-Link „Other\" zugeordnet." },
            });
        });
    });

    describe("POST /api/cla/log-unlink", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
        });

        it("returns 400 when the log was not linked", async () => {
            logStore.unlinkEvent.mockReturnValue(null);
            const res = await post("/api/cla/log-unlink", { logId: "l1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "not_linked", message: "Keine Zuordnung vorhanden." } });
        });

        it("removes the assignment on success", async () => {
            logStore.unlinkEvent.mockReturnValue({ id: "l1" });
            const res = await post("/api/cla/log-unlink", { logId: "l1" });
            expect(logStore.unlinkEvent).toHaveBeenCalledWith("l1");
            expect(body(res)).toEqual({ data: { logId: "l1", message: "Zuordnung entfernt." } });
        });
    });

    describe("POST /api/cla/log-automatch", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            discord.getChannelCategoryMap.mockReturnValue({});
            mockGetPastEvents.mockResolvedValue([]);
            logStore.listLogs.mockReturnValue([]);
        });

        it("surfaces the Raid-Helper error when events cannot be loaded", async () => {
            mockGetPastEvents.mockRejectedValue(new Error("API down"));
            const res = await post("/api/cla/log-automatch", {});
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "events_unavailable", message: "API down" } });
            expect(logStore.linkEvent).not.toHaveBeenCalled();
        });

        it("links every unambiguous match and reports the remainder", async () => {
            logStore.listLogs.mockReturnValue([
                { id: "l1", guildId: "guild-1" },
                { id: "l2", guildId: "guild-1", eventId: "e5" }, // already linked — excluded
                { id: "l3", guildId: "guild-1" },
                { id: "l4", guildId: "other-guild" }, // different guild — excluded
            ]);
            discord.getChannelCategoryMap.mockReturnValue({ c1: { name: "chan", categoryId: "cat1", categoryName: "Raids" } });
            mockGetPastEvents.mockResolvedValue([{ id: "e9", title: "Match Event", startTime: 500, channelId: "c1" }]);
            const matchedEvent = { id: "e9", title: "Match Event", startTime: 500, channelId: "c1", channelName: "chan", categoryId: "cat1", categoryName: "Raids" };
            logEventMatch.autoMatches.mockReturnValue([{ log: { id: "l1" }, event: matchedEvent, diffMs: 1000 }]);

            const res = await post("/api/cla/log-automatch", {});

            expect(logEventMatch.autoMatches).toHaveBeenCalledWith(
                [{ id: "l1", guildId: "guild-1" }, { id: "l3", guildId: "guild-1" }],
                [matchedEvent],
            );
            expect(logStore.linkEvent).toHaveBeenCalledWith("l1", { eventId: "e9", eventLabel: "Match Event", eventStartTime: 500, source: "auto" });
            expect(body(res)).toEqual({
                data: { matched: 1, remaining: 1, message: "1 Log(s) automatisch zugeordnet, 1 ohne eindeutiges Event." },
            });
        });

        it("reports no remainder when every unlinked log gets matched", async () => {
            logStore.listLogs.mockReturnValue([{ id: "l1", guildId: "guild-1" }]);
            const matchedEvent = { id: "e9", title: "Match Event", startTime: 500 };
            logEventMatch.autoMatches.mockReturnValue([{ log: { id: "l1" }, event: matchedEvent, diffMs: 1000 }]);

            const res = await post("/api/cla/log-automatch", {});

            expect(body(res)).toEqual({
                data: { matched: 1, remaining: 0, message: "1 Log(s) automatisch zugeordnet." },
            });
        });

        it("uses the unfiltered log list when no guild is active", async () => {
            activeGuildFor.mockReturnValue("");
            logStore.listLogs.mockReturnValue([{ id: "l1", guildId: "some-guild" }]);

            await post("/api/cla/log-automatch", {});

            expect(logEventMatch.autoMatches).toHaveBeenCalledWith([{ id: "l1", guildId: "some-guild" }], []);
        });
    });

    it("responds 404 with a JSON error for an unknown /api/ route", async () => {
        const res = mockRes();
        const handled = await handle("/api/does-not-exist", { method: "GET" }, res);
        expect(handled).toBe(true);
        expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        expect(body(res)).toEqual({ error: { code: "not_found", message: expect.any(String) } });
    });
});
