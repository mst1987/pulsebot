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
jest.mock("../../../src/web/logChannel", () => ({
    evaluateLog: jest.fn(),
    scanLogChannels: jest.fn(),
    backfillLogTitles: jest.fn(() => Promise.resolve(0)),
}));
jest.mock("../../../src/utils/logcheck/report", () => {
    class ReportError extends Error {}
    const CLA_FIELDS = ["consumables", "shadowResi", "drums", "potions", "sunder", "bossUptimes"];
    return {
        buildReport: jest.fn(),
        ReportError,
        // mirrors the real implementation closely enough for the route tests
        stripSection: jest.fn((report, section) => {
            const stripped = { ...report };
            for (const key of section === "rpb" ? ["rpb"] : CLA_FIELDS) stripped[key] = null;
            const remaining = (report.sections || []).filter((s) => s !== section);
            stripped.sections = remaining;
            return { report: stripped, remaining };
        }),
    };
});
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
jest.mock("../../../src/utils/setup/raidsheets", () => ({
    matchRaidsheet: jest.fn(() => null),
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
const mockDriveCopyFile = jest.fn();
const mockDriveDeleteFile = jest.fn(() => Promise.resolve());
const mockDriveShareAnyoneWriter = jest.fn(() => Promise.resolve());
jest.mock("../../../src/classes/drive", () =>
    jest.fn().mockImplementation(() => ({
        copyFile: mockDriveCopyFile,
        deleteFile: mockDriveDeleteFile,
        shareAnyoneWriter: mockDriveShareAnyoneWriter,
    })));
jest.mock("../../../src/classes/sheets", () => jest.fn().mockImplementation(() => ({})));
const mockFillSetupSheet = jest.fn();
jest.mock("../../../src/utils/setup/fillSetup", () => ({
    fillSetupSheet: (...args) => mockFillSetupSheet(...args),
}));
const mockRaidHelperSlots = jest.fn(() => []);
jest.mock("../../../src/web/setupEditor", () => ({
    ...jest.requireActual("../../../src/web/setupEditor"),
    raidHelperSlots: (...args) => mockRaidHelperSlots(...args),
}));
const auth = require("../../../src/web/http/auth");
const settingsStore = require("../../../src/stores/settingsStore");
const { activeGuildFor } = require("../../../src/web/http/activeGuild");
const discord = require("../../../src/services/discord/discord");
const raidEventGroups = require("../../../src/services/events/raidEventGroups");
const raidEventStore = require("../../../src/stores/raidEventStore");
const logStore = require("../../../src/stores/logStore");
const lootStore = require("../../../src/stores/lootStore");
const raiderCharactersStore = require("../../../src/stores/raiderCharactersStore");
const eventSheetStore = require("../../../src/stores/eventSheetStore");
const eventSoftresStore = require("../../../src/stores/eventSoftresStore");
const softres = require("../../../src/utils/loot/softres");
const wowhead = require("../../../src/utils/loot/wowhead");
const raidsheetsUtil = require("../../../src/utils/setup/raidsheets");
const { post, get } = routerClient(require("../../../src/web/apiRoutes/raidDetail"));

describe("web/apiRoutes/raidDetail", () => {
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

        it("serves an EventHelper event from the same shape: attendance from its own signups, no Raid-Helper raidplan", async () => {
            setupDefaults();
            const own = {
                id: "eh-1", source: "eventhelper", title: "Kara EH", startTime: 4000000000, channelId: "chan9",
                channelName: "kara-eh", categoryId: "cat1", signupCount: 1, size: 10, instanceIds: ["kara"],
                signUps: [{ userId: "1", specName: "Protection1", className: "Paladin", status: "signed" }],
                signUpsFromSnapshot: false,
            };
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "cat1", categoryName: "Raids", events: [own] }], error: null });
            settingsStore.getConfig.mockReturnValue({ categoryRoles: { cat1: ["role1"] } });
            discord.listMembersWithRoles.mockResolvedValue({ members: [{ id: "1", displayName: "Anna" }, { id: "2", displayName: "Bob" }], error: null });

            const res = await get("/api/raids/detail", { event: "eh-1" });

            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            const data = json(res).data;
            expect(data.event).toMatchObject({ id: "eh-1", source: "eventhelper", isPast: false, signupsKnown: true });
            expect(mockGetSetup).not.toHaveBeenCalled();
            expect(data.setup).toEqual({ total: 0, groups: [], roleCounts: {} });
            expect(data.setupError).toBeNull();
            expect(data.signupTarget).toBe(10);
            // #291: the softres suggestion comes from the event's raids, not from its title
            expect(data.softresSuggested).toEqual(["kara"]);
            expect(softres.parseInstancesFromTitle).not.toHaveBeenCalled();
            expect(data.attendance.responded.map((m) => [m.id, m.status])).toEqual([["1", "signed"]]);
            expect(data.attendance.missing.map((m) => m.id)).toEqual(["2"]);
            // no setup yet (#263): the way leads into the setup editor, and the payload names no raider
            expect(data.ownSetup).toBeNull();
            expect(data.progress.primary).toMatchObject({ tab: "setup", label: "Setup vorschlagen" });
            // …and the five-step cockpit (#319) rides along, so /raids can use the same answer later
            expect(data.steps.steps.map((s) => s.id)).toEqual(["created", "signup", "setup", "approval", "after"]);
            expect(data.steps.cancelled).toBe(false);
            expect(data.event).toMatchObject({ size: 10, signupDeadline: 0, autoSuggest: false });
            expect(data.ownSetupPost).toBeNull();
        });

        it("sends no step bar for a Raid-Helper event — it keeps today's view (#319)", async () => {
            setupDefaults();
            const res = await get("/api/raids/detail", { event: "e1" });
            const data = json(res).data;
            expect(data.event.source).toBe("raidhelper");
            expect(data.steps).toBeNull();
            expect(data.progress.steps.length).toBe(6);
        });

        it("carries the loot system and leaves the softres step out when it has no softres list", async () => {
            setupDefaults();
            const eventLootSystemStore = require("../../../src/stores/eventLootSystemStore");
            eventLootSystemStore.lootSystemOf.mockReturnValueOnce({ system: "lootcouncil", label: "Loot-Council", source: "category", softres: false });
            const data = json(await get("/api/raids/detail", { event: "e1" })).data;
            expect(data.lootSystem).toMatchObject({ system: "lootcouncil", softres: false });
            expect(data.progress.steps.map((s) => s.key)).not.toContain("softres");
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
            const data = json(res).data;
            expect(data.event).toEqual({
                id: "e1", source: "raidhelper", title: "GDKP Kara", startTime: 1753500000,
                channelId: "chan1", channelName: "kara-channel", signupCount: 1,
                isPast: true, signupsKnown: true, signUpsFromSnapshot: false,
                // a Raid-Helper event: its raid plan is off until the orga switches it on (docs/raidplan.md)
                raidplanEnabled: false, raidhelperDisabled: false,
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
                    status: "signed",
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
            // Every loot row carries the winner's class look (empty here — the
            // character store knows nobody in this test), see lootClassLook.js.
            expect(data.lootItems).toEqual([{
                eventId: "e1", itemName: "Sword", character: "Anna",
                className: "", spec: "", classColor: "", specIconUrl: "",
            }]);
            expect(data.lootTool).toBe("gargul");
            // The progress bar comes with the payload (raidDetailSteps.js): a past
            // raid with loot but no log points at the logs.
            expect(data.progress.steps.map((s) => s.key)).toEqual(["signup", "setup", "sheet", "softres", "loot", "logs"]);
            expect(data.progress.next).toBe("logs");
            expect(data.progress.primary).toMatchObject({ modal: "log" });
            // …and the player dialog's summary for every name on the page.
            expect(Object.keys(data.playerSummaries)).toEqual(["tankulus"]);
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
            const data = json(res).data;
            // each row carries which analyses already ran, so the UI can offer the
            // CLA and RPB buttons independently
            expect(data.eventLogs).toEqual([{ id: "l1", eventId: "e1", title: "Kara", sections: [] }]);
            expect(data.unlinkedLogs.map((l) => l.id)).toEqual(["l2"]);
        });

        it("reports the already-evaluated analyses per log", async () => {
            setupDefaults();
            logStore.listLogsForEvent.mockReturnValue([
                { id: "l1", eventId: "e1", status: "done", sections: ["cla"] },
                { id: "l4", eventId: "e1", status: "done" },   // legacy: counts as cla
            ]);
            logStore.listLogs.mockReturnValue([]);
            const res = await get("/api/raids/detail", { event: "e1" });
            const logs = json(res).data.eventLogs;
            expect(logs[0].sections).toEqual(["cla"]);
            expect(logs[1].sections).toEqual(["cla"]);
        });

        it("returns 404 when the event isn't found in any group", async () => {
            setupDefaults();
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: null });
            const res = await get("/api/raids/detail", { event: "missing" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "not_found", message: "Event nicht gefunden." } });
        });

        it("returns 400 when Raid-Helper events can't be loaded and no fallback event was found either", async () => {
            setupDefaults();
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: "Raid-Helper nicht erreichbar.", stale: true });
            const res = await get("/api/raids/detail", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "events_unavailable", message: "Raid-Helper nicht erreichbar." } });
        });

        it("still opens the page with an eventsWarning when the event was found via the stale/persisted fallback", async () => {
            setupDefaults();
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: groupsFull, error: "Raid-Helper nicht erreichbar.", stale: true,
            });
            const res = await get("/api/raids/detail", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(json(res).data.eventsWarning).toBe("Raid-Helper nicht erreichbar.");
        });

        it("omits eventsWarning when the data is fresh (not stale)", async () => {
            setupDefaults();
            const res = await get("/api/raids/detail", { event: "e1" });
            expect(json(res).data.eventsWarning).toBeNull();
        });

        it("sets setupError when the Raid-Helper raidplan can't be loaded", async () => {
            setupDefaults();
            mockGetSetup.mockRejectedValue(new Error("raidplan down"));
            const res = await get("/api/raids/detail", { event: "e1" });
            const data = json(res).data;
            expect(data.setup).toBeNull();
            expect(data.setupError).toBe("raidplan down");
            expect(data.tankCandidates).toEqual([]);
        });

        it("returns an empty setup when no raidplan has been created yet", async () => {
            setupDefaults();
            mockGetSetup.mockResolvedValue({ setup: [] });
            const res = await get("/api/raids/detail", { event: "e1" });
            const data = json(res).data;
            expect(data.setup).toEqual({ total: 0, groups: [], roleCounts: {} });
            expect(data.setupError).toBeNull();
        });

        it("leaves attendance inactive when the category has no raider roles configured", async () => {
            setupDefaults();
            settingsStore.getConfig.mockReturnValue({ categoryRoles: {} });
            const res = await get("/api/raids/detail", { event: "e1" });
            expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
            const data = json(res).data;
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
            const data = json(res).data;
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
            const data = json(res).data;
            expect(data.eventSheet).toBeNull();
            expect(data.eventSoftres).toBeNull();
            expect(data.signupTarget).toBe(2);
        });

        it("returns an empty lootItems array when nothing has been imported for the event", async () => {
            setupDefaults();
            lootStore.listByEvent.mockReturnValue([]);
            const res = await get("/api/raids/detail", { event: "e1" });
            expect(json(res).data.lootItems).toEqual([]);
            expect(json(res).data.lootTool).toBe("");
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
            const data = json(res).data;
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
            const data = json(res).data;

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
            const data = json(res).data;

            expect(data.setupError).toBeNull();
            expect(data.setup.total).toBe(1);
            expect(data.setupFromSnapshot).toBe(true);
        });

        it("still reports a raidplan error when there is no snapshot to fall back to", async () => {
            setupDefaults();
            mockGetSetup.mockRejectedValue(new Error("Raid-Helper down"));
            raidEventStore.getRaidEvent.mockReturnValue(null);

            const res = await get("/api/raids/detail", { event: "e1" });

            expect(json(res).data.setupError).toBe("Raid-Helper down");
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
            const data = json(res).data;
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
            const data = json(res).data;
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
            const data = json(res).data;
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
            const data = json(res).data;
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
            expect(json(res)).toEqual({ error: { code: "missing_fields", message: "Vorlage oder Channel fehlt." } });
            expect(discord.postAnnouncement).not.toHaveBeenCalled();
        });

        it("posts the announcement and returns the German success message", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getNotify.mockReturnValue({ id: "t1", title: "Anmeldung", body: "Bitte anmelden" });
            discord.postAnnouncement.mockResolvedValue({ guildId: "g1", channelId: "c1", messageId: "m1" });

            const res = await post("/api/raids/notify", { event: "e1", templateId: "t1", channelId: "c1", roleIds: ["r1", "r2"] });

            expect(discord.postAnnouncement).toHaveBeenCalledWith("c1", { id: "t1", title: "Anmeldung", body: "Bitte anmelden" }, ["r1", "r2"]);
            expect(json(res)).toEqual({ data: { message: "Anmelde-Aufruf gepostet." } });
        });

        it("returns 500 with the Discord error message on failure", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.getNotify.mockReturnValue({ id: "t1" });
            discord.postAnnouncement.mockRejectedValue(new Error("Channel nicht gefunden oder kein Textkanal."));

            const res = await post("/api/raids/notify", { event: "e1", templateId: "t1", channelId: "c1" });

            expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "post_failed", message: "Channel nicht gefunden oder kein Textkanal." } });
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
            expect(json(res)).toEqual({ error: { code: "events_unavailable", message: "Raid-Helper nicht erreichbar." } });
        });

        it("returns 404 when the event isn't found", async () => {
            setupDefaults();
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: null });
            const res = await post("/api/raids/ping-missing", { event: "missing" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "not_found", message: "Event nicht gefunden." } });
        });

        it("returns 400 when the category has no roles assigned", async () => {
            setupDefaults();
            settingsStore.getConfig.mockReturnValue({ categoryRoles: {} });
            const res = await post("/api/raids/ping-missing", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({
                error: { code: "no_roles", message: "Dieser Kategorie sind keine Rollen zugeordnet (Einstellungen → Kategorien)." },
            });
            expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
        });

        it("returns 400 when Discord members can't be fetched", async () => {
            setupDefaults();
            discord.listMembersWithRoles.mockResolvedValue({ members: [], error: "GuildMembers-Intent fehlt." });
            const res = await post("/api/raids/ping-missing", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "members_unavailable", message: "GuildMembers-Intent fehlt." } });
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
            expect(json(res).error.code).toBe("event_past");
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
            expect(json(res)).toEqual({ data: { message: "Niemand fehlt — es haben schon alle reagiert." } });
        });

        it("pings the missing raiders and reports the count", async () => {
            setupDefaults();
            discord.postMissingPing.mockResolvedValue({ channelId: "chan1", messageId: "m1" });

            const res = await post("/api/raids/ping-missing", { event: "e1", text: "Bitte melden" });

            expect(discord.postMissingPing).toHaveBeenCalledWith("chan1", ["2"], "Bitte melden");
            expect(json(res)).toEqual({ data: { message: "1 fehlende Raider gepingt." } });
        });

        it("returns 500 with the Discord error message on post failure", async () => {
            setupDefaults();
            discord.postMissingPing.mockRejectedValue(new Error("Channel nicht gefunden."));
            const res = await post("/api/raids/ping-missing", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "post_failed", message: "Channel nicht gefunden." } });
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
            expect(json(res)).toEqual({ error: { code: "sheet_not_found", message: "Raidsheet nicht gefunden." } });
        });

        it("refuses an EventHelper event without an approved setup — a draft never fills a sheet", async () => {
            setupDefaults();
            mockRaidHelperSlots.mockReturnValue([]);
            const res = await post("/api/raids/fill", { event: "eh-1", sheetId: "sheet1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res).error.code).toBe("no_approved_setup");
            expect(mockGetSetup).not.toHaveBeenCalled();
            expect(mockDriveCopyFile).not.toHaveBeenCalled();
        });

        it("fills an EventHelper event's sheet from its approved setup, without asking Raid-Helper", async () => {
            setupDefaults();
            const slots = [{ id: "u1", name: "Anna", specName: "Holy1", className: "Paladin", groupNumber: 1, slotNumber: 1 }];
            mockRaidHelperSlots.mockReturnValue(slots);
            const res = await post("/api/raids/fill", { event: "eh-1", sheetId: "sheet1" });
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(mockGetSetup).not.toHaveBeenCalled();
            expect(mockFillSetupSheet).toHaveBeenCalledWith(expect.anything(), slots, expect.any(Object));
        });

        it("returns 400 when the raidsheet has no spreadsheetId", async () => {
            setupDefaults();
            settingsStore.getRaidsheet.mockReturnValue({ id: "sheet1", name: "Kara Sheet", spreadsheetId: "" });
            const res = await post("/api/raids/fill", { event: "e1", sheetId: "sheet1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({
                error: { code: "no_spreadsheet_id", message: "Raidsheet hat keine Spreadsheet-ID (in den Einstellungen ergänzen)." },
            });
        });

        it("returns 400 when the Raid-Helper setup is empty, and cleans up the orphan copy", async () => {
            setupDefaults();
            mockGetSetup.mockResolvedValue({ setup: [] });
            const res = await post("/api/raids/fill", { event: "e1", sheetId: "sheet1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "empty_setup", message: "Setup nicht gefunden oder leer." } });
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
            expect(json(res)).toEqual({ error: { code: "empty_setup", message: "Setup nicht gefunden oder leer." } });
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
            expect(json(res).data.message).toMatch(/^Neues Sheet erstellt & gefüllt: 1 Spieler\. Wird am \d{2}\.\d{2}\.\d{4} automatisch gelöscht\.$/);
            expect(json(res).data.playerCount).toBe(1);
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
            expect(json(res).data.playerCount).toBe(1);
        });

        it("returns 500 with the error message on a generic failure", async () => {
            setupDefaults();
            mockDriveCopyFile.mockRejectedValue(new Error("Drive lieferte keine Datei-ID für die Kopie."));
            const res = await post("/api/raids/fill", { event: "e1", sheetId: "sheet1" });
            expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "fill_failed", message: "Drive lieferte keine Datei-ID für die Kopie." } });
        });
    });

    describe("POST /api/raids/post-sheet", () => {
        const event1 = { id: "e1", title: "GDKP Kara", channelId: "chan1" };

        function setupDefaults() {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            eventSheetStore.getEventSheet.mockReturnValue({ eventId: "e1", url: "https://sheet.example/1" });
            // Back to "the raid's own copy wins" — individual cases below override
            // this to exercise the category-sheet fallback.
            settingsStore.resolveEventSheetLink.mockImplementation((eventSheet) => (eventSheet && eventSheet.url
                ? { url: eventSheet.url, name: eventSheet.sheetName || "", source: "event" }
                : null));
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [event1] }], error: null,
            });
        }

        it("returns 400 when neither a filled nor a category sheet exists", async () => {
            setupDefaults();
            eventSheetStore.getEventSheet.mockReturnValue(null);
            settingsStore.resolveEventSheetLink.mockReturnValue(null);
            const res = await post("/api/raids/post-sheet", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res).error.code).toBe("no_sheet");
            expect(discord.postLink).not.toHaveBeenCalled();
        });

        // With a fixed sheet assigned to the raid's category there is no fill
        // record to hang the posted message ids on, so one is created.
        it("posts the category's fixed sheet when the raid has no copy of its own", async () => {
            setupDefaults();
            eventSheetStore.getEventSheet.mockReturnValue(null);
            settingsStore.resolveEventSheetLink.mockReturnValue({
                url: "https://sheet.example/fix", name: "SSC/TK Setup", source: "category",
            });
            discord.postLink.mockResolvedValue({ channelId: "chan1", messageId: "m1" });

            const res = await post("/api/raids/post-sheet", { event: "e1", message: "Bitte eintragen" });

            expect(settingsStore.resolveEventSheetLink).toHaveBeenCalledWith(null, "cat1");
            expect(discord.postLink).toHaveBeenCalledWith("chan1", expect.objectContaining({
                url: "https://sheet.example/fix",
            }));
            expect(eventSheetStore.markEventSheetPosted).toHaveBeenCalledWith("e1", {
                channelId: "chan1", messageId: "m1", message: "Bitte eintragen", createIfMissing: true,
            });
            expect(json(res)).toEqual({ data: { message: "Raidsheet in den Channel gepostet." } });
        });

        it("returns 400 when Raid-Helper events can't be loaded", async () => {
            setupDefaults();
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: "Raid-Helper nicht erreichbar." });
            const res = await post("/api/raids/post-sheet", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "events_unavailable", message: "Raid-Helper nicht erreichbar." } });
        });

        it("returns 404 when the event isn't found", async () => {
            setupDefaults();
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: null });
            const res = await post("/api/raids/post-sheet", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "not_found", message: "Event nicht gefunden." } });
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
            expect(eventSheetStore.markEventSheetPosted).toHaveBeenCalledWith("e1", {
                channelId: "chan1", messageId: "m1", message: "Bitte prüfen", createIfMissing: true,
            });
            expect(json(res)).toEqual({ data: { message: "Raidsheet in den Channel gepostet." } });
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
            expect(json(res)).toEqual({ data: { message: "Raidsheet-Nachricht aktualisiert." } });
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
            expect(json(res)).toEqual({ data: { message: "Raidsheet-Nachricht aktualisiert." } });
        });

        it("returns 500 with the Discord error message on post failure", async () => {
            setupDefaults();
            discord.postLink.mockRejectedValue(new Error("Channel nicht gefunden."));
            const res = await post("/api/raids/post-sheet", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "post_failed", message: "Channel nicht gefunden." } });
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
            expect(json(res)).toEqual({ error: { code: "no_softres", message: "Für dieses Event gibt es noch keine Softres-Liste." } });
            expect(discord.postLink).not.toHaveBeenCalled();
        });

        it("returns 400 when Raid-Helper events can't be loaded", async () => {
            setupDefaults();
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: "Raid-Helper nicht erreichbar." });
            const res = await post("/api/raids/post-softres", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "events_unavailable", message: "Raid-Helper nicht erreichbar." } });
        });

        it("returns 404 when the event isn't found", async () => {
            setupDefaults();
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: null });
            const res = await post("/api/raids/post-softres", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "not_found", message: "Event nicht gefunden." } });
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
            expect(json(res)).toEqual({ data: { message: "Softres-Link in den Channel gepostet." } });
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
            expect(json(res)).toEqual({ data: { message: "Softres-Nachricht aktualisiert." } });
        });

        it("returns 500 with the Discord error message on post failure", async () => {
            setupDefaults();
            discord.postLink.mockRejectedValue(new Error("Channel nicht gefunden."));
            const res = await post("/api/raids/post-softres", { event: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "post_failed", message: "Channel nicht gefunden." } });
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
            expect(json(res)).toEqual({ data: { items: [{ id: 123, name: "Thunderfury", icon: "thunderfury" }] } });
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
            expect(json(res)).toEqual({ error: { code: "no_instances", message: "Mindestens eine Instanz wählen." } });
            expect(softres.createRaid).not.toHaveBeenCalled();
        });

        it("returns 400 when the chosen instances span multiple editions", async () => {
            setupDefaults();
            softres.editionOf.mockImplementation((code) => (code === "kara" ? "tbc" : "wotlk"));
            const res = await post("/api/raids/softres", { event: "e1", instanceCodes: ["kara", "naxx"] });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({
                error: { code: "mixed_edition", message: "Alle gewählten Instanzen müssen zur selben Erweiterung gehören." },
            });
        });

        it("creates the list, saves it and returns 201 with the success message", async () => {
            setupDefaults();
            softres.createRaid.mockResolvedValue({
                raidId: "r1", token: "tok1", url: "https://softres.it/raid/r1", editUrl: "https://softres.it/raid/r1?adminToken=tok1",
            });
            eventSoftresStore.saveEventSoftres.mockReturnValue({ eventId: "e1" });

            const res = await post("/api/raids/softres", {
                event: "e1", instanceCodes: ["kara"], amount: 3, faction: "Horde",
                hardReserves: [{ id: 123, name: "Item" }], hideReserves: true,
            });

            expect(softres.createRaid).toHaveBeenCalledWith({
                instances: ["kara"], edition: "tbc", amount: 3, faction: "Horde",
                hardReserves: [{ id: 123, name: "Item" }], hideReserves: true, protection: true,
            });
            expect(eventSoftresStore.saveEventSoftres).toHaveBeenCalledWith("e1", {
                raidId: "r1", token: "tok1", url: "https://softres.it/raid/r1", editUrl: "https://softres.it/raid/r1?adminToken=tok1",
                edition: "tbc", instances: ["kara"], amount: 3, hardReserveCount: 1,
            });
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(json(res)).toEqual({ data: { message: "Softres-Liste erstellt." } });
        });

        it("passes protection: false through when the caller opts out", async () => {
            setupDefaults();
            softres.createRaid.mockResolvedValue({ raidId: "r1", token: "tok1", url: "u", editUrl: "e" });
            await post("/api/raids/softres", { event: "e1", instanceCodes: ["kara"], faction: "Horde", protection: false });
            expect(softres.createRaid).toHaveBeenCalledWith(expect.objectContaining({ protection: false }));
        });

        it("reports it when the list was created but its hard reserves were not", async () => {
            setupDefaults();
            softres.createRaid.mockResolvedValue({
                raidId: "r1", token: "tok1", url: "u", editUrl: "e",
                hardReserveError: "softres.it lehnte die Anfrage ab: items invalid",
            });
            const res = await post("/api/raids/softres", {
                event: "e1", instanceCodes: ["kara"], faction: "Horde", hardReserves: [{ id: 123, name: "Item" }],
            });
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(json(res).data.message).toMatch("Hardreserves konnten nicht gesetzt werden");
        });

        it("defaults hardReserves to [] when it isn't an array, and returns 500 with the error message on failure", async () => {
            setupDefaults();
            softres.createRaid.mockRejectedValue(new Error("softres.it lehnte die Anfrage ab: unbekannter Fehler"));
            const res = await post("/api/raids/softres", { event: "e1", instanceCodes: ["kara"], faction: "Horde", hardReserves: "not-an-array" });
            expect(softres.createRaid).toHaveBeenCalledWith(expect.objectContaining({ hardReserves: [] }));
            expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "softres_failed", message: "softres.it lehnte die Anfrage ab: unbekannter Fehler" } });
        });
    });

    describe("POST /api/raids/softres/link", () => {
        it("returns 400 for a URL that isn't a softres.it raid link", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/raids/softres/link", { event: "e1", softresUrl: "https://example.com/foo" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({
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
            expect(json(res)).toEqual({ data: { message: "Softres-Link aktualisiert." } });
        });
    });

    describe("POST /api/raids/loot-system", () => {
        const eventLootSystemStore = require("../../../src/stores/eventLootSystemStore");
        const groups = { groups: [{ categoryId: "cat1", categoryName: "Raids", events: [{ id: "e1", title: "SSC" }] }], error: null };

        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            eventLootSystemStore.setEventLootSystem.mockClear();
        });

        it("refuses an unknown loot system", async () => {
            const res = await post("/api/raids/loot-system", { event: "e1", system: "dkp" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res).error.code).toBe("invalid_system");
            expect(eventLootSystemStore.setEventLootSystem).not.toHaveBeenCalled();
        });

        it("refuses an event it cannot find", async () => {
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: null });
            const res = await post("/api/raids/loot-system", { event: "e9", system: "gdkp" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(eventLootSystemStore.setEventLootSystem).not.toHaveBeenCalled();
        });

        it("stores the override with who set it and answers the resolved system", async () => {
            raidEventGroups.loadEventGroups.mockResolvedValue(groups);
            eventLootSystemStore.lootSystemOf.mockReturnValueOnce({
                system: "lootcouncil", label: "Loot-Council", source: "event", categorySystem: "softres", categoryLabel: "Softres", softresExtra: true, softres: true,
            });
            const res = await post("/api/raids/loot-system", { event: "e1", system: "lootcouncil", softres: true });
            expect(eventLootSystemStore.setEventLootSystem).toHaveBeenCalledWith("e1", { system: "lootcouncil", softres: true, by: "1", byName: "Admin" });
            expect(eventLootSystemStore.lootSystemOf).toHaveBeenCalledWith("e1", "cat1");
            expect(json(res).data).toMatchObject({ message: "Lootsystem: Loot-Council + Softres.", lootSystem: { system: "lootcouncil" } });
        });

        it("takes \"\" as \"like the category\" and only a literal true as the softres switch", async () => {
            raidEventGroups.loadEventGroups.mockResolvedValue(groups);
            await post("/api/raids/loot-system", { event: "e1", system: "", softres: "yes" });
            expect(eventLootSystemStore.setEventLootSystem).toHaveBeenCalledWith("e1", { system: "", softres: false, by: "1", byName: "Admin" });
        });
    });
});
