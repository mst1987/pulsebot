const { mockRes, json, routerClient } = require("../../helpers/http");

jest.mock("../../../src/web/auth", () => ({
    getUser: jest.fn(),
    // "Ansicht als Rolle": the caller's own rights, and starting/stopping the view
    getRealUser: jest.fn(),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../src/web/reportStore", () => ({
    listReports: jest.fn(() => []),
    deleteReport: jest.fn(() => true),
    getReport: jest.fn(() => null),
    saveReport: jest.fn((report, id) => id || "new-id"),
}));
jest.mock("../../../src/web/settingsStore", () => ({
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
jest.mock("../../../src/web/activeGuild", () => ({ activeGuildFor: jest.fn(() => "") }));
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
// The dashboard asks GitHub how far the server is behind main. Unmocked, this
// suite really called api.github.com (found by the network guard, #432) - and
// its task list then depended on whether the checkout was current.
jest.mock("../../../src/web/deployStatus", () => ({
    deployStatus: jest.fn(() => Promise.resolve({ status: "current", behind: 0, behindSince: "", latest: null })),
}));
jest.mock("../../../src/web/raidEventStore", () => ({
    getRaidEvent: jest.fn(() => null),
    listRaidEvents: jest.fn(() => []),
    saveRaidEvents: jest.fn(),
}));
// The routes label category ids through categoryNames.js, which merges the live
// Discord list with the names it snapshots to disk. Reduced here to the live
// list, so these route tests keep asserting against the discord mock alone and
// touch no files; the merging itself is covered by categoryNames.test.js.
jest.mock("../../../src/web/categoryNames", () => ({
    listKnownCategories: (guildId) => (guildId ? require("../../../src/web/discord").listCategories(guildId) : []),
    rememberCategories: jest.fn(),
}));
jest.mock("../../../src/web/logStore", () => ({
    listLogs: jest.fn(() => []),
    listLogsForEvent: jest.fn(() => []),
    deleteLog: jest.fn(),
    getLog: jest.fn(),
    getByReportRefId: jest.fn(),
    clearEvaluation: jest.fn(),
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
jest.mock("../../../src/web/lootStore", () => ({
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
jest.mock("../../../src/web/characterStore", () => ({
    getCharacter: jest.fn(() => null),
    listCharacters: jest.fn(() => []),
    characterMap: jest.fn(() => ({})),
}));
jest.mock("../../../src/web/raiderCharactersStore", () => ({
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
jest.mock("../../../src/utils/lootImport", () => {
    class LootParseError extends Error {}
    const actual = jest.requireActual("../../../src/utils/lootImport");
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
jest.mock("../../../src/web/discord", () => require("../../helpers/discordMock").withClientHelpers({
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
jest.mock("../../../src/web/raidEventGroups", () => ({
    loadEventGroups: jest.fn(() => Promise.resolve({ groups: [], error: null })),
    eventLookbackSince: jest.fn(() => 0),
    fetchEventsCached: jest.fn(() => Promise.resolve({ events: [] })),
}));
// The row shaping is pure and runs for real; the past-raid load rescans the
// event snapshot and has its own test (raidListing.test.js).
jest.mock("../../../src/web/raidListing", () => ({
    ...jest.requireActual("../../../src/web/raidListing"),
    loadPastRaids: jest.fn(() => Promise.resolve({ events: [], error: null })),
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
jest.mock("../../../src/web/eventSheetStore", () => ({
    getEventSheet: jest.fn(() => null),
    markEventSheetFilled: jest.fn(),
    markEventSheetPosted: jest.fn(),
}));
jest.mock("../../../src/web/eventSoftresStore", () => ({
    getEventSoftres: jest.fn(() => null),
    saveEventSoftres: jest.fn(),
    setEventSoftresLink: jest.fn(),
    markEventSoftresPosted: jest.fn(),
}));
jest.mock("../../../src/web/eventLootSystemStore", () => ({
    setEventLootSystem: jest.fn(),
    lootSystemOf: jest.fn(() => ({
        system: "softres", label: "Softres", source: "default", categorySystem: "softres", categoryLabel: "Softres", softresExtra: false, softres: true,
    })),
}));
jest.mock("../../../src/utils/softres", () => ({
    parseInstancesFromTitle: jest.fn(() => []),
    targetSizeForInstances: jest.fn(() => 0),
    catalogue: jest.fn(() => []),
    editionOf: jest.fn(() => ""),
    codesForRulesetInstances: jest.fn((ids) => jest.requireActual("../../../src/utils/softres").codesForRulesetInstances(ids, "tbc")),
    createRaid: jest.fn(),
}));
jest.mock("../../../src/utils/wowhead", () => {
    const actual = jest.requireActual("../../../src/utils/wowhead");
    return {
        searchItems: jest.fn(() => Promise.resolve([])),
        // Pure URL builders, no network: the loot catalogue's icon and Wowhead
        // links are exactly these strings, and stubbing them tests nothing.
        iconUrl: actual.iconUrl,
        itemLink: actual.itemLink,
    };
});
const mockRaidHelperSlots = jest.fn(() => []);
jest.mock("../../../src/web/setupEditor", () => ({
    ...jest.requireActual("../../../src/web/setupEditor"),
    raidHelperSlots: (...args) => mockRaidHelperSlots(...args),
}));
const auth = require("../../../src/web/auth");
const settingsStore = require("../../../src/web/settingsStore");
const { activeGuildFor } = require("../../../src/web/activeGuild");
const dashboardData = require("../../../src/web/dashboardData");
const discord = require("../../../src/web/discord");
const { handle } = routerClient(require("../../../src/web/apiRoutes/dashboard"));

describe("web/apiRoutes/dashboard", () => {
    describe("GET /api/dashboard", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            const handled = await handle("/api/dashboard", { method: "GET" }, res);
            expect(handled).toBe(true);
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
        });

        it("returns 403 for a logged-in non-admin", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Bob", isAdmin: false });
            const res = mockRes();
            await handle("/api/dashboard", { method: "GET" }, res);
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "forbidden", message: expect.any(String) } });
        });

        it("assembles next raid, tasks, area figures, loot and last raids for an admin", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            discord.listGuilds.mockReturnValue([{ id: "guild-1", name: "Pulse" }]);
            settingsStore.getConfig.mockReturnValue({ blizzard: { realmSlug: "thunderstrike", region: "eu" } });
            settingsStore.listRecruitmentPosts.mockReturnValue([{ id: "p1" }, { id: "p2" }]);
            const next = { id: "n1", title: "Black Temple", startTime: 2000, sheet: null };
            const after = { id: "n2", title: "Hyjal", startTime: 3000, sheet: { url: "u" } };
            dashboardData.loadNextRaids.mockResolvedValue({ raids: [next, after], error: null });
            dashboardData.loadRecentEvents.mockResolvedValue({
                events: [{ id: "e1", title: "Hyjal", startTime: 1000, pendingLogCount: 2, logs: [] }], error: null,
            });
            dashboardData.loadLatestReport.mockReturnValue({ id: "r1", zone: "Black Temple", generatedAt: 5, problems: 3, open: 7 });
            dashboardData.loadInbox.mockReturnValue([{ id: "s1", items: [1, 2] }]);
            dashboardData.loadRosterFigures.mockReturnValue({ total: 27, withoutDiscord: 2 });
            dashboardData.loadNewLoot.mockReturnValue({ count: 3, since: 1000000 });
            dashboardData.loadTopLoot.mockReturnValue({ items: [{ itemId: 30883, character: "Kilrogg" }], configured: 3 });

            const res = mockRes();
            const handled = await handle("/api/dashboard", { method: "GET" }, res);

            expect(handled).toBe(true);
            expect(dashboardData.loadNextRaids).toHaveBeenCalledWith("guild-1", 2);
            expect(dashboardData.loadRecentEvents).toHaveBeenCalledWith("guild-1", 5);
            // "Neuer Loot" counts from the newest past raid's start
            expect(dashboardData.loadNewLoot).toHaveBeenCalledWith(1000);
            const data = json(res).data;
            expect(data.kicker).toEqual({ guild: "Pulse", realm: "Thunderstrike EU" });
            expect(data.nextRaid).toEqual(next);
            expect(data.followingRaid).toEqual(after);
            expect(data.tasks.map((t) => t.id)).toEqual(["sheet", "recommendations", "logs", "inbox"]);
            expect(data.areas).toEqual({
                lastReport: { id: "r1", zone: "Black Temple", generatedAt: 5, problems: 3, open: 7 },
                newLoot: { count: 3, since: 1000000 },
                recruitment: { posts: 2 },
                roster: { total: 27, withoutDiscord: 2 },
            });
            expect(data.recentEvents.events[0]).toMatchObject({ id: "e1", icon: "achievement_boss_archimonde-" });
            expect(data.topLoot).toEqual({ items: [{ itemId: 30883, character: "Kilrogg" }], configured: 3 });
            expect(data.activeGuildId).toBe("guild-1");
            // the old configuration counters are gone
            expect(data.stats).toBeUndefined();
            expect(data.recentReports).toBeUndefined();
        });

        it("shows no tasks and no next raid when nothing is due", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            dashboardData.loadNextRaids.mockResolvedValue({ raids: [], error: "Raid-Helper down" });
            dashboardData.loadRecentEvents.mockResolvedValue({ events: [], error: null });
            dashboardData.loadLatestReport.mockReturnValue(null);
            dashboardData.loadInbox.mockReturnValue([]);
            const res = mockRes();
            await handle("/api/dashboard", { method: "GET" }, res);
            const data = json(res).data;
            expect(data.nextRaid).toBeNull();
            expect(data.nextRaidError).toBe("Raid-Helper down");
            expect(data.tasks).toEqual([]);
            expect(dashboardData.loadNewLoot).toHaveBeenCalledWith(0);
        });
    });

    describe("GET /api/dashboard/next-raid", () => {
        it("needs an event id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            const res = mockRes();
            await handle("/api/dashboard/next-raid", { method: "GET" }, res, new URL("http://x/api/dashboard/next-raid"));
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("answers 404 for an unknown event and 400 when Raid-Helper failed", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            const url = new URL("http://x/api/dashboard/next-raid?event=ev9");
            dashboardData.loadNextRaidDetails.mockResolvedValueOnce({ error: "Event nicht gefunden.", notFound: true });
            let res = mockRes();
            await handle("/api/dashboard/next-raid", { method: "GET" }, res, url);
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            dashboardData.loadNextRaidDetails.mockResolvedValueOnce({ error: "down", notFound: false });
            res = mockRes();
            await handle("/api/dashboard/next-raid", { method: "GET" }, res, url);
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("returns the raid details for the active guild", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            dashboardData.loadNextRaidDetails.mockResolvedValueOnce({ error: null, raid: { id: "ev1", classes: [] } });
            const res = mockRes();
            await handle("/api/dashboard/next-raid", { method: "GET" }, res, new URL("http://x/api/dashboard/next-raid?event=ev1"));
            expect(dashboardData.loadNextRaidDetails).toHaveBeenCalledWith("guild-1", "ev1");
            expect(json(res)).toEqual({ data: { raid: { id: "ev1", classes: [] }, activeGuildId: "guild-1" } });
        });

        it("is closed to anonymous callers", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            await handle("/api/dashboard/next-raid", { method: "GET" }, res, new URL("http://x/api/dashboard/next-raid?event=ev1"));
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });
    });
});
