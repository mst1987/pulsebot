const { json, status, jsonRequest, mockRes, routerClient } = require("../../helpers/http");

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
    setReportGuild: jest.fn(() => false),
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
jest.mock("../../../src/web/dashboard/dashboardData", () => ({
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
jest.mock("../../../src/services/logcheck/reportList", () => ({
    prepareReportList: jest.fn((reports, query) => ({
        items: reports, sort: (query && query.sort) || "date", dir: (query && query.dir) || "desc", page: 1, totalPages: 1, total: reports.length, pageSize: 15,
    })),
    annotateLogCategories: jest.fn((items) => items),
    annotateReportEvents: jest.fn((reports) => reports),
    logPostedAt: jest.fn((l) => (l && l.postedAt) || 0),
    // the Log-Auswertung list is pure; the route tests run the real one
    prepareClaList: jest.fn((...args) => jest.requireActual("../../../src/services/logcheck/reportList").prepareClaList(...args)),
    claRowFromLog: jest.fn((...args) => jest.requireActual("../../../src/services/logcheck/reportList").claRowFromLog(...args)),
}));
jest.mock("../../../src/services/logcheck/logEventMatch", () => ({
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
jest.mock("../../../src/web/loot/lootAwards", () => ({
    listAwards: jest.fn(() => ({
        items: [], page: 1, pageSize: 25, total: 0, totalPages: 1,
        topItemCount: 0, contents: [], reasons: [], unknownContentCount: 0,
    })),
    PAGE_SIZE: 25,
}));
jest.mock("../../../src/services/characters/characterInfo", () => ({
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
jest.mock("../../../src/web/characters/charGearIssues", () => ({
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
        nameKeyOf: actual.nameKeyOf,
        splitPlayer: actual.splitPlayer,
        buildManualItem: actual.buildManualItem,
        LootParseError,
    };
});
jest.mock("../../../src/web/loot/lootEventMatch", () => ({
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
const dashboardData = require("../../../src/web/dashboard/dashboardData");
const discord = require("../../../src/services/discord/discord");
const raidEventGroups = require("../../../src/services/events/raidEventGroups");
const logStore = require("../../../src/stores/logStore");
const { reportsOfGuild } = require("../../../src/services/logcheck/reportGuild");
const reportStore = require("../../../src/stores/reportStore");
const lootStore = require("../../../src/stores/lootStore");
const lootAwards = require("../../../src/web/loot/lootAwards");
const characterInfo = require("../../../src/services/characters/characterInfo");
const characterStore = require("../../../src/stores/characterStore");
const charGearIssues = require("../../../src/web/characters/charGearIssues");
const lootImport = require("../../../src/utils/loot/lootImport");
const lootEventMatch = require("../../../src/web/loot/lootEventMatch");
const reportList = require("../../../src/services/logcheck/reportList");
const charGear = require("../../../src/services/characters/charGear");
const { emptyAccess } = require("../../../src/config/permissions");
const raidEventStore = require("../../../src/stores/raidEventStore");
const { post, get } = routerClient(require("../../../src/web/apiRoutes/history"));

describe("web/apiRoutes/history", () => {
    describe("GET /api/history", () => {
        it("leaves the raids and loot of a hidden version out (#563)", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [
                    { id: "e1", title: "Kara", startTime: 100, categoryId: "cat1", versionId: "tbc" },
                    { id: "e2", title: "Ony", startTime: 200, categoryId: "cat1", versionId: "forever" },
                ] }],
                error: null,
            });
            dashboardData.annotateUpcomingExtras.mockImplementation((rows) => rows);
            dashboardData.loadRecentEvents.mockResolvedValue({ events: [{ id: "e0", title: "Old Kara", versionId: "tbc" }, { id: "e9", title: "Old Ony", versionId: "forever" }], error: null });
            lootStore.eventsWithLoot.mockReturnValue([{ eventId: "e1", label: "Kara", count: 2 }]);
            settingsStore.getConfig.mockReturnValue({ mainVersion: "forever", hideOtherVersions: true });

            const data = json(await get("/api/history")).data;

            expect(data.events.map((e) => e.id)).toEqual(["e2"]);
            expect(data.upcomingRaids.events.map((e) => e.id)).toEqual(["e2"]);
            expect(data.pastRaids.events.map((e) => e.id)).toEqual(["e9"]);
            // loot without an own event is TBC: hidden
            expect(data.lootEvents).toEqual([]);
            expect(data.versions.map((v) => v.id)).toEqual(["forever"]);
            dashboardData.annotateUpcomingExtras.mockReset();
            settingsStore.getConfig.mockReturnValue({});
        });

        it("lists the logs of one version: unlinked ones in every version, linked ones only in their raid's (#741)", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            settingsStore.getConfig.mockReturnValue({ mainVersion: "tbc" });
            logStore.listLogs.mockReturnValue([
                { id: "tbc-log", guildId: "guild-1", eventId: "rh-1", versionId: "tbc" },
                { id: "forever-log", guildId: "guild-1", eventId: "rh-2", versionId: "forever" },
                { id: "waiting", guildId: "guild-1", eventId: "" },
                // another server's log, and one without a server: in no version (#920)
                { id: "foreign", guildId: "guild-2", eventId: "" },
                { id: "serverless", eventId: "" },
            ]);
            try {
                const forever = json(await get("/api/history", { version: "forever" })).data;
                expect(forever.logs.map((l) => l.id)).toEqual(["forever-log", "waiting"]);
                const tbc = json(await get("/api/history")).data;
                expect(tbc.logs.map((l) => l.id)).toEqual(["tbc-log", "waiting"]);
            } finally {
                logStore.listLogs.mockReturnValue([]);
                settingsStore.getConfig.mockReturnValue({});
            }
        });

        it("shows the addon inbox of one version: a session without a raid in every version (#741)", async () => {
            const pending = [
                { id: "p-tbc", items: [], match: { suggested: { eventId: "eh-tbc" } } },
                { id: "p-forever", items: [], match: { suggested: { eventId: "eh-forever" } } },
                { id: "p-open", items: [], match: null },
            ];
            const linked = [{ sessionId: "l-tbc", eventId: "eh-tbc" }, { sessionId: "l-forever", eventId: "eh-forever" }];
            // the inbox store reads its file; here it is a stand-in, in a registry of its own
            let route;
            let isolatedAuth;
            jest.isolateModules(() => {
                jest.doMock("../../../src/stores/lootInboxStore", () => ({
                    listPending: () => pending, listLinked: () => linked,
                    getPending: jest.fn(), resolvePending: jest.fn(), upsertPending: jest.fn(), resolutionFor: jest.fn(), noteAppended: jest.fn(),
                }));
                jest.doMock("../../../src/services/events/storedVersion", () => ({
                    storedVersionOf: (id) => ({ "eh-tbc": "tbc", "eh-forever": "forever" })[id] || "",
                    versionOfLog: () => "",
                }));
                route = require("../../../src/web/apiRoutes/history");
                isolatedAuth = require("../../../src/web/http/auth");
            });
            isolatedAuth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            const inbox = async (version) => {
                const res = mockRes();
                await route.getLootInbox({ method: "GET", headers: {} }, res, new URL(`http://x/api/history/inbox?version=${version}`));
                return json(res).data;
            };
            const forever = await inbox("forever");
            expect(forever.sessions.map((s) => s.id)).toEqual(["p-forever", "p-open"]);
            expect(forever.linked.map((s) => s.sessionId)).toEqual(["l-forever"]);
            const tbc = await inbox("tbc");
            expect(tbc.sessions.map((s) => s.id)).toEqual(["p-tbc", "p-open"]);
            expect(tbc.linked.map((s) => s.sessionId)).toEqual(["l-tbc"]);
        });

        // #919, through the real router: a card shows on the server of its
        // suggested raid, one without a suggestion everywhere; server A can
        // neither file nor dismiss B's card, and without a server nothing shows.
        it("shows, files and dismisses addon inbox cards only on their server (#919)", async () => {
            const pending = [
                { id: "p-a", items: [], match: { suggested: { eventId: "rh-a", guildId: "gA" } } },
                { id: "p-b", items: [], match: { suggested: { eventId: "rh-b", guildId: "gB" } } },
                { id: "p-open", items: [], match: null },
            ];
            const linked = [{ sessionId: "l-a", eventId: "rh-a", guildId: "gA" }, { sessionId: "l-b", eventId: "rh-b", guildId: "gB" }];
            const resolvePending = jest.fn((id) => ({ id, sessionId: id }));
            let router;
            let isolatedAuth;
            let isolatedGuild;
            jest.isolateModules(() => {
                jest.doMock("../../../src/stores/lootInboxStore", () => ({
                    listPending: () => pending, listLinked: () => linked,
                    getPending: (id) => pending.find((s) => s.id === id) || null,
                    resolvePending, upsertPending: jest.fn(), resolutionFor: jest.fn(), noteAppended: jest.fn(), unlinkEvent: jest.fn(() => 0),
                }));
                router = require("../../../src/web/http/apiRouter");
                isolatedAuth = require("../../../src/web/http/auth");
                isolatedGuild = require("../../../src/web/http/activeGuild");
            });
            isolatedAuth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            isolatedAuth.checkCsrf.mockReturnValue(true);
            const send = async (method, path, payload) => {
                const res = mockRes();
                if (method === "GET") await router.handle(path, { method: "GET", headers: {} }, res, new URL(`http://localhost${path}`));
                else await router.handle(path, jsonRequest(method, path, payload, { "x-csrf-token": "tok" }), res);
                return res;
            };

            isolatedGuild.activeGuildFor.mockReturnValue("gA");
            const onA = json(await send("GET", "/api/history/inbox")).data;
            expect(onA.sessions.map((s) => s.id)).toEqual(["p-a", "p-open"]);
            expect(onA.linked.map((s) => s.sessionId)).toEqual(["l-a"]);

            const accept = await send("POST", "/api/history/inbox-accept", { id: "p-b" });
            expect(accept.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(json(accept).error.code).toBe("other_server");
            const dismissB = await send("POST", "/api/history/inbox-dismiss", { id: "p-b" });
            expect(dismissB.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(resolvePending).not.toHaveBeenCalled();
            const dismissOpen = await send("POST", "/api/history/inbox-dismiss", { id: "p-open" });
            expect(json(dismissOpen).data).toEqual({ id: "p-open", sessionId: "p-open" });
            expect(resolvePending).toHaveBeenCalledWith("p-open", "dismissed");

            isolatedGuild.activeGuildFor.mockReturnValue("gB");
            expect(json(await send("GET", "/api/history/inbox")).data.sessions.map((s) => s.id)).toEqual(["p-b", "p-open"]);

            isolatedGuild.activeGuildFor.mockReturnValue("");
            const none = json(await send("GET", "/api/history/inbox")).data;
            expect(none).toEqual({ sessions: [], linked: [] });
        });

        // #919, through the real router: every loot view of the history area -
        // the buckets, the characters, the stats, the awards and the picker -
        // shows server A's loot on A, B's on B and nothing without a server.
        it("shows only the active server's loot in every loot view (#919)", async () => {
            const rows = [
                { id: "a1", eventId: "rh-a", guildId: "gA", categoryId: "", itemId: 30000, itemName: "Klinge A", character: "Arthas", characterKey: "arthas", reason: "ms" },
                { id: "b1", eventId: "rh-b", guildId: "gB", categoryId: "", itemId: 30001, itemName: "Klinge B", character: "Bolvar", characterKey: "bolvar", reason: "ms" },
            ];
            const buckets = [
                { eventId: "rh-a", label: "Raid A", categoryId: "", guildId: "gA", count: 1, sources: [] },
                { eventId: "rh-b", label: "Raid B", categoryId: "", guildId: "gB", count: 1, sources: [] },
            ];
            let router;
            let isolatedAuth;
            let isolatedGuild;
            jest.isolateModules(() => {
                // no raid is known: the rows' own server decides (rule 2)
                jest.doMock("../../../src/stores/eventStore", () => ({ ...jest.requireActual("../../../src/stores/eventStore"), getEvent: () => null }));
                // the file-wide mocks are module factories, so the isolated
                // registry has its own instances: give those the two servers' loot
                // (before the router loads, as the loot views destructure the store)
                const store = require("../../../src/stores/lootStore");
                store.charLootPreview = (it) => ({ itemId: it.itemId, itemName: it.itemName, eventId: it.eventId, reason: it.reason });
                router = require("../../../src/web/http/apiRouter");
                isolatedAuth = require("../../../src/web/http/auth");
                isolatedGuild = require("../../../src/web/http/activeGuild");
                store.listAll.mockImplementation(() => rows);
                store.listByEvent.mockImplementation((id) => rows.filter((r) => r.eventId === id));
                store.listByCharacter.mockImplementation((name) => rows.filter((r) => r.character === name));
                store.eventsWithLoot.mockImplementation(() => buckets);
                require("../../../src/web/loot/lootAwards").listAwards
                    .mockImplementation(jest.requireActual("../../../src/web/loot/lootAwards").listAwards);
                require("../../../src/services/characters/characterInfo").annotatedCharacters
                    .mockImplementation(({ rows: given } = {}) => (given || []).map((r) => ({ character: r.character, realm: "", count: 1, items: [r], categoryIds: [] })));
            });
            isolatedAuth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            const getJson = async (path) => {
                const res = mockRes();
                await router.handle(path.split("?")[0], { method: "GET", headers: {} }, res, new URL(`http://localhost${path}`));
                return json(res).data;
            };
            const views = async () => {
                const history = await getJson("/api/history?version=tbc");
                const stats = await getJson("/api/history/loot-stats?version=tbc");
                const awards = await getJson("/api/history/loot-awards?top=0&version=tbc");
                const pickerA = await getJson("/api/history/loot-picker?event=rh-a&version=tbc");
                const pickerB = await getJson("/api/history/loot-picker?event=rh-b&version=tbc");
                return {
                    buckets: history.lootEvents.map((e) => e.eventId),
                    chars: history.chars.map((c) => c.character),
                    stats: stats.characters.map((c) => c.character),
                    awards: awards.items.map((it) => it.itemName),
                    picker: [...pickerA.characters, ...pickerB.characters].map((c) => c.character),
                };
            };

            isolatedGuild.activeGuildFor.mockReturnValue("gA");
            expect(await views()).toEqual({ buckets: ["rh-a"], chars: ["Arthas"], stats: ["Arthas"], awards: ["Klinge A"], picker: ["Arthas", "Arthas"] });
            isolatedGuild.activeGuildFor.mockReturnValue("gB");
            expect(await views()).toEqual({ buckets: ["rh-b"], chars: ["Bolvar"], stats: ["Bolvar"], awards: ["Klinge B"], picker: ["Bolvar", "Bolvar"] });
            isolatedGuild.activeGuildFor.mockReturnValue("");
            expect(await views()).toEqual({ buckets: [], chars: [], stats: [], awards: [], picker: [] });
        });

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
            logStore.listLogs.mockReturnValue([{ id: "l1", guildId: "guild-1", title: "Log 1" }]);
            discord.listCategories.mockReturnValue([{ id: "cat1", name: "Raids" }]);
            settingsStore.getConfig.mockReturnValue({ categoryLootTool: { cat1: "gargul" } });

            const res = await get("/api/history");

            expect(dashboardData.loadRecentEvents).toHaveBeenCalledWith("guild-1", Infinity);
            expect(json(res).data).toEqual({
                events: [{ id: "e1", title: "Kara", startTime: 100, categoryId: "cat1" }],
                upcomingRaids: { events: [{ id: "e1", title: "Kara", lootCount: 2 }], error: null },
                pastRaids: { events: [{ id: "e0", title: "Old Kara" }], error: null },
                // #563: each bucket names the version of its raid (no own event = TBC)
                lootEvents: [{ eventId: "e1", label: "Kara", count: 2, versionId: "tbc", guildId: "" }],
                logs: [{ id: "l1", guildId: "guild-1", title: "Log 1", postedAt: 0 }],
                categories: [{ id: "cat1", name: "Raids" }],
                categoryLootTool: { cat1: "gargul" },
                activeGuildId: "guild-1",
                chars: [],
                // #543: the version filter of the "Charaktere" tab — the main version even without characters
                mainVersion: "tbc",
                versions: [{ id: "tbc", label: "TBC Anniversary", short: "TBC", count: 0 }],
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
                lootEvents: [{ eventId: "e1", label: "Kara", count: 2, versionId: "tbc", guildId: "" }],
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
            logStore.listLogs.mockReturnValue([{ id: "l1", guildId: "guild-1", title: "Log 1", detectedAt: 555 }]);
            reportList.logPostedAt.mockReturnValueOnce(555);
            const res = await get("/api/history");
            expect(reportList.logPostedAt).toHaveBeenCalledWith({ id: "l1", guildId: "guild-1", title: "Log 1", detectedAt: 555 });
            expect(json(res).data.logs).toEqual([{ id: "l1", guildId: "guild-1", title: "Log 1", detectedAt: 555, postedAt: 555 }]);
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
                    classColor: expect.any(String), iconUrl: expect.any(String), versionIds: ["tbc"],
                },
                {
                    key: "bob@t", character: "Bob", realm: "t", count: 1, className: "", spec: "", source: "", reportId: "",
                    classColor: "", iconUrl: "", versionIds: ["tbc"],
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
            logStore.listLogs.mockReturnValue([{ id: "l1", guildId: "B" }]);
            const res = await post("/api/history/log-delete", { logId: "l1" });
            expect(logStore.deleteLog).toHaveBeenCalledWith("l1");
            expect(json(res)).toEqual({ data: { id: "l1" } });
            logStore.listLogs.mockReturnValue([]);
        });

        // #925: rights hold per server - a log of another server does not exist for its orga
        it("answers 404 for a log of another server and an unknown log", async () => {
            auth.getUser.mockReturnValue({ id: "7", name: "Bob", isAdmin: false, isOrga: true, access: { history: { read: true, write: true } } });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("B");
            logStore.listLogs.mockReturnValue([{ id: "l1", guildId: "A" }, { id: "l2", guildId: "B" }]);
            const other = await post("/api/history/log-delete", { logId: "l1" });
            expect(status(other)).toBe(404);
            expect(json(other).error.code).toBe("not_found");
            expect(status(await post("/api/history/log-delete", { logId: "nope" }))).toBe(404);
            expect(logStore.deleteLog).not.toHaveBeenCalled();
            await post("/api/history/log-delete", { logId: "l2" });
            expect(logStore.deleteLog).toHaveBeenCalledWith("l2");
            logStore.listLogs.mockReturnValue([]);
            activeGuildFor.mockReturnValue("");
        });

        // #920: the report keeps the server of its deleted log instead of falling to another one
        it("writes the log's server onto its report before the log goes", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const report = { id: "abc111" }; // an old report without a server of its own
            let logs = [{ id: "l1", guildId: "B", reportRefId: "abc111" }];
            logStore.listLogs.mockImplementation(() => logs);
            logStore.getLog.mockImplementation((id) => logs.find((l) => l.id === id) || null);
            logStore.deleteLog.mockImplementation((id) => { logs = logs.filter((l) => l.id !== id); return true; });
            reportStore.setReportGuild.mockImplementation((id, guildId) => { if (id === report.id) report.guildId = guildId; return true; });
            await post("/api/history/log-delete", { logId: "l1" });
            expect(reportStore.setReportGuild).toHaveBeenCalledWith("abc111", "B");
            expect(logs).toEqual([]);
            expect(reportsOfGuild([report], "A", logs)).toEqual([]);
            expect(reportsOfGuild([report], "B", logs)).toEqual([report]);
            logStore.getLog.mockReset();
            logStore.deleteLog.mockReset();
            logStore.listLogs.mockReset();
            logStore.listLogs.mockReturnValue([]);
            reportStore.setReportGuild.mockReset();
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
                { categoryId: "", eventLabel: "SSC/TK — 12.07.", guildId: "" },
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
                { categoryId: "cat-pug", eventLabel: "Pug-Raid", guildId: "guild-1" },
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
                "manual-pug-raid", [{ itemName: "Sword" }], { categoryId: "cat-pug", eventLabel: "Pug-Raid", guildId: "guild-1" },
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

            expect(lootStore.addImport).toHaveBeenCalledWith("e1", [{ itemName: "Sword" }], { categoryId: "cat1", eventLabel: "Kara", guildId: "" });
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

            expect(lootStore.addImport).toHaveBeenCalledWith("e1", [{ itemName: "Sword" }], { categoryId: "cat1", eventLabel: "Kara", guildId: "guild-1" });
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

            expect(lootStore.addImport).toHaveBeenCalledWith("e1", [{ itemName: "Sword" }], { categoryId: "cat1", eventLabel: "Kara", guildId: "" });
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
            activeGuildFor.mockReturnValue("guild-1");
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
        // Only rows of the active server can be deleted (#919).
        beforeEach(() => {
            activeGuildFor.mockReturnValue("guild-1");
            lootStore.listAll.mockReturnValue([{ id: "a1", guildId: "guild-1" }, { id: "b2", guildId: "guild-1" }, { id: "x9", guildId: "guild-2" }]);
        });
        afterEach(() => {
            activeGuildFor.mockReturnValue("");
            lootStore.listAll.mockReturnValue([]);
        });

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

        it("never deletes a row of another server, nor anything without an active server (#919)", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/history/loot-delete", { ids: ["x9"] });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            activeGuildFor.mockReturnValue("");
            const none = await post("/api/history/loot-delete", { ids: ["a1"] });
            expect(none.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(lootStore.removeItems).not.toHaveBeenCalled();
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
        afterEach(() => activeGuildFor.mockReturnValue(""));
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
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
            })], { categoryId: "cat1", eventLabel: "SSC/TK", guildId: "" });
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(json(res).data).toMatchObject({ eventId: "e1", eventLabel: "SSC/TK", added: 1 });
        });

        it("looks up the item's name and icon before storing it", async () => {
            await post("/api/history/loot-add", entry);
            expect(lootImport.enrichItemNames).toHaveBeenCalledWith([expect.objectContaining({ itemId: 30095 })], { versionId: "tbc" });
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
        beforeEach(() => activeGuildFor.mockReturnValue("guild-1"));
        afterEach(() => activeGuildFor.mockReturnValue(""));

        it("refuses without an active server (#919, fail closed)", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("");
            const res = await post("/api/history/clear", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(lootStore.clearEvent).not.toHaveBeenCalled();
        });

        it("clears the event's loot and returns the removed count", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            lootStore.clearEvent.mockReturnValue(4);
            const res = await post("/api/history/clear", { event: "e1" });
            expect(lootStore.clearEvent).toHaveBeenCalledWith("e1");
            expect(json(res)).toEqual({ data: { removed: 4, unlinked: 0 } });
        });

        // Otherwise the sync tool's next upload appends the whole raid straight
        // back into the event that was just emptied.
        it("unlinks the addon sessions accepted into the event", async () => {
            const unlinkEvent = jest.fn(() => 2);
            let route;
            let isolatedAuth;
            let isolatedLoot;
            let isolatedGuild;
            // the inbox store reads its file; here it is a stand-in, in a registry of its own
            jest.isolateModules(() => {
                jest.doMock("../../../src/stores/lootInboxStore", () => ({
                    listPending: () => [], listLinked: () => [], unlinkEvent,
                    getPending: jest.fn(), resolvePending: jest.fn(), upsertPending: jest.fn(), resolutionFor: jest.fn(), noteAppended: jest.fn(),
                }));
                route = require("../../../src/web/apiRoutes/history");
                isolatedAuth = require("../../../src/web/http/auth");
                isolatedLoot = require("../../../src/stores/lootStore");
                isolatedGuild = require("../../../src/web/http/activeGuild");
            });
            isolatedGuild.activeGuildFor.mockReturnValue("guild-1");
            isolatedAuth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            isolatedAuth.checkCsrf.mockReturnValue(true);
            isolatedLoot.clearEvent.mockReturnValue(3);
            const res = mockRes();
            await route.clearHistoryEvent(jsonRequest("POST", "/api/history/clear", { event: "e1" }, { "x-csrf-token": "tok" }), res);
            expect(isolatedLoot.clearEvent).toHaveBeenCalledWith("e1");
            expect(unlinkEvent).toHaveBeenCalledWith("e1");
            expect(json(res)).toEqual({ data: { removed: 3, unlinked: 2 } });
        });
    });

    describe("GET /api/history/event", () => {
        beforeEach(() => activeGuildFor.mockReturnValue("guild-1"));
        afterEach(() => activeGuildFor.mockReturnValue(""));

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
                    // the raid's version (#741): a link from another version switches the menu to it
                    versionId: "tbc",
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
                topOnly: true, search: "", categoryId: "", contentId: "", reason: "", page: 1, sort: "date", dir: "desc", versionId: "tbc", guildId: "",
            });
        });

        it("passes the filters and the page through, and widens the scope on top=0", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            await get("/api/history/loot-awards", {
                top: "0", q: "vashj", category: "cat1", content: "ssc", reason: "offspec", page: "3",
            });
            expect(lootAwards.listAwards).toHaveBeenCalledWith({
                topOnly: false, search: "vashj", categoryId: "cat1", contentId: "ssc", reason: "offspec", page: 3, sort: "date", dir: "desc", versionId: "tbc", guildId: "",
            });
        });

        it("passes the sort column and direction through, and reads anything but asc as desc", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            await get("/api/history/loot-awards", { sort: "item", dir: "asc" });
            expect(lootAwards.listAwards).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "item", dir: "asc" }));
            await get("/api/history/loot-awards", { sort: "raid", dir: "sideways" });
            expect(lootAwards.listAwards).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "raid", dir: "desc" }));
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
        afterEach(() => activeGuildFor.mockReturnValue(""));
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            mockIsConfigured.mockReturnValue(false);
            mockGetCharacterSummary.mockResolvedValue(null);
            mockGetEquipment.mockResolvedValue(null);
            mockResolve.mockReturnValue({ region: "eu", realm: "thunderstrike", namespace: "profile-classicann-eu" });
            mockLastError = null;
            lootStore.listByCharacter.mockReturnValue([]);
            settingsStore.getConfig.mockReturnValue({});
            characterStore.getCharacter.mockReturnValue(null);
            // every test asks Blizzard afresh: a found character is kept for 10 minutes (charGear.js)
            charGear._resetForTests();
        });

        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await get("/api/history/char", { name: "Anna" });
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });

        it("takes the character's own version: TBC loot links TBC, even with Forever as the main version (#543)", async () => {
            settingsStore.getConfig.mockReturnValue({ mainVersion: "forever", blizzard: { clientId: "id", clientSecret: "s" } });
            const data = json(await get("/api/history/char", { name: "Anna" })).data;
            expect(data).toMatchObject({ versionId: "tbc", versionIds: ["tbc"] });
            expect(data.armoryUrl).toContain("Anna");
        });

        it("takes the version asked for only when the character plays it (#741)", async () => {
            settingsStore.getConfig.mockReturnValue({ mainVersion: "tbc" });
            // Anna has TBC loot only: a Forever view still shows her in TBC (the page then switches the menu)
            const data = json(await get("/api/history/char", { name: "Anna", version: "forever" })).data;
            expect(data).toMatchObject({ versionId: "tbc", versionIds: ["tbc"] });
        });

        it("asks no armory and links nothing for a version without settings (#542, asked by ?version=)", async () => {
            mockIsConfigured.mockReturnValue(true);
            settingsStore.getConfig.mockReturnValue({ mainVersion: "forever", blizzard: { clientId: "id", clientSecret: "s" }, versionSettings: {} });
            // Anna has loot of a Forever raid (its stored version, #737)
            const raidEventStore = require("../../../src/stores/raidEventStore");
            raidEventStore.versionOfRaidEvent = jest.fn((id) => (id === "rh-forever" ? "forever" : ""));
            lootStore.listByCharacter.mockReturnValueOnce([{ character: "Anna", itemName: "Axe", eventId: "rh-forever" }]);
            const data = json(await get("/api/history/char", { name: "Anna", version: "forever" })).data;
            delete raidEventStore.versionOfRaidEvent;
            expect(mockGetEquipment).not.toHaveBeenCalled();
            expect(mockGetCharacterSummary).not.toHaveBeenCalled();
            expect(data).toMatchObject({
                versionId: "forever", gearConfigured: false, armoryUrl: "", wclUrl: "", wowheadPath: "",
                gearError: "Armory für WoW Forever nicht eingerichtet (Einstellungen → Spielversion).",
            });
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
                versionIds: ["tbc"],
                armoryUrl: expect.stringContaining(encodeURIComponent("Anna")),
                wclUrl: expect.stringContaining(encodeURIComponent("Anna")),
                gear: null,
                gearConfigured: false,
                gearError: "",
                charSummary: null,
                gearNamespace: "profile-classicann-eu",
                versionId: "tbc",
                wowheadPath: "tbc",
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

        it("asks Blizzard once for a character opened twice in a row", async () => {
            mockIsConfigured.mockReturnValue(true);
            mockGetCharacterSummary.mockResolvedValue({ name: "Anna", level: 70 });
            mockGetEquipment.mockResolvedValue([{ slot: "Head", itemId: 123, name: "Helm" }]);

            await get("/api/history/char", { name: "Anna" });
            const again = json(await get("/api/history/char", { name: "Anna" })).data;

            expect(mockGetEquipment).toHaveBeenCalledTimes(1);
            expect(mockGetCharacterSummary).toHaveBeenCalledTimes(1);
            expect(again.gear).toEqual([{ slot: "Head", itemId: 123, name: "Helm" }]);
        });

        it("builds the 404 gearError with name/namespace/realm when the profile is not found", async () => {
            mockIsConfigured.mockReturnValue(true);
            mockGetEquipment.mockResolvedValue(null);
            mockLastError = { status: 404 };
            settingsStore.getConfig.mockReturnValue({ blizzard: { realmSlug: "thunderstrike", region: "eu" } });

            const res = await get("/api/history/char", { name: "Anna" });

            expect(json(res).data.gearError).toBe(
                "Charakter „Anna\" nicht in der Blizzard-API gefunden (404, Namespace profile-classicann-eu). "
                + "Realm-Slug „thunderstrike\"/Schreibweise prüfen oder den Namespace in Einstellungen → Spielversion ändern.",
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

    // One game version per page (#741): the raids "fe" is a Forever one, "te" a TBC one (stored versions of the snapshots).
    describe("one game version per page (#741)", () => {
        const admin = { id: "1", name: "Admin", isAdmin: true };
        const STORED = { fe: "forever", te: "tbc" };
        // Anna raided TBC only, Fenja Forever only, Both played both.
        const chars = [
            { character: "Anna", className: "Paladin", items: [{ eventId: "te" }], categoryIds: [] },
            { character: "Fenja", className: "Mage", items: [{ eventId: "fe" }], categoryIds: [] },
            { character: "Both", className: "Rogue", items: [{ eventId: "te" }, { eventId: "fe" }], categoryIds: [] },
        ];

        beforeEach(() => {
            auth.getUser.mockReturnValue(admin);
            auth.checkCsrf.mockReturnValue(true);
            raidEventStore.versionOfRaidEvent = jest.fn((id) => STORED[id] || "");
            characterInfo.annotatedCharacters.mockReturnValue(chars);
            settingsStore.getConfig.mockReturnValue({ mainVersion: "tbc" });
            activeGuildFor.mockReturnValue("guild-1");
        });
        afterEach(() => {
            delete raidEventStore.versionOfRaidEvent;
            characterInfo.annotatedCharacters.mockReturnValue([]);
            settingsStore.getConfig.mockReturnValue({});
            activeGuildFor.mockReturnValue("");
            discord.listCategories.mockReturnValue([]);
        });

        describe("GET /api/history", () => {
            it("answers the raids, loot buckets and characters of the asked version only, the picker keeps every version", async () => {
                raidEventGroups.loadEventGroups.mockResolvedValue({
                    groups: [{ categoryId: "cat1", events: [
                        { id: "te", title: "Kara", startTime: 100, versionId: "tbc" },
                        { id: "fe", title: "Ony", startTime: 200, versionId: "forever" },
                    ] }],
                    error: null,
                });
                dashboardData.annotateUpcomingExtras.mockImplementation((rows) => rows);
                dashboardData.loadRecentEvents.mockResolvedValue({ events: [{ id: "te", versionId: "tbc" }, { id: "fe", versionId: "forever" }], error: null });
                lootStore.eventsWithLoot.mockReturnValue([{ eventId: "te", label: "Kara" }, { eventId: "fe", label: "Ony" }]);
                try {
                    const forever = json(await get("/api/history", { version: "forever" })).data;
                    expect(forever.events.map((e) => e.id)).toEqual(["fe"]);
                    expect(forever.upcomingRaids.events.map((e) => e.id)).toEqual(["fe"]);
                    expect(forever.pastRaids.events.map((e) => e.id)).toEqual(["fe"]);
                    expect(forever.lootEvents.map((e) => e.eventId)).toEqual(["fe"]);
                    expect(forever.chars.map((c) => c.character)).toEqual(["Fenja", "Both"]);
                    expect(forever.versions.map((v) => v.id)).toEqual(["tbc", "forever"]);

                    const tbc = json(await get("/api/history")).data;
                    expect(tbc.events.map((e) => e.id)).toEqual(["te"]);
                    expect(tbc.pastRaids.events.map((e) => e.id)).toEqual(["te"]);
                    expect(tbc.lootEvents.map((e) => e.eventId)).toEqual(["te"]);
                    expect(tbc.chars.map((c) => c.character)).toEqual(["Anna", "Both"]);
                } finally {
                    dashboardData.annotateUpcomingExtras.mockReset();
                    raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: null });
                    dashboardData.loadRecentEvents.mockResolvedValue({ events: [], error: null });
                    lootStore.eventsWithLoot.mockReturnValue([]);
                }
            });

            it("answers the main version while the others are hidden, whatever is asked (#563)", async () => {
                settingsStore.getConfig.mockReturnValue({ mainVersion: "tbc", hideOtherVersions: true });
                lootStore.eventsWithLoot.mockReturnValue([{ eventId: "te", label: "Kara" }, { eventId: "fe", label: "Ony" }]);
                try {
                    const data = json(await get("/api/history", { version: "forever" })).data;
                    expect(data.lootEvents.map((e) => e.eventId)).toEqual(["te"]);
                    expect(data.chars.map((c) => c.character)).toEqual(["Anna", "Both"]);
                } finally {
                    lootStore.eventsWithLoot.mockReturnValue([]);
                }
            });
        });

        describe("GET /api/history/loot-picker", () => {
            it("offers the characters of the event's version", async () => {
                const forever = json(await get("/api/history/loot-picker", { event: "fe" })).data;
                expect(forever.characters.map((c) => c.character)).toEqual(["Fenja", "Both"]);
                const tbc = json(await get("/api/history/loot-picker", { event: "te" })).data;
                expect(tbc.characters.map((c) => c.character)).toEqual(["Anna", "Both"]);
            });

            it("takes the page's version for an event with no stored one (a hand-made bucket)", async () => {
                const data = json(await get("/api/history/loot-picker", { event: "manual-x", version: "forever" })).data;
                expect(data.characters.map((c) => c.character)).toEqual(["Fenja", "Both"]);
            });
        });

        describe("POST /api/history/loot-add", () => {
            const entry = { event: "fe", itemId: 30095, character: "Anna", boss: "Leotheras the Blind", response: "Mainspec", awardedAt: 5000 };
            beforeEach(() => {
                lootStore.addImport.mockReturnValue({ added: 1, skipped: 0 });
                raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "cat1", events: [{ id: "fe", title: "Ony" }, { id: "te", title: "Kara" }] }] });
            });
            afterEach(() => raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: null }));

            it("refuses a known character that does not play the event's version", async () => {
                const res = await post("/api/history/loot-add", entry);
                expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                expect(json(res).error.code).toBe("wrong_version");
                expect(json(res).error.message).toContain("Anna");
                expect(lootStore.addImport).not.toHaveBeenCalled();
            });

            it("files it for a character of that version, and for a name nobody knows yet (a trial)", async () => {
                expect((await post("/api/history/loot-add", { ...entry, character: "Fenja" })).writeHead).toHaveBeenCalledWith(201, expect.any(Object));
                expect((await post("/api/history/loot-add", { ...entry, character: "Neuling" })).writeHead).toHaveBeenCalledWith(201, expect.any(Object));
                expect((await post("/api/history/loot-add", { ...entry, event: "te" })).writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            });
        });

        describe("POST /api/history/import", () => {
            it("matches the date among the raids of the import's version only", async () => {
                lootImport.parseLoot.mockReturnValue([{ itemName: "Sword" }]);
                lootImport.detectImportDate.mockReturnValue(1234);
                raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "cat1", events: [
                    { id: "te", title: "Kara", versionId: "tbc" }, { id: "fe", title: "Ony", versionId: "forever" },
                ] }] });
                lootStore.addImport.mockReturnValue({ added: 1, skipped: 0 });
                try {
                    await post("/api/history/import", { data: "text", event: "__auto__", version: "forever" });
                    expect(lootEventMatch.bestDayMatch).toHaveBeenLastCalledWith(1234, [expect.objectContaining({ id: "fe" })]);
                    // nothing known about the version: as before, every raid
                    await post("/api/history/import", { data: "text", event: "__auto__" });
                    expect(lootEventMatch.bestDayMatch).toHaveBeenLastCalledWith(1234, [expect.objectContaining({ id: "te" }), expect.objectContaining({ id: "fe" })]);
                    // others hidden: the main version
                    settingsStore.getConfig.mockReturnValue({ mainVersion: "tbc", hideOtherVersions: true });
                    await post("/api/history/import", { data: "text", event: "__auto__", version: "forever" });
                    expect(lootEventMatch.bestDayMatch).toHaveBeenLastCalledWith(1234, [expect.objectContaining({ id: "te" })]);
                } finally {
                    lootImport.detectImportDate.mockReturnValue(null);
                    raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: null });
                }
            });

            it("refuses a category of a hidden version (#563)", async () => {
                settingsStore.getConfig.mockReturnValue({ mainVersion: "tbc", hideOtherVersions: true, categoryVersion: { catF: "forever" } });
                lootImport.parseLoot.mockReturnValue([{ itemName: "Sword" }]);
                const hiddenCat = await post("/api/history/import", { data: "text", event: "__manual__", manualLabel: "x", categoryId: "catF" });
                expect(hiddenCat.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
                expect(json(hiddenCat).error.code).toBe("bad_category");
                lootStore.addImport.mockReturnValue({ added: 1, skipped: 0 });
                const shownCat = await post("/api/history/import", { data: "text", event: "__manual__", manualLabel: "x", categoryId: "catT" });
                expect(shownCat.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            });
        });

        describe("GET /api/history/char", () => {
            beforeEach(() => {
                lootStore.listByCharacter.mockReturnValue([{ eventId: "te" }, { eventId: "fe" }]);
                charGear._resetForTests();
            });
            afterEach(() => lootStore.listByCharacter.mockReturnValue([]));

            it("takes the asked version of a character that plays both", async () => {
                const data = json(await get("/api/history/char", { name: "Both", version: "forever" })).data;
                expect(data).toMatchObject({ versionId: "forever", versionIds: ["tbc", "forever"] });
            });

            it("does not serve a hidden version: the main one is asked (#563)", async () => {
                settingsStore.getConfig.mockReturnValue({ mainVersion: "tbc", hideOtherVersions: true });
                const data = json(await get("/api/history/char", { name: "Both", version: "forever" })).data;
                expect(data.versionId).toBe("tbc");
            });
        });
    });
});
