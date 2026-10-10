const { mockRes, json, routerClient } = require("../../helpers/http");

jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(),
    // "Ansicht als Rolle": the caller's own rights, and starting/stopping the view
    getRealUser: jest.fn(),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(),
    setActiveGuild: jest.fn(),
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
}));
jest.mock("../../../src/services/events/raidEventGroups", () => ({
    loadEventGroups: jest.fn(() => Promise.resolve({ groups: [], error: null })),
    eventLookbackSince: jest.fn(() => 0),
    fetchEventsCached: jest.fn(() => Promise.resolve({ events: [] })),
}));
// The row shaping is pure and runs for real; the past-raid load rescans the
// event snapshot and has its own test (raidListing.test.js).
jest.mock("../../../src/services/events/raidListing", () => ({
    ...jest.requireActual("../../../src/services/events/raidListing"),
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
const auth = require("../../../src/web/http/auth");
const settingsStore = require("../../../src/stores/settingsStore");
const { activeGuildFor } = require("../../../src/web/http/activeGuild");
const discord = require("../../../src/services/discord/discord");
const raidEventGroups = require("../../../src/services/events/raidEventGroups");
const raidEventStore = require("../../../src/stores/raidEventStore");
const raidListing = require("../../../src/services/events/raidListing");
const eventSoftresStore = require("../../../src/stores/eventSoftresStore");
const { post, handle, get } = routerClient(require("../../../src/web/apiRoutes/raids"));
const { knownChannels } = require("../../helpers/linkCheck");

// The Discord channels these tests link exist (#537: only a link to an existing channel is shown).
beforeEach(() => knownChannels("c1", "c-old", "c-new", "c-snap"));

describe("web/apiRoutes/raids", () => {
    describe("GET /api/raids", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            await handle("/api/raids", { method: "GET" }, res);
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(raidEventGroups.loadEventGroups).not.toHaveBeenCalled();
        });

        it("returns the active guild's upcoming events as flat rows with content and raid size", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [
                    { id: "e1", title: "Kara", startTime: 100, channelId: "c1", channelName: "kara-mo", signupCount: 7 },
                ] }],
                error: null,
            });
            eventSoftresStore.getEventSoftres.mockReturnValueOnce({ url: "https://softres.it/raid/x", editUrl: "secret" });
            discord.listGuilds.mockReturnValueOnce([{ id: "guild-0", name: "Andere" }, { id: "guild-1", name: "Pulse" }]);

            const res = await get("/api/raids");

            expect(raidEventGroups.loadEventGroups).toHaveBeenCalledWith("guild-1");
            expect(json(res)).toEqual({
                data: {
                    events: [{
                        id: "e1", source: "raidhelper", title: "Kara", startTime: 100, channelId: "c1", channelName: "kara-mo", channelState: "ok",
                        categoryId: "cat1", categoryName: "Raids", signupCount: 7,
                        contentIds: ["kara"], contentSources: ["title"], raidSize: 10, raidSizeKnown: true,
                        // only the public link — the edit url is the softres admin key
                        softres: { url: "https://softres.it/raid/x" },
                        // no category override in the (mocked, empty) config: the main version, "tbc".
                        versionId: "tbc",
                    }],
                    error: null,
                    activeGuildId: "guild-1",
                    guildName: "Pulse",
                    // The version filter (#545): nothing asked = the main version, and its choices.
                    version: "tbc",
                    mainVersion: "tbc",
                    versions: [{ id: "tbc", label: "TBC Anniversary", short: "TBC", count: 1 }],
                },
            });
        });

        it("passes the Raid-Helper API error through instead of failing the request", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: "Raid-Helper nicht erreichbar." });

            const res = await get("/api/raids");

            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(json(res)).toEqual({
                data: {
                    events: [], error: "Raid-Helper nicht erreichbar.", activeGuildId: "guild-1", guildName: "",
                    version: "tbc", mainVersion: "tbc", versions: [{ id: "tbc", label: "TBC Anniversary", short: "TBC", count: 0 }],
                },
            });
        });

        it("filters by game version (#545): default the main version, 'all' for every one", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [
                    { id: "e1", title: "Kara", startTime: 100, channelId: "c1", channelName: "kara-mo" },
                    { id: "e2", title: "Barrow Deeps", startTime: 200, channelId: "c2", channelName: "bd-mo", versionId: "forever" },
                ] }],
                error: null,
            });

            const byDefault = await get("/api/raids");
            expect(json(byDefault).data.events.map((e) => e.id)).toEqual(["e1"]);

            const forever = await get("/api/raids", { version: "forever" });
            expect(json(forever).data.events.map((e) => e.id)).toEqual(["e2"]);
            expect(json(forever).data.version).toBe("forever");

            const all = await get("/api/raids", { version: "all" });
            expect(json(all).data.events.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
            expect(json(all).data.version).toBe("");
        });

        // Oct 2026: raids of foreign categories are the orga's (services/signups/eventVisibility.js) -
        // a raider role holding raids read (or write) sees its categories and its own signups only.
        describe("a raider role", () => {
            const RAIDER = { id: "u1", name: "Rai", isAdmin: false, access: { raids: { read: true, write: true } } };
            const ORGA_ROLE = { id: "o1", name: "Lead", isAdmin: false, isOrga: true, access: { raids: { read: true, write: true } } };
            const rosterStore = require("../../../src/stores/rosterStore");
            let rosterSpy;
            beforeEach(() => {
                activeGuildFor.mockReturnValue("guild-1");
                // "mo" for the role r-mo, "mi" open to everybody, "foreign" no event category at all
                settingsStore.getConfig.mockReturnValue({ categoryIds: ["mo", "mi"], categoryRoles: { mo: ["r-mo"] } });
                discord.memberRoleIds = jest.fn(async () => []);
                rosterSpy = jest.spyOn(rosterStore, "rosterForCategory").mockReturnValue(null);
                raidEventGroups.loadEventGroups.mockResolvedValue({
                    groups: [
                        { categoryId: "mo", categoryName: "Mo", events: [{ id: "e-mo", title: "Kara", startTime: 100, channelId: "c1", signUps: [] }] },
                        { categoryId: "mi", categoryName: "Mi", events: [{ id: "e-mi", title: "Kara", startTime: 200, channelId: "c1", signUps: [] }] },
                        { categoryId: "foreign", categoryName: "PuG", events: [
                            { id: "e-pug", title: "Kara", startTime: 300, channelId: "c1", signUps: [] },
                            { id: "e-mine", title: "Kara", startTime: 400, channelId: "c1", signUps: [{ userId: "u1", status: "signed" }] },
                        ] },
                    ],
                    error: null,
                });
            });
            afterEach(() => {
                rosterSpy.mockRestore();
                settingsStore.getConfig.mockReturnValue({});
                delete discord.memberRoleIds;
            });
            const ids = async (user) => {
                auth.getUser.mockReturnValue(user);
                return json(await get("/api/raids")).data.events.map((e) => e.id);
            };

            it("sees the open categories and the raids they signed up for, not the foreign ones", async () => {
                expect(await ids(RAIDER)).toEqual(["e-mi", "e-mine"]);
                expect(discord.memberRoleIds).toHaveBeenCalledWith("guild-1", "u1");
            });

            it("sees a category of their raider role", async () => {
                discord.memberRoleIds.mockResolvedValue(["r-mo"]);
                expect(await ids(RAIDER)).toEqual(["e-mo", "e-mi", "e-mine"]);
            });

            it("sees the raids of a category whose roster opened them", async () => {
                rosterSpy.mockImplementation((cat) => (cat === "foreign" ? { categoryId: "foreign", publicRaids: true, members: {} } : null));
                expect(await ids(RAIDER)).toEqual(["e-mi", "e-pug", "e-mine"]);
            });

            it("leaves the orga role every raid, without asking Discord", async () => {
                expect(await ids(ORGA_ROLE)).toEqual(["e-mo", "e-mi", "e-pug", "e-mine"]);
                expect(discord.memberRoleIds).not.toHaveBeenCalled();
            });

            it("gets the past raids filtered the same way and without their logs; the loot count stays", async () => {
                const row = (id, categoryId) => ({
                    id, categoryId, title: "BT", versionId: "tbc", lootCount: 3,
                    logs: [{ id: "l1", status: "done" }], pendingLogs: [{ title: "x", alsoFits: [] }], pendingLogCount: 1,
                });
                const past = { events: [row("p-mi", "mi"), row("p-pug", "foreign")], error: null };
                raidListing.loadPastRaids.mockResolvedValue(past);
                auth.getUser.mockReturnValue(RAIDER);
                const raider = json(await get("/api/raids/past")).data.events;
                expect(raider.map((e) => e.id)).toEqual(["p-mi"]);
                expect(raider[0]).toMatchObject({ logs: [], pendingLogs: [], pendingLogCount: 0, lootCount: 3 });
                auth.getUser.mockReturnValue(ORGA_ROLE);
                const orga = json(await get("/api/raids/past")).data.events;
                expect(orga.map((e) => e.id)).toEqual(["p-mi", "p-pug"]);
                expect(orga[0]).toMatchObject({ logs: [{ id: "l1", status: "done" }], pendingLogCount: 1 });
            });
        });
    });

    describe("GET /api/raids/past", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            await handle("/api/raids/past", { method: "GET" }, res);
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(raidListing.loadPastRaids).not.toHaveBeenCalled();
        });

        it("returns the active guild's past raids", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            raidListing.loadPastRaids.mockResolvedValueOnce({ events: [{ id: "p1", title: "BT", versionId: "tbc" }], error: null });

            const res = await get("/api/raids/past");

            expect(raidListing.loadPastRaids).toHaveBeenCalledWith("guild-1");
            expect(json(res)).toEqual({
                data: {
                    events: [{ id: "p1", title: "BT", versionId: "tbc" }],
                    error: null,
                    activeGuildId: "guild-1",
                    version: "tbc",
                    mainVersion: "tbc",
                    versions: [{ id: "tbc", label: "TBC Anniversary", short: "TBC", count: 1 }],
                },
            });
        });

        it("filters past raids by game version (#545)", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            raidListing.loadPastRaids.mockResolvedValueOnce({
                events: [
                    { id: "p1", title: "BT", versionId: "tbc" },
                    { id: "p2", title: "Barrow Deeps", versionId: "forever" },
                ],
                error: null,
            });

            const res = await get("/api/raids/past", { version: "forever" });
            expect(json(res).data.events.map((e) => e.id)).toEqual(["p2"]);
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
            settingsStore.getConfig.mockReturnValue({ raidDefaults: { channelId: "c1" }, categoryRaidTemplate: { cat1: "tpl1", cat2: "tpl2" } });
            settingsStore.listRaidTemplates.mockReturnValue([
                { id: "tpl1", name: "GDKP Kara", raidhelperTemplateId: "t1" },
                // a default that links no Raid-Helper template gives the form nothing to send
                { id: "tpl2", name: "Ony", raidhelperTemplateId: "" },
            ]);
            discord.listTextChannels.mockReturnValue([{ id: "c1", name: "kara", category: "Raids", parentId: "cat1" }]);
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [
                    { id: "e1", title: "Kara", templateId: "t1", description: "desc", channelId: "c1", channelName: "kara", startTime: 50 },
                ] }],
                error: null,
            });
            raidEventGroups.eventLookbackSince.mockReturnValueOnce(1234);

            const res = mockRes();
            await handle("/api/raids/new", { method: "GET" }, res);

            // Past raids of the lookback window can be repeated too.
            expect(raidEventGroups.loadEventGroups).toHaveBeenCalledWith("guild-1", { sinceSeconds: 1234 });
            expect(json(res)).toMatchObject({
                data: {
                    // the default channel's category decides the preselected Raid-Helper template
                    defaults: { templateId: "t1", channelId: "c1" },
                    categoryTemplates: { cat1: "t1" },
                    leaderId: "42",
                    channels: [{ id: "c1", name: "kara", category: "Raids", parentId: "cat1" }],
                    templates: [
                        { id: "tpl1", name: "GDKP Kara", raidhelperTemplateId: "t1" },
                        { id: "tpl2", name: "Ony", raidhelperTemplateId: "" },
                    ],
                    reusableEvents: [{
                        id: "e1", source: "raidhelper", title: "Kara", templateId: "t1", description: "desc", channelId: "c1", channelName: "kara",
                        categoryId: "cat1", categoryName: "Raids", startTime: 50, contentIds: ["kara"],
                    }],
                    signupSources: {},
                    // #261: the planning step's material
                    categoryRaidTemplates: { cat1: "tpl1", cat2: "tpl2" },
                    raidTemplates: [
                        { id: "tpl1", defaultFor: ["cat1"], incomplete: false },
                        { id: "tpl2", defaultFor: ["cat2"] },
                    ],
                    defaultVersion: "tbc",
                    defaultSchema: "{tag}-{dd}-{mm}-{raid}",
                    editEvent: null,
                },
            });
            expect(json(res).data.versions.map((v) => v.id)).toEqual(["tbc", "classic", "forever"]);
            expect(json(res).data.categoryVersions).toEqual({});
        });

        it("names the main version and the categories that play another one (#541)", async () => {
            auth.getUser.mockReturnValue({ id: "42", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            settingsStore.getConfig.mockReturnValue({ mainVersion: "forever", categoryVersion: { cat1: "tbc" } });
            settingsStore.listRaidTemplates.mockReturnValue([]);
            discord.listTextChannels.mockReturnValue([]);
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: null });

            const res = mockRes();
            await handle("/api/raids/new", { method: "GET" }, res);
            expect(json(res).data).toMatchObject({ defaultVersion: "forever", categoryVersions: { cat1: "tbc" } });
        });
    });

    describe("POST /api/raids", () => {
        it("returns 400 for an invalid date", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/raids", { date: "not-a-date", channelId: "c1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "invalid_date", message: expect.any(String) } });
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
            expect(json(res)).toEqual({ data: { id: "ev1", channelId: "c1" } });
        });

        // The clone needs one thing from the source event: its channel. It is
        // asked for BY ID — the window scan it used to be looked up in could
        // drop it between opening the dialog and pressing the button, which is
        // what "Ausgangs-Event nicht gefunden" used to mean.
        it("clones the channel Raid-Helper names for the source event", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            mockGetEvent.mockResolvedValue({ id: "e1", channelId: "c-old" });
            discord.duplicateChannel.mockResolvedValue({ id: "c-new", name: "kara-clone" });
            mockCreateEvent.mockResolvedValue({ id: "ev2" });

            const res = await post("/api/raids", {
                date: "2026-07-12", time: "20:00", title: "Kara", sourceEventId: "e1", channelName: "kara-clone",
            });

            expect(mockGetEvent).toHaveBeenCalledWith("e1");
            expect(discord.duplicateChannel).toHaveBeenCalledWith("c-old", "kara-clone");
            expect(mockCreateEvent).toHaveBeenCalledWith(expect.objectContaining({ channelId: "c-new" }));
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
        });

        it("clones even when the window scan fails — it only names and sorts the channel (#285)", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            mockGetEvent.mockResolvedValue({ id: "e1", channelId: "c-old" });
            raidEventGroups.loadEventGroups.mockRejectedValue(new Error("Raid-Helper down"));
            discord.duplicateChannel.mockResolvedValue({ id: "c-new", name: "kara-clone" });
            mockCreateEvent.mockResolvedValue({ id: "ev2" });

            const res = await post("/api/raids", {
                date: "2026-07-12", time: "20:00", title: "Kara", sourceEventId: "e1", channelName: "kara-clone",
            });

            // the source channel still comes from Raid-Helper's event, never from the scan
            expect(discord.duplicateChannel).toHaveBeenCalledWith("c-old", "kara-clone");
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: null });
        });

        it("falls back to the stored snapshot when Raid-Helper does not know the event", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            mockGetEvent.mockResolvedValue(null);
            raidEventStore.getRaidEvent.mockReturnValue({ id: "e1", channelId: "c-snap" });
            discord.duplicateChannel.mockResolvedValue({ id: "c-new" });
            mockCreateEvent.mockResolvedValue({ id: "ev2" });

            await post("/api/raids", { date: "2026-07-12", time: "20:00", sourceEventId: "e1", channelName: "kara-clone" });

            expect(discord.duplicateChannel).toHaveBeenCalledWith("c-snap", "kara-clone");
        });

        it("falls back to the window scan for an event whose channel Discord lost", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            mockGetEvent.mockResolvedValue(null);
            raidEventStore.getRaidEvent.mockReturnValue(null);
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [{ id: "e1", channelId: "c-old" }] }],
                error: null,
            });
            discord.duplicateChannel.mockResolvedValue({ id: "c-new" });
            mockCreateEvent.mockResolvedValue({ id: "ev2" });

            await post("/api/raids", { date: "2026-07-12", time: "20:00", sourceEventId: "e1", channelName: "kara-clone" });

            expect(discord.duplicateChannel).toHaveBeenCalledWith("c-old", "kara-clone");
        });

        it("tells an unreachable Raid-Helper apart from an event that is gone", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            raidEventStore.getRaidEvent.mockReturnValue(null);
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: null });

            mockGetEvent.mockResolvedValue(null);
            const gone = await post("/api/raids", { date: "2026-07-12", time: "20:00", sourceEventId: "e1", channelName: "x" });
            expect(gone.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(gone).error.code).toBe("source_not_found");

            mockGetEvent.mockRejectedValue(new Error("ETIMEDOUT"));
            const down = await post("/api/raids", { date: "2026-07-12", time: "20:00", sourceEventId: "e1", channelName: "x" });
            expect(json(down).error.code).toBe("raidhelper_unreachable");
            expect(json(down).error.message).toMatch(/Raid-Helper antwortet gerade nicht/);
            expect(mockCreateEvent).not.toHaveBeenCalled();
        });

        it("returns 400 with Raid-Helper's reason when it rejects the event", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            mockCreateEvent.mockResolvedValue({ status: "failed", reason: "invalid token" });

            const res = await post("/api/raids", { date: "2026-07-12", time: "20:00", channelId: "c1" });

            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "create_failed", message: "invalid token" } });
        });
    });
});
