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
jest.mock("../../../src/web/activeGuild", () => ({ activeGuildFor: jest.fn(() => "") }));
// The account's menu language: none saved unless a test says otherwise.
jest.mock("../../../src/stores/userPrefsStore", () => ({
    getLang: jest.fn(() => ""),
    setLang: jest.fn((userId, lang) => (["de", "en"].includes(String(lang).trim().toLowerCase()) ? { lang: String(lang).trim().toLowerCase() } : { code: "unknown_lang" })),
}));
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
jest.mock("../../../src/stores/raidEventStore", () => ({
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
jest.mock("../../../src/web/setupEditor", () => ({
    ...jest.requireActual("../../../src/web/setupEditor"),
    raidHelperSlots: (...args) => mockRaidHelperSlots(...args),
}));
const auth = require("../../../src/web/auth");
const settingsStore = require("../../../src/stores/settingsStore");
const { activeGuildFor } = require("../../../src/web/activeGuild");
const discord = require("../../../src/web/discord");
const { AREA_IDS, emptyAccess, fullAccess } = require("../../../src/config/permissions");
const { post, handle } = routerClient(require("../../../src/web/apiRoutes/session"));

describe("web/apiRoutes/session", () => {
    describe("GET /api/session", () => {
        it("returns user + csrfToken + guilds + activeGuildId for a logged-in admin", async () => {
            auth.getUser.mockReturnValue({ id: "42", name: "Anna", isAdmin: true });
            auth.getRealUser.mockReturnValue({ id: "42", name: "Anna", isAdmin: true });
            auth.csrfToken.mockReturnValue("csrf-abc");
            discord.listGuilds.mockReturnValue([{ id: "g1", name: "Meine Gilde" }]);
            activeGuildFor.mockReturnValue("g1");
            const res = mockRes();
            const handled = await handle("/api/session", { method: "GET" }, res);
            expect(handled).toBe(true);
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            const data = json(res).data;
            // a full admin may look at the menu as a role ("Ansicht als Rolle")
            expect(data.user).toEqual({ id: "42", name: "Anna", isAdmin: true, access: fullAccess(), canViewAs: true });
            expect(data.csrfToken).toBe("csrf-abc");
            expect(data.guilds).toEqual([{ id: "g1", name: "Meine Gilde", role: "" }]);
            expect(data.activeGuildId).toBe("g1");
            expect(data.areas.map((a) => a.id)).toEqual(AREA_IDS);
        });

        // The switcher shows the fixed role of a server as a badge (#251).
        it("tags the event and the talk server in the guild list", async () => {
            auth.getUser.mockReturnValue({ id: "42", name: "Anna", isAdmin: true });
            settingsStore.getConfig.mockReturnValue({ guildId: "g1", discordServers: { talkGuildId: "g2" } });
            discord.listGuilds.mockReturnValue([{ id: "g1", name: "Events" }, { id: "g2", name: "Talk" }, { id: "g3", name: "Andere" }]);
            const res = mockRes();
            await handle("/api/session", { method: "GET" }, res);
            expect(json(res).data.guilds.map((g) => g.role)).toEqual(["event", "talk", ""]);
            settingsStore.getConfig.mockReturnValue({});
        });

        it("returns user: null, no csrfToken, and no guilds for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            await handle("/api/session", { method: "GET" }, res);
            expect(auth.csrfToken).not.toHaveBeenCalled();
            const data = json(res).data;
            expect(data).toMatchObject({ user: null, csrfToken: null, guilds: [], activeGuildId: "" });
        });

        it("returns no guilds for a logged-in caller with no area at all", async () => {
            auth.getUser.mockReturnValue({ id: "7", name: "Bob", isAdmin: false });
            auth.getRealUser.mockReturnValue({ id: "7", name: "Bob", isAdmin: false });
            auth.csrfToken.mockReturnValue("csrf-bob");
            discord.listGuilds.mockReturnValue([{ id: "g1", name: "Meine Gilde" }]);
            const res = mockRes();
            await handle("/api/session", { method: "GET" }, res);
            const data = json(res).data;
            expect(data.user).toEqual({ id: "7", name: "Bob", isAdmin: false, access: emptyAccess(), canViewAs: false });
            expect(data.guilds).toEqual([]);
            expect(data.activeGuildId).toBe("");
        });

        // A limited user still needs the guild switcher to load anything.
        it("returns the guilds for a non-admin who holds at least one area", async () => {
            auth.getUser.mockReturnValue({
                id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), raids: { read: true, write: false } },
            });
            auth.csrfToken.mockReturnValue("csrf-bob");
            discord.listGuilds.mockReturnValue([{ id: "g1", name: "Meine Gilde" }]);
            activeGuildFor.mockReturnValue("g1");
            const res = mockRes();
            await handle("/api/session", { method: "GET" }, res);
            const data = json(res).data;
            expect(data.guilds).toEqual([{ id: "g1", name: "Meine Gilde", role: "" }]);
            expect(data.activeGuildId).toBe("g1");
            expect(data.user.access.raids).toEqual({ read: true, write: false });
        });
    });

    describe("POST /api/session/guild", () => {
        it("returns 403 when the CSRF token is invalid", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(false);
            const res = await post("/api/session/guild", { guildId: "g1" });
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "csrf", message: expect.any(String) } });
            expect(auth.setActiveGuild).not.toHaveBeenCalled();
        });

        it("returns 400 for an unknown guildId", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            discord.listGuilds.mockReturnValue([{ id: "g1", name: "Meine Gilde" }]);
            const res = await post("/api/session/guild", { guildId: "does-not-exist" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "unknown_guild", message: expect.any(String) } });
            expect(auth.setActiveGuild).not.toHaveBeenCalled();
        });

        it("switches to the given guild on success", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            discord.listGuilds.mockReturnValue([{ id: "g1", name: "Meine Gilde" }]);
            const res = await post("/api/session/guild", { guildId: "g1" });
            expect(auth.setActiveGuild).toHaveBeenCalledWith(expect.any(Object), "g1");
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(json(res)).toEqual({ data: { activeGuildId: "g1" } });
        });

        it("clears the selection when guildId is empty", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            discord.listGuilds.mockReturnValue([{ id: "g1", name: "Meine Gilde" }]);
            const res = await post("/api/session/guild", { guildId: "" });
            expect(auth.setActiveGuild).toHaveBeenCalledWith(expect.any(Object), "");
            expect(json(res)).toEqual({ data: { activeGuildId: "" } });
        });
    });

    describe("Ansicht als Rolle — /api/session/view-as", () => {
        const RAIDER = "111111111111111111";
        const admin = { id: "42", name: "Anna", isAdmin: true, access: fullAccess() };
        // While the view runs, the gate only sees the role's rights — here: nothing at all.
        const viewed = { ...admin, isAdmin: false, access: emptyAccess(), viewAs: { roleIds: [RAIDER], at: 1 } };

        beforeEach(() => {
            auth.setViewAs.mockClear();
            discord.listRoles.mockReturnValue([{ id: RAIDER, name: "Raider", color: "#aabbcc" }, { id: "999999999999999999", name: "Gast", color: "" }]);
            settingsStore.getConfig.mockReturnValue({ ...settingsStore.getConfig(), guildId: "g1", adminRoleIds: [], rolePermissions: { [RAIDER]: { signup: { read: true, write: true } } } });
        });

        it("lists the roles for a real full admin, marked with what is configured", async () => {
            auth.getUser.mockReturnValue(admin);
            auth.getRealUser.mockReturnValue(admin);
            const res = mockRes();
            await handle("/api/session/view-as", { method: "GET" }, res);
            expect(json(res).data.roles).toEqual([
                { id: RAIDER, name: "Raider", color: "#aabbcc", admin: false, configured: true },
                { id: "999999999999999999", name: "Gast", color: "", admin: false, configured: false },
            ]);
        });

        it("refuses anyone who is not a full admin by their own rights", async () => {
            const member = { id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), signup: { read: true, write: true } } };
            auth.getUser.mockReturnValue(member);
            auth.getRealUser.mockReturnValue(member);
            auth.checkCsrf.mockReturnValue(true);
            const list = mockRes();
            await handle("/api/session/view-as", { method: "GET" }, list);
            expect(list.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            const start = await post("/api/session/view-as", { roleIds: [RAIDER] });
            expect(start.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(auth.setViewAs).not.toHaveBeenCalled();
        });

        it("starts the view with known roles only", async () => {
            auth.getUser.mockReturnValue(admin);
            auth.getRealUser.mockReturnValue(admin);
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/session/view-as", { roleIds: [RAIDER, "123456789012345678"] });
            expect(auth.setViewAs).toHaveBeenCalledWith(expect.anything(), [RAIDER]);
            expect(json(res)).toEqual({ data: { viewAs: { roleIds: [RAIDER] } } });
        });

        it("stops the view even though the viewed role may open nothing — and needs the CSRF token", async () => {
            auth.getUser.mockReturnValue(viewed);
            auth.getRealUser.mockReturnValue(admin);
            auth.checkCsrf.mockReturnValue(false);
            const refused = await post("/api/session/view-as", { stop: true });
            expect(refused.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(auth.setViewAs).not.toHaveBeenCalled();
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/session/view-as", { stop: true });
            expect(auth.setViewAs).toHaveBeenCalledWith(expect.anything(), null);
            expect(json(res)).toEqual({ data: { viewAs: null } });
        });

        it("reports the running view with role names in the session, while the rest of the menu is gated by the role", async () => {
            auth.getUser.mockReturnValue(viewed);
            auth.getRealUser.mockReturnValue(admin);
            const res = mockRes();
            await handle("/api/session", { method: "GET" }, res);
            const user = json(res).data.user;
            expect(user.isAdmin).toBe(false);
            expect(user.canViewAs).toBe(true);
            expect(user.viewAs).toEqual({ roleIds: [RAIDER], roleNames: ["Raider"], at: 1 });
            // any other endpoint follows the role's (empty) rights
            const dash = mockRes();
            await handle("/api/dashboard", { method: "GET" }, dash);
            expect(dash.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
        });
    });

    describe("POST /api/session/lang", () => {
        const userPrefs = require("../../../src/stores/userPrefsStore");

        it("saves the language for the caller's own account", async () => {
            auth.getUser.mockReturnValue({ id: "42", name: "Anna", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/session/lang", { lang: "en" });
            expect(userPrefs.setLang).toHaveBeenCalledWith("42", "en");
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(json(res)).toEqual({ data: { lang: "en" } });
        });

        it("is open to a limited member, not only to admins", async () => {
            auth.getUser.mockReturnValue({ id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), signup: { read: true, write: true } } });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/session/lang", { lang: "de" });
            expect(userPrefs.setLang).toHaveBeenCalledWith("7", "de");
            expect(json(res)).toEqual({ data: { lang: "de" } });
        });

        it("refuses an unknown language with 400", async () => {
            auth.getUser.mockReturnValue({ id: "42", name: "Anna", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/session/lang", { lang: "fr" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "unknown_lang", message: expect.any(String) } });
        });

        it("needs the CSRF token and a login", async () => {
            auth.getUser.mockReturnValue({ id: "42", name: "Anna", isAdmin: true });
            auth.checkCsrf.mockReturnValue(false);
            const res = await post("/api/session/lang", { lang: "en" });
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            auth.getUser.mockReturnValue(null);
            const anon = await post("/api/session/lang", { lang: "en" });
            expect(anon.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(userPrefs.setLang).not.toHaveBeenCalled();
        });

        it("hands the saved language out with the session", async () => {
            auth.getUser.mockReturnValue({ id: "42", name: "Anna", isAdmin: true });
            userPrefs.getLang.mockReturnValueOnce("en");
            const res = mockRes();
            await handle("/api/session", { method: "GET" }, res);
            expect(userPrefs.getLang).toHaveBeenCalledWith("42");
            expect(json(res).data.user.lang).toBe("en");
        });
    });
});
