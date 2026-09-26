const { json, routerClient } = require("../../helpers/http");

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
jest.mock("../../../src/web/dashboardData", () => ({
    loadNextRaids: jest.fn(() => Promise.resolve({ raids: [], error: null })),
    loadNextRaidDetails: jest.fn(() => Promise.resolve({ error: "Event nicht gefunden.", notFound: true })),
    loadLatestReport: jest.fn(() => null),
    loadRosterFigures: jest.fn(() => null),
    loadInbox: jest.fn(() => []),
    loadNewLoot: jest.fn(() => ({ count: 0, since: 0 })),
    loadRecentEvents: jest.fn(() => Promise.resolve({ events: [], error: null })),
    annotateUpcomingExtras: jest.fn((events) => events),
    loadTopLoot: jest.fn(() => ({ items: [], configured: 0 })),
    loadChannelArchive: jest.fn(() => null),
}));
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
jest.mock("../../../src/web/reportList", () => ({
    prepareReportList: jest.fn((reports, query) => ({
        items: reports, sort: (query && query.sort) || "date", dir: (query && query.dir) || "desc", page: 1, totalPages: 1, total: reports.length, pageSize: 15,
    })),
    prepareLogList: jest.fn((logs, query) => ({
        items: logs, sort: (query && query.sort) || "date", dir: (query && query.dir) || "desc", page: 1, totalPages: 1, total: logs.length, pageSize: 15,
    })),
    annotateLogCategories: jest.fn((items) => items),
    annotateReportEvents: jest.fn((reports) => reports),
    logPostedAt: jest.fn((l) => (l && l.postedAt) || 0),
    // the Log-Auswertung list is pure; the route tests run the real one
    prepareClaList: jest.fn((...args) => jest.requireActual("../../../src/web/reportList").prepareClaList(...args)),
    claRowFromLog: jest.fn((...args) => jest.requireActual("../../../src/web/reportList").claRowFromLog(...args)),
}));
jest.mock("../../../src/web/logEventMatch", () => ({
    annotateMatches: jest.fn((items) => items),
    autoMatches: jest.fn(() => []),
}));
jest.mock("../../../src/classes/warcraftlogs", () => jest.fn());
jest.mock("../../../src/stores/lootStore", () => ({
    addImport: jest.fn(() => ({ added: 0, skipped: 0 })),
    listByEvent: jest.fn(() => []),
    listByCharacter: jest.fn(() => []),
    listAll: jest.fn(() => []),
    eventsWithLoot: jest.fn(() => []),
    setEventCategory: jest.fn(() => 0),
    removeItems: jest.fn(() => 0),
    clearEvent: jest.fn(() => 0),
    repairItemNames: jest.fn(() => Promise.resolve(0)),
    decorate: jest.fn((it) => it),
}));
jest.mock("../../../src/web/lootAwards", () => ({
    listAwards: jest.fn(() => ({
        items: [], page: 1, pageSize: 25, total: 0, totalPages: 1,
        topItemCount: 0, contents: [], reasons: [], unknownContentCount: 0,
    })),
    PAGE_SIZE: 25,
}));
jest.mock("../../../src/web/characterInfo", () => ({
    rememberFromLoot: jest.fn(),
    annotatedCharacters: jest.fn(() => []),
    resolveMissing: jest.fn(() => Promise.resolve({
        fromExport: 0, fromReports: 0, fromWcl: 0, checkedReports: 0, pendingReports: 0, missing: [], unlinked: [], error: "",
    })),
}));
jest.mock("../../../src/stores/characterStore", () => ({
    getCharacter: jest.fn(() => null),
    listCharacters: jest.fn(() => []),
    characterMap: jest.fn(() => ({})),
}));
jest.mock("../../../src/stores/raiderCharactersStore", () => ({
    getCategoryAssignments: jest.fn(() => ({})),
    listAllAssignments: jest.fn(() => ({})),
    setCategoryAssignments: jest.fn(),
    resolveAssignmentProfiles: jest.fn(() => ({})),
}));
// The report-file scan behind the gear-issue column has its own test
// (charGearIssues.test.js) — here it is only an input to the roster join.
jest.mock("../../../src/web/charGearIssues", () => ({
    latestIssuesByCharacter: jest.fn(() => ({})),
    issuesForCharacter: jest.fn(() => null),
}));
const mockIsConfigured = jest.fn(() => false);
const mockGetCharacterSummary = jest.fn(() => Promise.resolve(null));
const mockGetEquipment = jest.fn(() => Promise.resolve(null));
const mockResolve = jest.fn(() => ({ region: "eu", realm: "thunderstrike", namespace: "profile-classicann-eu" }));
let mockLastError = null;
jest.mock("../../../src/classes/blizzard", () =>
    jest.fn().mockImplementation(() => ({
        isConfigured: mockIsConfigured,
        getCharacterSummary: mockGetCharacterSummary,
        getEquipment: mockGetEquipment,
        _resolve: mockResolve,
        get lastError() { return mockLastError; },
    })));
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
jest.mock("../../../src/web/lootEventMatch", () => ({
    bestDayMatch: jest.fn(() => ({ match: null, ambiguous: false })),
    formatDayDisplay: jest.fn(() => "12.07.2026"),
    dayKey: jest.fn(() => "2026-07-12"),
}));
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
jest.mock("../../../src/stores/eventSheetStore", () => ({
    getEventSheet: jest.fn(() => null),
    markEventSheetFilled: jest.fn(),
    markEventSheetPosted: jest.fn(),
}));
jest.mock("../../../src/stores/eventSoftresStore", () => ({
    getEventSoftres: jest.fn(() => null),
    saveEventSoftres: jest.fn(),
    setEventSoftresLink: jest.fn(),
    markEventSoftresPosted: jest.fn(),
}));
jest.mock("../../../src/stores/eventLootSystemStore", () => ({
    setEventLootSystem: jest.fn(),
    lootSystemOf: jest.fn(() => ({
        system: "softres", label: "Softres", source: "default", categorySystem: "softres", categoryLabel: "Softres", softresExtra: false, softres: true,
    })),
}));
jest.mock("../../../src/utils/loot/softres", () => ({
    parseInstancesFromTitle: jest.fn(() => []),
    targetSizeForInstances: jest.fn(() => 0),
    catalogue: jest.fn(() => []),
    editionOf: jest.fn(() => ""),
    codesForRulesetInstances: jest.fn((ids) => jest.requireActual("../../../src/utils/loot/softres").codesForRulesetInstances(ids, "tbc")),
    createRaid: jest.fn(),
}));
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
const mockRaidHelperSlots = jest.fn(() => []);
jest.mock("../../../src/services/setup/setupEditor", () => ({
    ...jest.requireActual("../../../src/services/setup/setupEditor"),
    raidHelperSlots: (...args) => mockRaidHelperSlots(...args),
}));
const auth = require("../../../src/web/http/auth");
const settingsStore = require("../../../src/stores/settingsStore");
const { activeGuildFor } = require("../../../src/web/http/activeGuild");
const dashboardData = require("../../../src/web/dashboardData");
const discord = require("../../../src/services/discord/discord");
const raidEventGroups = require("../../../src/services/events/raidEventGroups");
const logStore = require("../../../src/stores/logStore");
const lootStore = require("../../../src/stores/lootStore");
const lootAwards = require("../../../src/web/lootAwards");
const characterInfo = require("../../../src/web/characterInfo");
const characterStore = require("../../../src/stores/characterStore");
const charGearIssues = require("../../../src/web/charGearIssues");
const lootImport = require("../../../src/utils/loot/lootImport");
const lootEventMatch = require("../../../src/web/lootEventMatch");
const reportList = require("../../../src/web/reportList");
const { emptyAccess } = require("../../../src/config/permissions");
const { post, get } = routerClient(require("../../../src/web/apiRoutes/history"));

describe("web/apiRoutes/history", () => {
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
            expect(json(res).data).toEqual({
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

        // A member holding only "Loot-Ansichten" reads the same endpoint, but the
        // raid lists, the logs and the characters are not theirs to see — and the
        // Raid-Helper/Discord round-trips behind them are pure waste here.
        it("cuts the payload down to the loot part for a loot-only caller", async () => {
            auth.getUser.mockReturnValue({
                id: "7", name: "Bob", isAdmin: false,
                access: { ...emptyAccess(), loot: { read: true, write: false } },
            });
            activeGuildFor.mockReturnValue("guild-1");
            lootStore.eventsWithLoot.mockReturnValue([{ eventId: "e1", label: "Kara", count: 2 }]);
            discord.listCategories.mockReturnValue([{ id: "cat1", name: "Raids" }]);

            const res = await get("/api/history");

            expect(json(res).data).toEqual({
                events: [],
                upcomingRaids: { events: [], error: null },
                pastRaids: { events: [], error: null },
                lootEvents: [{ eventId: "e1", label: "Kara", count: 2 }],
                logs: [],
                categories: [{ id: "cat1", name: "Raids" }],
                categoryLootTool: {},
                activeGuildId: "guild-1",
                chars: [],
            });
            expect(raidEventGroups.loadEventGroups).not.toHaveBeenCalled();
            expect(dashboardData.loadRecentEvents).not.toHaveBeenCalled();
            expect(logStore.listLogs).not.toHaveBeenCalled();
        });

        it("computes each log's posted-date via logPostedAt (falls back through messageId/detectedAt)", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            logStore.listLogs.mockReturnValue([{ id: "l1", title: "Log 1", detectedAt: 555 }]);
            reportList.logPostedAt.mockReturnValueOnce(555);
            const res = await get("/api/history");
            expect(reportList.logPostedAt).toHaveBeenCalledWith({ id: "l1", title: "Log 1", detectedAt: 555 });
            expect(json(res).data.logs).toEqual([{ id: "l1", title: "Log 1", detectedAt: 555, postedAt: 555 }]);
        });

        it("annotates loot characters with their class color and spec icon", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            characterInfo.annotatedCharacters.mockReturnValue([
                { key: "anna@t", character: "Anna", realm: "t", count: 3, className: "Paladin", spec: "Holy", source: "wcl", reportId: "r1" },
                { key: "bob@t", character: "Bob", realm: "t", count: 1, className: "", spec: "", source: "", reportId: "" },
            ]);

            const res = await get("/api/history");

            expect(json(res).data.chars).toEqual([
                {
                    key: "anna@t", character: "Anna", realm: "t", count: 3, className: "Paladin", spec: "Holy", source: "wcl", reportId: "r1",
                    classColor: expect.any(String), iconUrl: expect.any(String),
                },
                {
                    key: "bob@t", character: "Bob", realm: "t", count: 1, className: "", spec: "", source: "", reportId: "",
                    classColor: "", iconUrl: "",
                },
            ]);
            expect(json(res).data.chars[0].classColor).not.toBe("");
            expect(json(res).data.chars[0].iconUrl).toMatch(/^https:\/\//);
        });
    });

    describe("POST /api/history/log-delete", () => {
        it("deletes the log and returns its id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/history/log-delete", { logId: "l1" });
            expect(logStore.deleteLog).toHaveBeenCalledWith("l1");
            expect(json(res)).toEqual({ data: { id: "l1" } });
        });
    });

    describe("POST /api/history/import", () => {
        // Mock return values survive a test (jest clearMocks only drops calls),
        // so put the guild/category defaults back for the suites further down.
        afterEach(() => {
            activeGuildFor.mockReturnValue("");
            discord.listCategories.mockReturnValue([]);
        });

        it("returns 400 when the export text is empty", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/history/import", { data: "" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "no_data", message: expect.any(String) } });
        });

        it("returns 400 with the parser's message on a LootParseError", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootImport.parseLoot.mockImplementation(() => { throw new lootImport.LootParseError("Ungültiges Format."); });
            const res = await post("/api/history/import", { data: "garbage" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "parse_failed", message: "Ungültiges Format." } });
        });

        it("returns 400 when parsing succeeds but finds no items", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootImport.parseLoot.mockReturnValue([]);
            const res = await post("/api/history/import", { data: "text" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "empty", message: expect.any(String) } });
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
            expect(json(res)).toEqual({ data: { eventId: "manual-ssc-tk-12-07", eventLabel: "SSC/TK — 12.07.", categoryId: "", added: 1, skipped: 0 } });
        });

        // A manual import has no event to take a category from, so the one the
        // admin picked in the form is the only thing that can file it under a
        // raid category — without it the loot misses every grouped overview.
        it("files a manual import under the category picked in the form", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            discord.listCategories.mockReturnValue([{ id: "cat-pug", name: "Pug" }]);
            lootImport.parseLoot.mockReturnValue([{ itemName: "Sword" }]);
            lootStore.addImport.mockReturnValue({ added: 1, skipped: 0 });

            const res = await post("/api/history/import", { data: "text", event: "__manual__", manualLabel: "Pug-Raid", categoryId: "cat-pug" });

            expect(lootStore.addImport).toHaveBeenCalledWith(
                "manual-pug-raid",
                [{ itemName: "Sword" }],
                { categoryId: "cat-pug", eventLabel: "Pug-Raid" },
            );
            expect(json(res).data).toMatchObject({ eventId: "manual-pug-raid", categoryId: "cat-pug" });
        });

        it("refuses a category the guild does not have", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            discord.listCategories.mockReturnValue([{ id: "cat-pug", name: "Pug" }]);
            lootImport.parseLoot.mockReturnValue([{ itemName: "Sword" }]);

            const res = await post("/api/history/import", { data: "text", event: "__manual__", manualLabel: "Pug-Raid", categoryId: "nope" });

            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "bad_category", message: expect.any(String) } });
            expect(lootStore.addImport).not.toHaveBeenCalled();
        });

        // Without a reachable Discord (local instance, no token) the category
        // list is empty — assigning one must still work there.
        it("accepts a category when Discord has no list to check against", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            discord.listCategories.mockReturnValue([]);
            lootImport.parseLoot.mockReturnValue([{ itemName: "Sword" }]);
            lootStore.addImport.mockReturnValue({ added: 1, skipped: 0 });

            await post("/api/history/import", { data: "text", event: "__manual__", manualLabel: "Pug-Raid", categoryId: "cat-pug" });

            expect(lootStore.addImport).toHaveBeenCalledWith(
                "manual-pug-raid", [{ itemName: "Sword" }], { categoryId: "cat-pug", eventLabel: "Pug-Raid" },
            );
        });

        it("returns 400 for __manual__ without a label", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootImport.parseLoot.mockReturnValue([{ itemName: "Sword" }]);
            const res = await post("/api/history/import", { data: "text", event: "__manual__" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "no_label", message: expect.any(String) } });
        });

        it("returns 409 when the auto-matched date is ambiguous", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootImport.parseLoot.mockReturnValue([{ itemName: "Sword" }]);
            lootImport.detectImportDate.mockReturnValue(123456);
            lootEventMatch.bestDayMatch.mockReturnValue({ match: null, ambiguous: true });

            const res = await post("/api/history/import", { data: "text", event: "__auto__" });

            expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "ambiguous", message: expect.any(String) } });
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
            expect(json(res)).toEqual({ data: { eventId: "e1", eventLabel: "Kara", categoryId: "cat1", added: 3, skipped: 1 } });
        });

        // The event's own Discord category is the truth — a category picked in
        // the form only fills the gap when no event supplied one.
        it("keeps the matched event's category over a hand-picked one", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            discord.listCategories.mockReturnValue([{ id: "cat1", name: "Montagsraid" }, { id: "cat-pug", name: "Pug" }]);
            lootImport.parseLoot.mockReturnValue([{ itemName: "Sword" }]);
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", events: [{ id: "e1", title: "Kara" }] }],
                error: null,
            });
            lootStore.addImport.mockReturnValue({ added: 1, skipped: 0 });

            const res = await post("/api/history/import", { data: "text", event: "e1", categoryId: "cat-pug" });

            expect(lootStore.addImport).toHaveBeenCalledWith("e1", [{ itemName: "Sword" }], { categoryId: "cat1", eventLabel: "Kara" });
            expect(json(res).data.categoryId).toBe("cat1");
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
            expect(json(res)).toEqual({ data: { eventId: "e1", eventLabel: "Kara", categoryId: "cat1", added: 1, skipped: 0 } });
        });
    });

    describe("POST /api/history/loot-category", () => {
        afterEach(() => {
            activeGuildFor.mockReturnValue("");
            discord.listCategories.mockReturnValue([]);
        });

        it("files an already-imported bucket under a category", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            discord.listCategories.mockReturnValue([{ id: "cat-pug", name: "Pug" }]);
            lootStore.setEventCategory.mockReturnValue(7);

            const res = await post("/api/history/loot-category", { event: "manual-pug-raid", categoryId: "cat-pug" });

            expect(lootStore.setEventCategory).toHaveBeenCalledWith("manual-pug-raid", "cat-pug");
            expect(json(res)).toEqual({ data: { eventId: "manual-pug-raid", categoryId: "cat-pug", updated: 7 } });
        });

        it("clears the category for an empty id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootStore.setEventCategory.mockReturnValue(2);

            const res = await post("/api/history/loot-category", { event: "e1", categoryId: "" });

            expect(lootStore.setEventCategory).toHaveBeenCalledWith("e1", "");
            expect(json(res).data).toMatchObject({ categoryId: "", updated: 2 });
        });

        it("returns 400 without an event", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/history/loot-category", { categoryId: "cat-pug" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "no_event", message: expect.any(String) } });
            expect(lootStore.setEventCategory).not.toHaveBeenCalled();
        });

        it("returns 400 for a category the guild does not have", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            discord.listCategories.mockReturnValue([{ id: "cat-pug", name: "Pug" }]);

            const res = await post("/api/history/loot-category", { event: "e1", categoryId: "nope" });

            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "bad_category", message: expect.any(String) } });
            expect(lootStore.setEventCategory).not.toHaveBeenCalled();
        });

        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await post("/api/history/loot-category", { event: "e1", categoryId: "cat-pug" });
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(lootStore.setEventCategory).not.toHaveBeenCalled();
        });
    });

    // The loot tool per category moved to Einstellungen → Loot, where it is
    // saved with the rest of the config; the old endpoint is gone.
    it("no longer serves POST /api/history/category-tool", async () => {
        auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
        auth.checkCsrf.mockReturnValue(true);
        const res = await post("/api/history/category-tool", { categoryId: "cat1", tool: "rclc" });
        expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        expect(settingsStore.saveConfig).not.toHaveBeenCalled();
    });

    describe("POST /api/history/loot-delete", () => {
        it("deletes single rows by id and returns the removed count", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootStore.removeItems.mockReturnValue(2);
            const res = await post("/api/history/loot-delete", { ids: ["a1", "b2"] });
            expect(lootStore.removeItems).toHaveBeenCalledWith(["a1", "b2"]);
            expect(json(res)).toEqual({ data: { removed: 2 } });
        });

        it("accepts a single id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootStore.removeItems.mockReturnValue(1);
            await post("/api/history/loot-delete", { id: "a1" });
            expect(lootStore.removeItems).toHaveBeenCalledWith(["a1"]);
        });

        it("returns 400 without an id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/history/loot-delete", { ids: ["", "  "] });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "no_id", message: expect.any(String) } });
            expect(lootStore.removeItems).not.toHaveBeenCalled();
        });

        // A row the view still shows but the store no longer has — a stale page,
        // not a success.
        it("returns 404 when nothing matched", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootStore.removeItems.mockReturnValue(0);
            const res = await post("/api/history/loot-delete", { id: "gone" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "not_found", message: expect.any(String) } });
        });

        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await post("/api/history/loot-delete", { id: "a1" });
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(lootStore.removeItems).not.toHaveBeenCalled();
        });

        it("returns 403 without a valid CSRF token", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(false);
            const res = await post("/api/history/loot-delete", { id: "a1" });
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(lootStore.removeItems).not.toHaveBeenCalled();
        });
    });

    describe("GET /api/history/loot-picker", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            lootStore.listByEvent.mockReturnValue([]);
            characterInfo.annotatedCharacters.mockReturnValue([]);
        });

        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await get("/api/history/loot-picker", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });

        it("offers every raid's drops, the reasons and the known raiders", async () => {
            characterInfo.annotatedCharacters.mockReturnValue([{ character: "Anna", className: "Paladin", spec: "Holy" }]);

            const data = json(await get("/api/history/loot-picker", { event: "e1", title: "Raidabend" })).data;

            const ssc = data.contents.find((c) => c.id === "ssc");
            expect(ssc.items.length).toBeGreaterThan(0);
            expect(ssc.items.find((it) => it.id === 30095)).toMatchObject({ name: "Fang of the Leviathan" });
            expect(data.reasons.map((r) => r.id)).toContain("offspec");
            // The raider comes with the look their name renders in, so the
            // dropdown matches the table it writes into.
            expect(data.characters[0]).toMatchObject({ character: "Anna", className: "Paladin", spec: "Holy" });
            expect(data.characters[0].classColor).toBeTruthy();
        });

        it("preselects the raid the event's own loot says it was", async () => {
            lootStore.listByEvent.mockReturnValue([{ contentId: "bt" }, { contentId: "hyjal" }]);
            const data = json(await get("/api/history/loot-picker", { event: "e1", title: "SSC/TK" })).data;
            // The stored loot wins over the title — item ids are evidence, a
            // title is a plan.
            expect(data.suggested).toEqual(["hyjal", "bt"]);
        });

        it("falls back to the event title, and suggests nothing when it says nothing", async () => {
            expect(json(await get("/api/history/loot-picker", { event: "e1", title: "Kara" })).data.suggested).toEqual(["kara"]);
            expect(json(await get("/api/history/loot-picker", { event: "e1", title: "Raid" })).data.suggested).toEqual([]);
        });
    });

    describe("POST /api/history/loot-add", () => {
        const entry = { event: "e1", itemId: 30095, character: "Anna", boss: "Leotheras the Blind", response: "Mainspec", awardedAt: 5000 };

        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootStore.addImport.mockReturnValue({ added: 1, skipped: 0 });
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", events: [{ id: "e1", title: "SSC/TK" }] }],
            });
        });

        it("files the award under the event, with the event's own label and category", async () => {
            const res = await post("/api/history/loot-add", entry);

            expect(lootStore.addImport).toHaveBeenCalledWith("e1", [expect.objectContaining({
                source: "manual",
                itemId: 30095,
                character: "Anna",
                characterKey: "anna",
                boss: "Leotheras the Blind",
                response: "Mainspec",
                offspec: false,
                awardedAt: 5000,
            })], { categoryId: "cat1", eventLabel: "SSC/TK" });
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(json(res).data).toMatchObject({ eventId: "e1", eventLabel: "SSC/TK", added: 1 });
        });

        it("looks up the item's name and icon before storing it", async () => {
            await post("/api/history/loot-add", entry);
            expect(lootImport.enrichItemNames).toHaveBeenCalledWith([expect.objectContaining({ itemId: 30095 })]);
        });

        it("returns 409 when the same award is already stored (a double submit)", async () => {
            lootStore.addImport.mockReturnValue({ added: 0, skipped: 1 });
            const res = await post("/api/history/loot-add", entry);
            expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "duplicate", message: expect.any(String) } });
        });

        it("returns 400 without an event, an item or a character", async () => {
            const noEvent = await post("/api/history/loot-add", { ...entry, event: "" });
            expect(json(noEvent)).toEqual({ error: { code: "no_event", message: expect.any(String) } });

            const noItem = await post("/api/history/loot-add", { ...entry, itemId: 0 });
            expect(json(noItem)).toEqual({ error: { code: "missing_fields", message: expect.any(String) } });

            const noChar = await post("/api/history/loot-add", { ...entry, character: "  " });
            expect(json(noChar)).toEqual({ error: { code: "missing_fields", message: expect.any(String) } });
            expect(lootStore.addImport).not.toHaveBeenCalled();
        });

        it("returns 401 for an anonymous caller and 403 without a CSRF token", async () => {
            auth.getUser.mockReturnValue(null);
            expect((await post("/api/history/loot-add", entry)).writeHead).toHaveBeenCalledWith(401, expect.any(Object));

            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(false);
            expect((await post("/api/history/loot-add", entry)).writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(lootStore.addImport).not.toHaveBeenCalled();
        });
    });

    describe("POST /api/history/clear", () => {
        it("clears the event's loot and returns the removed count", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootStore.clearEvent.mockReturnValue(4);
            const res = await post("/api/history/clear", { event: "e1" });
            expect(lootStore.clearEvent).toHaveBeenCalledWith("e1");
            expect(json(res)).toEqual({ data: { removed: 4 } });
        });
    });

    describe("GET /api/history/event", () => {
        it("returns the loot items and label for an event", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            lootStore.listByEvent.mockReturnValue([{ eventLabel: "Kara", itemName: "Sword" }]);
            const res = await get("/api/history/event", { event: "e1" });
            expect(lootStore.listByEvent).toHaveBeenCalledWith("e1");
            expect(json(res)).toEqual({
                data: {
                    eventId: "e1",
                    label: "Kara",
                    items: [{ eventLabel: "Kara", itemName: "Sword", className: "", spec: "", classColor: "", specIconUrl: "" }],
                },
            });
        });

        it("gives every row the winner's class colour and spec icon", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            characterStore.characterMap.mockReturnValue({ anna: { className: "Paladin", spec: "Holy" } });
            lootStore.listByEvent.mockReturnValue([
                { eventLabel: "Kara", itemName: "Sword", character: "Anna", characterKey: "anna" },
                { eventLabel: "Kara", itemName: "Shield", character: "Bob", characterKey: "bob" },
            ]);

            const [anna, bob] = json(await get("/api/history/event", { event: "e1" })).data.items;

            expect(anna.className).toBe("Paladin");
            expect(anna.spec).toBe("Holy");
            expect(anna.classColor).toBeTruthy();
            expect(anna.specIconUrl).toBeTruthy();
            // Nobody resolved Bob's class — he stays blank rather than guessed.
            expect(bob).toMatchObject({ className: "", spec: "", classColor: "", specIconUrl: "" });
        });
    });

    describe("GET /api/history/loot-awards", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await get("/api/history/loot-awards", {});
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(lootAwards.listAwards).not.toHaveBeenCalled();
        });

        it("defaults to the top items on page 1 without any query", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            await get("/api/history/loot-awards", {});
            expect(lootAwards.listAwards).toHaveBeenCalledWith({
                topOnly: true, search: "", categoryId: "", contentId: "", reason: "", page: 1,
            });
        });

        it("passes the filters and the page through, and widens the scope on top=0", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            await get("/api/history/loot-awards", {
                top: "0", q: "vashj", category: "cat1", content: "ssc", reason: "offspec", page: "3",
            });
            expect(lootAwards.listAwards).toHaveBeenCalledWith({
                topOnly: false, search: "vashj", categoryId: "cat1", contentId: "ssc", reason: "offspec", page: 3,
            });
        });

        it("serves the page the store returns", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            lootAwards.listAwards.mockReturnValue({
                items: [{ itemId: 30883, character: "Kilrogg" }], page: 2, pageSize: 25, total: 30,
                totalPages: 2, topItemCount: 4, contents: [], reasons: [], unknownContentCount: 0,
            });
            const res = await get("/api/history/loot-awards", { page: "2" });
            expect(json(res).data).toMatchObject({ page: 2, total: 30, totalPages: 2, topItemCount: 4 });
        });

        // Rows imported before name enrichment existed would show as "Item <id>"
        // in a list that is searched by name.
        it("backfills missing item names first", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            await get("/api/history/loot-awards", {});
            expect(lootStore.repairItemNames).toHaveBeenCalled();
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
            expect(json(res).data).toEqual(expect.objectContaining({
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

            expect(json(res).data.message).toBe(
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
            expect(json(res)).toEqual({
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
            expect(json(res).data).toEqual({
                character: "Anna",
                realm: "thunderstrike",
                items: [{
                    character: "Anna", realm: "thunderstrike", itemName: "Sword",
                    className: "", spec: "", classColor: "", specIconUrl: "",
                }],
                armoryUrl: expect.stringContaining(encodeURIComponent("Anna")),
                wclUrl: expect.stringContaining(encodeURIComponent("Anna")),
                gear: null,
                gearConfigured: false,
                gearError: "",
                charSummary: null,
                gearNamespace: "profile-classicann-eu",
                info: null,
                gearIssues: null,
            });
        });

        it("passes the character's latest gear findings through", async () => {
            charGearIssues.issuesForCharacter.mockReturnValue({
                issueCount: 2, issues: [{ label: "kein Item" }], reportRefId: "r1", generatedAt: 500,
            });

            const res = await get("/api/history/char", { name: "Anna" });

            expect(charGearIssues.issuesForCharacter).toHaveBeenCalledWith("Anna");
            expect(json(res).data.gearIssues).toMatchObject({ issueCount: 2, reportRefId: "r1" });
            charGearIssues.issuesForCharacter.mockReturnValue(null);
        });

        it("falls back to the configured realm slug when no loot item carries a realm", async () => {
            settingsStore.getConfig.mockReturnValue({ blizzard: { realmSlug: "thunderstrike" } });

            const res = await get("/api/history/char", { name: "Anna" });

            expect(json(res).data.realm).toBe("thunderstrike");
        });

        it("returns an empty character/realm/gear response when name is missing", async () => {
            const res = await get("/api/history/char", {});
            expect(json(res).data.character).toBe("");
            expect(mockGetCharacterSummary).not.toHaveBeenCalled();
        });

        it("returns the resolved gear + charSummary + info when Blizzard is configured and succeeds", async () => {
            mockIsConfigured.mockReturnValue(true);
            mockGetCharacterSummary.mockResolvedValue({ name: "Anna", level: 70, className: "Paladin" });
            mockGetEquipment.mockResolvedValue([{ slot: "Head", itemId: 123, name: "Helm" }]);
            characterStore.getCharacter.mockReturnValue({ character: "Anna", className: "Paladin" });

            const res = await get("/api/history/char", { name: "Anna" });

            expect(json(res).data.gear).toEqual([{ slot: "Head", itemId: 123, name: "Helm" }]);
            expect(json(res).data.charSummary).toEqual({ name: "Anna", level: 70, className: "Paladin" });
            expect(json(res).data.gearConfigured).toBe(true);
            expect(json(res).data.gearError).toBe("");
            expect(json(res).data.info).toEqual({
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

            expect(json(res).data.gearError).toBe(
                "Charakter „Anna\" nicht in der Blizzard-API gefunden (404, Namespace profile-classicann-eu). "
                + "Realm-Slug „thunderstrike\"/Schreibweise prüfen oder den Namespace in den Einstellungen ändern (z.B. profile-classicann-eu).",
            );
        });

        it("builds the 403 gearError", async () => {
            mockIsConfigured.mockReturnValue(true);
            mockGetEquipment.mockResolvedValue(null);
            mockLastError = { status: 403 };

            const res = await get("/api/history/char", { name: "Anna" });

            expect(json(res).data.gearError).toBe("Zugriff verweigert (403) — die Profile-API ist für diesen Realm evtl. nicht freigegeben.");
        });

        it("builds the 401 gearError", async () => {
            mockIsConfigured.mockReturnValue(true);
            mockGetEquipment.mockResolvedValue(null);
            mockLastError = { status: 401 };

            const res = await get("/api/history/char", { name: "Anna" });

            expect(json(res).data.gearError).toBe("Authentifizierung fehlgeschlagen (401) — Battle.net Client-ID/Secret prüfen.");
        });

        it("builds the generic-status gearError for any other HTTP status", async () => {
            mockIsConfigured.mockReturnValue(true);
            mockGetEquipment.mockResolvedValue(null);
            mockLastError = { status: 500 };

            const res = await get("/api/history/char", { name: "Anna" });

            expect(json(res).data.gearError).toBe("Blizzard-API-Fehler (500).");
        });

        it("builds the network-error gearError when there is no status", async () => {
            mockIsConfigured.mockReturnValue(true);
            mockGetEquipment.mockResolvedValue(null);
            mockLastError = { message: "ECONNRESET" };

            const res = await get("/api/history/char", { name: "Anna" });

            expect(json(res).data.gearError).toBe("Blizzard-API nicht erreichbar (ECONNRESET).");
        });

        it("falls back to a generic network-error message when lastError carries no message either", async () => {
            mockIsConfigured.mockReturnValue(true);
            mockGetEquipment.mockResolvedValue(null);
            mockLastError = {};

            const res = await get("/api/history/char", { name: "Anna" });

            expect(json(res).data.gearError).toBe("Blizzard-API nicht erreichbar (Netzwerkfehler).");
        });
    });
});
