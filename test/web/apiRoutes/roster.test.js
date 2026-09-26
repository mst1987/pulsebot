const { json, routerClient } = require("../../helpers/http");

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
const mockIsConfigured = jest.fn(() => false);
const mockGetCharacterSummary = jest.fn(() => Promise.resolve(null));
const mockGetEquipment = jest.fn(() => Promise.resolve(null));
const mockResolve = jest.fn(() => ({ region: "eu", realm: "thunderstrike", namespace: "profile-classicann-eu" }));
const mockLastError = null;
jest.mock("../../../src/classes/blizzard", () =>
    jest.fn().mockImplementation(() => ({
        isConfigured: mockIsConfigured,
        getCharacterSummary: mockGetCharacterSummary,
        getEquipment: mockGetEquipment,
        _resolve: mockResolve,
        get lastError() { return mockLastError; },
    })));
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
const auth = require("../../../src/web/auth");
const { activeGuildFor } = require("../../../src/web/activeGuild");
const discord = require("../../../src/web/discord");
const lootStore = require("../../../src/web/lootStore");
const characterInfo = require("../../../src/web/characterInfo");
const characterStore = require("../../../src/web/characterStore");
const raiderCharactersStore = require("../../../src/web/raiderCharactersStore");
const charGearIssues = require("../../../src/web/charGearIssues");
const rosterHidden = require("../../../src/web/rosterHiddenStore");
const { emptyAccess } = require("../../../src/config/permissions");
const { tempStoreFile } = require("../../helpers/tempStore");
const { get, post } = routerClient(require("../../../src/web/apiRoutes/roster"));

const ADMIN = { id: "1", name: "Admin", isAdmin: true };
// Hiding writes for real, into a scratch file of this suite.
rosterHidden.useFile(tempStoreFile("roster-hidden.json"));

describe("web/apiRoutes/roster", () => {
    describe("GET /api/roster", () => {
        // clearMocks does not reset return values, so put the defaults back
        // for the tests that follow.
        afterEach(() => {
            characterInfo.annotatedCharacters.mockReturnValue([]);
            raiderCharactersStore.listAllAssignments.mockReturnValue({});
            characterStore.characterMap.mockReturnValue({});
            charGearIssues.latestIssuesByCharacter.mockReturnValue({});
        });

        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await get("/api/roster");
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(characterInfo.annotatedCharacters).not.toHaveBeenCalled();
        });

        it("joins loot characters, manual assignments and gear issues into one roster", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            characterInfo.annotatedCharacters.mockReturnValue([{
                key: "anna", character: "Anna", realm: "Thunderstrike", count: 3,
                categoryIds: ["cat1"], items: [{ itemId: 1, itemName: "Sword" }],
                className: "Priest", spec: "Shadow", source: "wcl",
            }]);
            raiderCharactersStore.listAllAssignments.mockReturnValue({ cat2: { u1: "Bob" } });
            characterStore.characterMap.mockReturnValue({ bob: { className: "Warrior", spec: "Fury", source: "manual" } });
            charGearIssues.latestIssuesByCharacter.mockReturnValue({
                anna: { issueCount: 1, issues: [{ label: "kein Item" }], reportRefId: "r1", generatedAt: 500 },
            });
            discord.listCategories.mockReturnValue([
                { id: "cat1", name: "Montagsraid" }, { id: "cat2", name: "Pug" },
            ]);

            const res = await get("/api/roster");

            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            const data = json(res).data;
            expect(data.activeGuildId).toBe("guild-1");
            expect(data.categories).toEqual([{ id: "cat1", name: "Montagsraid" }, { id: "cat2", name: "Pug" }]);
            expect(data.chars.map((c) => c.character)).toEqual(["Anna", "Bob"]);
            expect(data.chars[0]).toMatchObject({
                categoryIds: ["cat1"], lootCount: 3, className: "Priest", spec: "Shadow", assigned: false,
                gear: { issueCount: 1, reportRefId: "r1" },
            });
            expect(data.chars[0].wclUrl).toContain("Anna");
            expect(data.chars[1]).toMatchObject({
                categoryIds: ["cat2"], lootCount: 0, className: "Warrior", assigned: true, raiderIds: ["u1"], gear: null,
            });
        });

        it("backfills missing loot item names before answering", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            await get("/api/roster");
            expect(lootStore.repairItemNames).toHaveBeenCalled();
        });
    });

    describe("hidden characters", () => {
        beforeEach(() => {
            rosterHidden.reset();
            auth.getUser.mockReturnValue(ADMIN);
            auth.checkCsrf.mockReturnValue(true);
            characterInfo.annotatedCharacters.mockReturnValue([
                { key: "anna", character: "Anna", realm: "Thunderstrike", count: 1, categoryIds: ["cat1"], items: [] },
                { key: "bob", character: "Bob", realm: "Thunderstrike", count: 2, categoryIds: ["cat1"], items: [] },
            ]);
        });
        afterEach(() => characterInfo.annotatedCharacters.mockReturnValue([]));

        it("lists a hidden character apart and leaves it out of the stats", async () => {
            rosterHidden.hide("Bob", { reason: "left the guild", by: "Admin" });
            const data = json(await get("/api/roster")).data;
            expect(data.chars.map((c) => c.character)).toEqual(["Anna"]);
            expect(data.hiddenChars).toHaveLength(1);
            expect(data.hiddenChars[0]).toMatchObject({ character: "Bob", hidden: { character: "Bob", reason: "left the guild", by: "Admin" } });
        });

        it("hides a character with the reason and the name of whoever did it", async () => {
            const res = await post("/api/roster/hide", { character: " Bob ", hide: true, reason: " twink " });
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(json(res).data).toMatchObject({ character: "Bob", hidden: true, entry: { character: "Bob", reason: "twink", by: "Admin" } });
            expect(rosterHidden.isHidden("bob")).toBe(true);
        });

        it("puts a character back and says whether anything changed", async () => {
            rosterHidden.hide("Bob");
            const first = json(await post("/api/roster/hide", { character: "Bob", hide: false })).data;
            expect(first).toEqual({ character: "Bob", hidden: false, changed: true });
            const again = json(await post("/api/roster/hide", { character: "Bob", hide: false })).data;
            expect(again.changed).toBe(false);
            expect(rosterHidden.isHidden("Bob")).toBe(false);
        });

        it("answers 400 without a character", async () => {
            const res = await post("/api/roster/hide", { character: "  " });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(rosterHidden.listHidden()).toEqual({});
        });

        it("needs roster write access to hide someone", async () => {
            auth.getUser.mockReturnValue({ id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), roster: { read: true, write: false } } });
            const res = await post("/api/roster/hide", { character: "Anna" });
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(rosterHidden.isHidden("Anna")).toBe(false);
        });
    });

    describe("GET /api/roster/char", () => {
        beforeEach(() => auth.getUser.mockReturnValue(ADMIN));

        it("describes each worn item once: drop source and BiS specs", async () => {
            // 28453 drops from Attumen in Karazhan (config/tbcContent.js)
            const res = await get("/api/roster/char", { name: "Nobody", items: "28453, 28453,abc,-4,0" });
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            const data = json(res).data;
            expect(data).toMatchObject({ character: "Nobody", role: "", categories: [], attendance: {} });
            expect(Object.keys(data.items)).toEqual(["28453"]);
            expect(data.items[28453]).toMatchObject({ itemId: 28453, contentId: "kara", boss: "Attumen the Huntsman" });
            expect(data.items[28453].content).not.toBe("");
            expect(Array.isArray(data.items[28453].bisSpecs)).toBe(true);
        });

        it("reads an unknown item as empty facts and caps the list", async () => {
            const ids = Array.from({ length: 40 }, (_, i) => 900000 + i).join(",");
            const data = json(await get("/api/roster/char", { name: "", items: ids })).data;
            expect(data.character).toBe("");
            expect(Object.keys(data.items)).toHaveLength(30);
            expect(data.items[900000]).toEqual({ itemId: 900000, contentId: "", content: "", boss: "", tier: "", bisSpecs: expect.any(Array) });
        });
    });
});
