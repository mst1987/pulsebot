// Route tests for the raid-template and channel-management admin endpoints.
// Every collaborator is mocked so routing is exercised in isolation.
const { EventEmitter } = require("events");

const mockGetTemplates = jest.fn();
const mockGetSetup = jest.fn();
const mockGetAllEvents = jest.fn();
const mockGetPastEvents = jest.fn();
const mockCreateEvent = jest.fn();
const mockGetEventSheet = jest.fn(() => null);
const mockMarkEventSheetFilled = jest.fn();

jest.mock("http", () => {
    const fakeServer = { on: jest.fn(), listen: jest.fn() };
    return { __fakeServer: fakeServer, createServer: jest.fn(() => fakeServer) };
});
jest.mock("../../src/web/reportStore", () => ({
    getReport: jest.fn(), deleteReport: jest.fn(), listReports: jest.fn(() => []),
}));
jest.mock("../../src/web/render", () => ({
    renderReportPage: jest.fn(() => "REPORT"), renderPlayerPage: jest.fn(() => "PLAYER"),
    renderNotFound: jest.fn(() => "NOT_FOUND"), renderError: jest.fn(() => "ERROR"),
}));
jest.mock("../../src/web/renderAdmin", () => ({
    renderDashboard: jest.fn(() => "DASHBOARD"),
    renderAdminDenied: jest.fn(() => "DENIED"),
    renderRecruitment: jest.fn(() => "RECRUITMENT"),
    renderCla: jest.fn(() => "CLA"),
    renderRaids: jest.fn(() => "RAIDS"),
    renderRaidCreate: jest.fn(() => "RAIDCREATE"),
    renderEventDetail: jest.fn(() => "EVENTDETAIL"),
    renderNotifyTemplates: jest.fn(() => "NOTIFY"),
    renderChannels: jest.fn(() => "CHANNELS"),
    renderSettings: jest.fn(() => "SETTINGS"),
    renderHistory: jest.fn(() => "HISTORY"),
    renderHistoryEvent: jest.fn(() => "HISTORY_EVENT"),
    renderHistoryChar: jest.fn(() => "HISTORY_CHAR"),
    fillCharTemplate: (tpl, c) => String(tpl || "").replace("{char}", encodeURIComponent(c || "")),
}));
const mockAddLootImport = jest.fn(() => ({ added: 2, skipped: 0 }));
const mockListLootByEvent = jest.fn(() => []);
const mockListLootByCharacter = jest.fn(() => []);
const mockEventsWithLoot = jest.fn(() => []);
const mockLootCharacters = jest.fn(() => []);
const mockClearLootEvent = jest.fn(() => 3);
jest.mock("../../src/web/lootStore", () => ({
    addImport: (...a) => mockAddLootImport(...a),
    listByEvent: (...a) => mockListLootByEvent(...a),
    listByCharacter: (...a) => mockListLootByCharacter(...a),
    eventsWithLoot: (...a) => mockEventsWithLoot(...a),
    characters: (...a) => mockLootCharacters(...a),
    clearEvent: (...a) => mockClearLootEvent(...a),
}));
const mockBlizzardEquip = jest.fn(() => Promise.resolve(null));
const mockBlizzardSummary = jest.fn(() => Promise.resolve(null));
let mockBlizzardConfigured = false;
jest.mock("../../src/classes/blizzard", () =>
    jest.fn().mockImplementation(() => ({
        isConfigured: () => mockBlizzardConfigured,
        getEquipment: mockBlizzardEquip,
        getCharacterSummary: mockBlizzardSummary,
        _resolve: () => ({ namespace: "profile-classic-eu" }),
        lastError: null,
    })));
jest.mock("../../src/web/logStore", () => ({
    listLogs: jest.fn(() => []),
    getLog: jest.fn(() => null),
    deleteLog: jest.fn(),
    linkEvent: jest.fn((id, data) => ({ id, ...data })),
    unlinkEvent: jest.fn((id) => ({ id })),
}));
jest.mock("../../src/web/settingsStore", () => ({
    listRecruitment: jest.fn(() => []), getRecruitment: jest.fn(), saveRecruitment: jest.fn(),
    deleteRecruitment: jest.fn(),
    listRecruitmentPosts: jest.fn(() => []), getRecruitmentPost: jest.fn(),
    saveRecruitmentPost: jest.fn(), deleteRecruitmentPost: jest.fn(),
    listRaidTemplates: jest.fn(() => []),
    saveRaidTemplate: jest.fn(() => ({ id: "3", name: "Kara" })),
    saveRaidTemplates: jest.fn(() => ({ added: 2, updated: 1 })),
    deleteRaidTemplate: jest.fn(() => true),
    listNotify: jest.fn(() => []), getNotify: jest.fn(), saveNotify: jest.fn(), deleteNotify: jest.fn(),
    listRaidsheets: jest.fn(() => []), getRaidsheet: jest.fn(), saveRaidsheet: jest.fn(), deleteRaidsheet: jest.fn(),
    getConfig: jest.fn(() => ({ raidDefaults: {}, categoryIds: [], adminRoleIds: [] })),
    saveConfig: jest.fn(),
}));
const mockCopyFile = jest.fn();
const mockShareAnyoneWriter = jest.fn();
const mockDeleteFile = jest.fn();
jest.mock("../../src/classes/drive", () =>
    jest.fn().mockImplementation(() => ({
        copyFile: mockCopyFile,
        shareAnyoneWriter: mockShareAnyoneWriter,
        deleteFile: mockDeleteFile,
    })));
jest.mock("../../src/utils/sheetCleanup", () => ({ startSheetCleanup: jest.fn() }));
jest.mock("../../src/web/discord", () => ({
    setClient: jest.fn(),
    listGuilds: jest.fn(() => [{ id: "g1", name: "G" }]),
    listTextChannels: jest.fn(() => []),
    listCategories: jest.fn(() => [{ id: "cat", name: "Raids" }]),
    listAllChannels: jest.fn(() => [{ id: "t1", name: "kara" }]),
    listRoles: jest.fn(() => []),
    getChannelCategoryMap: jest.fn(() => ({})),
    postAnnouncement: jest.fn(),
    listMembersWithRoles: jest.fn(async () => ({ members: [], error: null })),
    postMissingPing: jest.fn(async () => ({ channelId: "c1", messageId: "m1", url: "u" })),
    createChannel: jest.fn(),
    duplicateChannel: jest.fn(),
    listEmojis: jest.fn(() => []),
    listApplications: jest.fn(async () => ({ applications: [], error: null })),
    postLink: jest.fn(async () => ({ channelId: "c1", messageId: "m1", url: "u" })),
}));
jest.mock("../../src/classes/raidhelper", () =>
    jest.fn().mockImplementation(() => ({
        getTemplates: mockGetTemplates,
        getSetup: mockGetSetup,
        getAllEvents: mockGetAllEvents,
        getPastEvents: mockGetPastEvents,
        createEvent: mockCreateEvent,
    })));
jest.mock("../../src/classes/sheets", () => jest.fn().mockImplementation((cfg) => ({ cfg })));
const mockFillSetupSheet = jest.fn(() => Promise.resolve({ playerCount: 25 }));
jest.mock("../../src/utils/fillSetup", () => ({ fillSetupSheet: mockFillSetupSheet }));
jest.mock("../../src/web/eventSheetStore", () => ({
    getEventSheet: mockGetEventSheet,
    markEventSheetFilled: mockMarkEventSheetFilled,
    listEventSheets: jest.fn(() => []),
}));
const mockGetEventSoftres = jest.fn(() => null);
const mockSaveEventSoftres = jest.fn((id, data) => ({ eventId: id, ...data }));
jest.mock("../../src/web/eventSoftresStore", () => ({
    getEventSoftres: mockGetEventSoftres,
    saveEventSoftres: mockSaveEventSoftres,
    listEventSoftres: jest.fn(() => []),
}));
const mockCreateRaid = jest.fn(async () => ({
    raidId: "r1", token: "t1", url: "https://softres.it/raid/r1", editUrl: "https://softres.it/raid/r1/t1",
}));
// Keep the real pure helpers (parseInstancesFromTitle/catalogue/editionOf used by
// the detail route) but stub the networked createRaid.
jest.mock("../../src/utils/softres", () => ({
    ...jest.requireActual("../../src/utils/softres"),
    createRaid: mockCreateRaid,
}));
const mockSearchItems = jest.fn(async () => [{ id: 28830, name: "Dragonspine Trophy", icon: "x", iconUrl: "i", quality: 4 }]);
jest.mock("../../src/utils/wowhead", () => ({
    ...jest.requireActual("../../src/utils/wowhead"),
    searchItems: mockSearchItems,
}));
jest.mock("../../src/web/auth", () => ({
    configured: jest.fn(() => true),
    loginUrl: jest.fn(() => "https://d/authorize"),
    completeLogin: jest.fn(), destroy: jest.fn(),
    getUser: jest.fn(() => ({ id: "42", name: "Admin", isAdmin: true })),
    parseCookies: jest.fn(() => ({})),
    csrfToken: jest.fn(() => "tok"),
    checkCsrf: jest.fn(() => true),
    getActiveGuild: jest.fn(() => "g1"),
    setActiveGuild: jest.fn(),
}));

const http = require("http");
const store = require("../../src/web/settingsStore");
const discord = require("../../src/web/discord");
const auth = require("../../src/web/auth");
const renderAdmin = require("../../src/web/renderAdmin");
const logStore = require("../../src/web/logStore");
const { RECENT_WINDOW_DAYS } = require("../../src/web/recentEvents");
const { startWebServer } = require("../../src/web/server.js");

startWebServer();
const handler = http.createServer.mock.calls[0][0];
const flush = () => new Promise((r) => setImmediate(r));

function mockRes() {
    return { writeHead: jest.fn(), end: jest.fn() };
}

// Drive a request. For POST, streams the form body once listeners are attached.
async function request(method, url, form) {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.headers = {};
    const res = mockRes();
    const p = handler(req, res);
    if (method === "POST") {
        const body = new URLSearchParams({ _csrf: "tok", ...(form || {}) }).toString();
        req.emit("data", body);
        req.emit("end");
    }
    await p;
    await flush();
    return res;
}

// The Location a route redirected to (302), or undefined.
function redirectTo(res) {
    const call = res.writeHead.mock.calls.find((c) => c[0] === 302);
    return call && call[1] && call[1].Location;
}

beforeEach(() => {
    auth.getUser.mockReturnValue({ id: "42", name: "Admin", isAdmin: true });
    auth.checkCsrf.mockReturnValue(true);
    auth.getActiveGuild.mockReturnValue("g1");
    mockCreateEvent.mockReset();
    mockCreateEvent.mockResolvedValue({ status: "ok" });
    mockGetAllEvents.mockReset();
    mockGetAllEvents.mockResolvedValue([]);
    mockGetPastEvents.mockReset();
    mockGetPastEvents.mockResolvedValue([]);
    mockGetSetup.mockReset();
    mockGetEventSheet.mockReset();
    mockGetEventSheet.mockReturnValue(null);
    mockMarkEventSheetFilled.mockReset();
    mockFillSetupSheet.mockReset();
    mockFillSetupSheet.mockResolvedValue({ playerCount: 25 });
    discord.duplicateChannel.mockReset();
    discord.getChannelCategoryMap.mockReturnValue({});
});

describe("raid template routes", () => {
    it("POST /admin/raid-templates saves a template and redirects to the create page", async () => {
        const res = await request("POST", "/admin/raid-templates", { id: "3", name: "Kara" });
        expect(store.saveRaidTemplate).toHaveBeenCalledWith({ id: "3", name: "Kara" });
        expect(redirectTo(res)).toBe("/admin/raids/new?msg=saved");
    });

    it("POST /admin/raid-templates errors when the id is blank (save returns null)", async () => {
        store.saveRaidTemplate.mockReturnValueOnce(null);
        const res = await request("POST", "/admin/raid-templates", { id: "", name: "x" });
        expect(redirectTo(res)).toContain("/admin/raids/new?err=");
    });

    it("POST /admin/raid-templates/delete removes and redirects", async () => {
        const res = await request("POST", "/admin/raid-templates/delete", { id: "3" });
        expect(store.deleteRaidTemplate).toHaveBeenCalledWith("3");
        expect(redirectTo(res)).toBe("/admin/raids/new?msg=deleted");
    });

    it("POST /admin/raid-templates/import imports from Raid-Helper and reports counts", async () => {
        mockGetTemplates.mockResolvedValueOnce([{ id: "3", name: "Kara" }, { id: "7", name: "MC" }]);
        const res = await request("POST", "/admin/raid-templates/import");
        expect(store.saveRaidTemplates).toHaveBeenCalledWith([{ id: "3", name: "Kara" }, { id: "7", name: "MC" }]);
        expect(redirectTo(res)).toContain("/admin/raids/new?ok=");
    });

    it("POST /admin/raid-templates/import errors when no templates are found", async () => {
        mockGetTemplates.mockResolvedValueOnce([]);
        const res = await request("POST", "/admin/raid-templates/import");
        expect(store.saveRaidTemplates).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("/admin/raids/new?err=");
    });

    it("rejects a bad CSRF token", async () => {
        auth.checkCsrf.mockReturnValueOnce(false);
        const res = await request("POST", "/admin/raid-templates", { id: "3" });
        expect(store.saveRaidTemplate).not.toHaveBeenCalled();
        expect(redirectTo(res)).toBe("/admin/raids/new?msg=csrf");
    });
});

describe("channel routes", () => {
    it("GET /admin/channels renders the channels page", async () => {
        const res = await request("GET", "/admin/channels");
        expect(discord.listCategories).toHaveBeenCalledWith("g1");
        expect(discord.listAllChannels).toHaveBeenCalledWith("g1");
        expect(res.end).toHaveBeenCalledWith("CHANNELS");
    });

    it("POST /admin/channels/create creates a channel and redirects with ok", async () => {
        discord.createChannel.mockResolvedValueOnce({ id: "new", name: "neu" });
        const res = await request("POST", "/admin/channels/create", { name: "neu", type: "text", parentId: "cat" });
        expect(discord.createChannel).toHaveBeenCalledWith("g1", { name: "neu", type: "text", parentId: "cat" });
        expect(redirectTo(res)).toContain("/admin/channels?ok=");
    });

    it("POST /admin/channels/create surfaces the error when creation fails", async () => {
        discord.createChannel.mockRejectedValueOnce(new Error("Missing Permissions"));
        const res = await request("POST", "/admin/channels/create", { name: "neu" });
        expect(redirectTo(res)).toContain("/admin/channels?err=");
    });

    it("POST /admin/channels/create errors when no server is active", async () => {
        auth.getActiveGuild.mockReturnValueOnce("");
        discord.listGuilds.mockReturnValueOnce([]);
        const res = await request("POST", "/admin/channels/create", { name: "neu" });
        expect(discord.createChannel).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("/admin/channels?err=");
    });

    it("POST /admin/channels/duplicate clones and redirects with ok", async () => {
        discord.duplicateChannel.mockResolvedValueOnce({ id: "clone", name: "kara-2" });
        const res = await request("POST", "/admin/channels/duplicate", { channelId: "src", name: "kara-2" });
        expect(discord.duplicateChannel).toHaveBeenCalledWith("src", "kara-2");
        expect(redirectTo(res)).toContain("/admin/channels?ok=");
    });

    it("POST /admin/channels/duplicate errors without a source channel", async () => {
        const res = await request("POST", "/admin/channels/duplicate", { channelId: "" });
        expect(discord.duplicateChannel).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("/admin/channels?err=");
    });

    it("denies non-admins", async () => {
        auth.getUser.mockReturnValue(null);
        const res = await request("GET", "/admin/channels");
        expect(res.end).toHaveBeenCalledWith("DENIED");
    });
});

describe("raid create route", () => {
    it("GET /admin/raids/new loads reusable events for the picker", async () => {
        mockGetAllEvents.mockResolvedValueOnce([
            { id: "ev1", channelId: "c1", title: "GDKP Kara", templateId: 3, description: "d", startTime: 100, signUps: [] },
        ]);
        discord.getChannelCategoryMap.mockReturnValueOnce({
            c1: { name: "gdkp-kara", categoryId: "cat", categoryName: "Raids" },
        });
        const res = await request("GET", "/admin/raids/new");
        expect(res.end).toHaveBeenCalledWith("RAIDCREATE");
        const opts = renderAdmin.renderRaidCreate.mock.calls.at(-1)[1];
        expect(opts.reusableEvents).toEqual([
            { id: "ev1", title: "GDKP Kara", templateId: "3", description: "d", channelId: "c1", channelName: "gdkp-kara" },
        ]);
    });

    it("POST /admin/raids/new creates an event in the chosen channel (no reuse)", async () => {
        const res = await request("POST", "/admin/raids/new", {
            channelId: "c1", leaderId: "42", templateId: "3", date: "2026-07-24", time: "20:00", title: "GDKP Kara",
        });
        expect(discord.duplicateChannel).not.toHaveBeenCalled();
        expect(mockCreateEvent).toHaveBeenCalledWith(expect.objectContaining({
            channelId: "c1", date: "24-07-2026", time: "20:00", title: "GDKP Kara",
        }));
        expect(redirectTo(res)).toContain("/admin/raids?ok=");
    });

    it("POST /admin/raids/new reuses an event: clones its channel and posts there", async () => {
        mockGetAllEvents.mockResolvedValue([
            { id: "ev1", channelId: "c1", title: "GDKP Kara", templateId: 3, startTime: 100, signUps: [] },
        ]);
        discord.getChannelCategoryMap.mockReturnValue({
            c1: { name: "gdkp-kara", categoryId: "cat", categoryName: "Raids" },
        });
        discord.duplicateChannel.mockResolvedValueOnce({ id: "cNew", name: "gdkp-kara-24" });
        const res = await request("POST", "/admin/raids/new", {
            sourceEventId: "ev1", channelName: "gdkp-kara-24", leaderId: "42",
            templateId: "3", date: "2026-07-24", time: "20:00", title: "GDKP Kara",
        });
        expect(discord.duplicateChannel).toHaveBeenCalledWith("c1", "gdkp-kara-24");
        expect(mockCreateEvent).toHaveBeenCalledWith(expect.objectContaining({
            channelId: "cNew", date: "24-07-2026",
        }));
        expect(redirectTo(res)).toContain("/admin/raids?ok=");
    });

    it("POST /admin/raids/new rejects an invalid date", async () => {
        const res = await request("POST", "/admin/raids/new", {
            channelId: "c1", leaderId: "42", templateId: "3", date: "", time: "20:00", title: "x",
        });
        expect(mockCreateEvent).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("/admin/raids/new?err=");
    });

    it("POST /admin/raids/new errors when the source event is not found", async () => {
        const res = await request("POST", "/admin/raids/new", {
            sourceEventId: "missing", channelName: "x", leaderId: "42", templateId: "3", date: "2026-07-24", time: "20:00", title: "x",
        });
        expect(discord.duplicateChannel).not.toHaveBeenCalled();
        expect(mockCreateEvent).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("/admin/raids/new?err=");
    });
});

describe("event detail route (setup)", () => {
    beforeEach(() => {
        mockGetAllEvents.mockResolvedValue([
            { id: "e1", channelId: "c1", title: "GDKP Kara", startTime: 100, leaderId: "u1", signUps: [] },
        ]);
        discord.getChannelCategoryMap.mockReturnValue({
            c1: { name: "kara", categoryId: "cat", categoryName: "Raids" },
        });
        renderAdmin.renderEventDetail.mockClear();
    });

    it("GET /admin/raids/detail loads the raidplan setup and passes a built view", async () => {
        mockGetSetup.mockResolvedValueOnce({ setup: [{ name: "Tankadin", specName: "ProtPala" }] });
        const res = await request("GET", "/admin/raids/detail?event=e1");
        expect(mockGetSetup).toHaveBeenCalledWith("e1");
        expect(res.end).toHaveBeenCalledWith("EVENTDETAIL");
        const opts = renderAdmin.renderEventDetail.mock.calls[0][1];
        expect(opts.setup).toMatchObject({ total: 1 });
        expect(opts.setup.groups[0].players[0].name).toBe("Tankadin");
        expect(opts.setup.groups[0].group).toBe(1);
        // the prot-pala is offered as a tank candidate for the fill form
        expect(opts.tankCandidates.map((c) => c.name)).toEqual(["Tankadin"]);
        expect(opts.setupError).toBeNull();
    });

    it("surfaces a setupError but still renders the page when getSetup fails", async () => {
        mockGetSetup.mockRejectedValueOnce(new Error("Raid-Helper down"));
        const res = await request("GET", "/admin/raids/detail?event=e1");
        expect(res.end).toHaveBeenCalledWith("EVENTDETAIL");
        const opts = renderAdmin.renderEventDetail.mock.calls[0][1];
        expect(opts.setup).toBeNull();
        expect(opts.setupError).toContain("Raid-Helper down");
    });

    it("passes the tracked event-sheet copy to the detail view", async () => {
        mockGetSetup.mockResolvedValueOnce({ setup: [] });
        mockGetEventSheet.mockReturnValueOnce({ eventId: "e1", url: "u", deleteAfter: 5 });
        await request("GET", "/admin/raids/detail?event=e1");
        const opts = renderAdmin.renderEventDetail.mock.calls[0][1];
        expect(opts.eventSheet).toMatchObject({ eventId: "e1", url: "u" });
    });

    it("passes this event's already-imported loot and its category's loot tool to the detail view", async () => {
        mockGetSetup.mockResolvedValueOnce({ setup: [] });
        mockListLootByEvent.mockReturnValueOnce([{ id: "i1", itemName: "Sulfuras" }]);
        // getConfig() is read twice on this route (categoryRoles for attendance,
        // categoryLootTool for the Loot tab) — stub both calls the same way.
        store.getConfig.mockReturnValue({ categoryLootTool: { cat: "gargul" } });
        await request("GET", "/admin/raids/detail?event=e1");
        expect(mockListLootByEvent).toHaveBeenCalledWith("e1");
        const opts = renderAdmin.renderEventDetail.mock.calls[0][1];
        expect(opts.lootItems).toEqual([{ id: "i1", itemName: "Sulfuras" }]);
        expect(opts.lootTool).toBe("gargul");
    });

    it("defaults to an empty loot list and no preset tool when nothing is configured", async () => {
        mockGetSetup.mockResolvedValueOnce({ setup: [] });
        mockListLootByEvent.mockReturnValueOnce([]);
        store.getConfig.mockReturnValue({});
        await request("GET", "/admin/raids/detail?event=e1");
        const opts = renderAdmin.renderEventDetail.mock.calls[0][1];
        expect(opts.lootItems).toEqual([]);
        expect(opts.lootTool).toBe("");
    });
});

describe("raidsheet fill route (per-event copy)", () => {
    const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
    beforeEach(() => {
        jest.clearAllMocks();
        auth.getUser.mockReturnValue({ id: "42", name: "Admin", isAdmin: true });
        auth.checkCsrf.mockReturnValue(true);
        auth.getActiveGuild.mockReturnValue("g1");
        mockGetAllEvents.mockResolvedValue([
            { id: "e1", channelId: "c1", title: "GDKP Kara", startTime: 100, leaderId: "u1", signUps: [] },
        ]);
        discord.getChannelCategoryMap.mockReturnValue({
            c1: { name: "kara", categoryId: "cat", categoryName: "Raids" },
        });
        store.getRaidsheet.mockReturnValue({ id: "tier45", name: "Tier 4/5", spreadsheetId: "src-1", sheetName: "Setup", gid: "0" });
        mockGetEventSheet.mockReturnValue(null);
        mockGetSetup.mockResolvedValue({ setup: [{ name: "Tankadin", specName: "ProtPala" }] });
        mockCopyFile.mockResolvedValue({ id: "copy-1", url: "https://docs.google.com/spreadsheets/d/copy-1/edit" });
        mockShareAnyoneWriter.mockResolvedValue();
        mockDeleteFile.mockResolvedValue();
        mockFillSetupSheet.mockResolvedValue({ playerCount: 25 });
    });

    it("copies the source sheet, shares it, fills the copy, and schedules deletion", async () => {
        const res = await request("POST", "/admin/raids/fill", {
            event: "e1", sheetId: "tier45", tank3: "Cosma", eventTitle: "GDKP Kara", eventStartTime: "100",
        });
        // copy of the source (never the source itself); name from the form title
        expect(mockCopyFile).toHaveBeenCalledWith("src-1", expect.stringContaining("GDKP Kara"));
        expect(mockShareAnyoneWriter).toHaveBeenCalledWith("copy-1");
        // fills the COPY, not the source
        const fillClient = mockFillSetupSheet.mock.calls[0][0];
        expect(fillClient.cfg.spreadsheetId).toBe("copy-1");
        expect(mockFillSetupSheet.mock.calls[0][2]).toMatchObject({ tank3: "Cosma" });
        // records the copy with a deletion 3 days after the raid (startTime 100s)
        expect(mockMarkEventSheetFilled).toHaveBeenCalledWith("e1", expect.objectContaining({
            spreadsheetId: "copy-1", sourceSheetId: "src-1",
            deleteAfter: 100 * 1000 + THREE_DAYS,
        }));
        // the slow getAllEvents round-trip is no longer part of the fill path
        expect(mockGetAllEvents).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("/admin/raids/detail?event=e1");
        expect(redirectTo(res)).toContain("ok=");
    });

    it("runs the setup fetch and the Drive copy concurrently", async () => {
        await request("POST", "/admin/raids/fill", { event: "e1", sheetId: "tier45" });
        // both the setup fetch and the copy happen (in parallel); neither waits on
        // a getAllEvents call, which is gone from this path
        expect(mockGetSetup).toHaveBeenCalledWith("e1");
        expect(mockCopyFile).toHaveBeenCalled();
        expect(mockGetAllEvents).not.toHaveBeenCalled();
    });

    it("deletes the previous copy's Drive file on re-fill (off the critical path)", async () => {
        mockGetEventSheet.mockReturnValue({ spreadsheetId: "copy-old", eventId: "e1" });
        await request("POST", "/admin/raids/fill", { event: "e1", sheetId: "tier45" });
        expect(mockDeleteFile).toHaveBeenCalledWith("copy-old");
        expect(mockCopyFile).toHaveBeenCalled();
    });

    it("discards the fresh orphan copy (and keeps the previous one) when the setup is empty", async () => {
        mockGetSetup.mockResolvedValueOnce({ setup: [] });
        const res = await request("POST", "/admin/raids/fill", { event: "e1", sheetId: "tier45" });
        // the copy is created in parallel, then deleted again; the previous copy and
        // its record are left untouched (no markEventSheetFilled, no fill)
        expect(mockCopyFile).toHaveBeenCalled();
        expect(mockDeleteFile).toHaveBeenCalledWith("copy-1");
        expect(mockFillSetupSheet).not.toHaveBeenCalled();
        expect(mockMarkEventSheetFilled).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("err=");
    });

    it("rejects a bad CSRF token before doing anything", async () => {
        auth.checkCsrf.mockReturnValueOnce(false);
        const res = await request("POST", "/admin/raids/fill", { event: "e1", sheetId: "tier45" });
        expect(mockCopyFile).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("msg=csrf");
    });
});

describe("dashboard upcoming events (GET /)", () => {
    beforeEach(() => {
        renderAdmin.renderDashboard.mockClear();
        discord.getChannelCategoryMap.mockReturnValue({
            c1: { name: "kara", categoryId: "cat", categoryName: "Raids" },
            c2: { name: "gruul", categoryId: "cat", categoryName: "Raids" },
        });
    });

    const upcomingFromLastRender = () => renderAdmin.renderDashboard.mock.calls.at(-1)[1].upcoming;

    it("lists only upcoming events that have a non-empty setup, in start-time order", async () => {
        mockGetAllEvents.mockResolvedValueOnce([
            { id: "e1", channelId: "c1", title: "Kara", startTime: 100, signUps: [{ specName: "ProtPala" }, { specName: "Absence" }] },
            { id: "e2", channelId: "c2", title: "Gruul", startTime: 200, signUps: [] },
        ]);
        // e1 has a setup, e2 does not (empty) -> only e1 is listed
        mockGetSetup.mockImplementation((id) =>
            Promise.resolve(id === "e1" ? { setup: [{ name: "Tank" }, { name: "Heal" }] } : { setup: [] }));

        const res = await request("GET", "/");
        expect(res.end).toHaveBeenCalledWith("DASHBOARD");
        const upcoming = upcomingFromLastRender();
        expect(upcoming.error).toBeNull();
        expect(upcoming.events).toHaveLength(1);
        expect(upcoming.events[0]).toMatchObject({
            id: "e1", title: "Kara", channelName: "kara", signupCount: 1, playerCount: 2, sheet: null,
        });
    });

    it("annotates an event with its sheet fill record when one exists", async () => {
        mockGetAllEvents.mockResolvedValueOnce([
            { id: "e1", channelId: "c1", title: "Kara", startTime: 100, signUps: [] },
        ]);
        mockGetSetup.mockResolvedValue({ setup: [{ name: "Tank" }] });
        mockGetEventSheet.mockReturnValue({ eventId: "e1", filledAt: 123, playerCount: 25 });

        await request("GET", "/");
        expect(mockGetEventSheet).toHaveBeenCalledWith("e1");
        expect(upcomingFromLastRender().events[0].sheet).toMatchObject({ eventId: "e1", playerCount: 25 });
    });

    it("stops after finding the requested number of events (limit 3)", async () => {
        mockGetAllEvents.mockResolvedValueOnce(
            Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, channelId: "c1", title: `E${i}`, startTime: i, signUps: [] })));
        mockGetSetup.mockResolvedValue({ setup: [{ name: "Tank" }] });

        await request("GET", "/");
        expect(upcomingFromLastRender().events).toHaveLength(3);
    });

    it("ignores events whose channel is not in the active guild", async () => {
        mockGetAllEvents.mockResolvedValueOnce([
            { id: "e1", channelId: "other", title: "Elsewhere", startTime: 100, signUps: [] },
        ]);
        mockGetSetup.mockResolvedValue({ setup: [{ name: "Tank" }] });

        await request("GET", "/");
        expect(mockGetSetup).not.toHaveBeenCalled();
        expect(upcomingFromLastRender().events).toEqual([]);
    });

    it("reports an error when the Raid-Helper API throws", async () => {
        mockGetAllEvents.mockRejectedValueOnce(new Error("API kaputt"));
        await request("GET", "/");
        const upcoming = upcomingFromLastRender();
        expect(upcoming.events).toEqual([]);
        expect(upcoming.error).toContain("API kaputt");
    });
});

describe("dashboard latest (past) events (GET /)", () => {
    const NOW = 1_700_000_000_000;
    const HOUR = 3600000;
    const secs = (msAgo) => Math.floor((NOW - msAgo) / 1000);
    let nowSpy;

    beforeEach(() => {
        nowSpy = jest.spyOn(Date, "now").mockReturnValue(NOW);
        renderAdmin.renderDashboard.mockClear();
        discord.getChannelCategoryMap.mockReturnValue({
            c1: { name: "kara", categoryId: "cat", categoryName: "Raids" },
            c2: { name: "gruul", categoryId: "cat", categoryName: "Raids" },
        });
        logStore.listLogs.mockReturnValue([]);
        mockListLootByEvent.mockReturnValue([]);
        mockGetEventSoftres.mockReturnValue(null);
    });
    afterEach(() => nowSpy.mockRestore());

    const recentFromLastRender = () => renderAdmin.renderDashboard.mock.calls.at(-1)[1].recentEvents;

    it("asks Raid-Helper for events since the lookback window", async () => {
        await request("GET", "/");
        expect(mockGetPastEvents).toHaveBeenCalledWith(Math.floor(NOW / 1000) - RECENT_WINDOW_DAYS * 86400);
    });

    it("lists past events of the active guild with channel and category", async () => {
        mockGetPastEvents.mockResolvedValueOnce([
            { id: "e1", channelId: "c1", title: "Kara", startTime: secs(2 * HOUR) },
        ]);
        const res = await request("GET", "/");
        expect(res.end).toHaveBeenCalledWith("DASHBOARD");
        const recent = recentFromLastRender();
        expect(recent.error).toBeNull();
        expect(recent.events).toHaveLength(1);
        expect(recent.events[0]).toMatchObject({
            id: "e1", title: "Kara", channelName: "kara", categoryName: "Raids", lootCount: 0, softres: null,
        });
    });

    it("ignores events whose channel is not in the active guild", async () => {
        mockGetPastEvents.mockResolvedValueOnce([
            { id: "e1", channelId: "elsewhere", title: "Fremd", startTime: secs(HOUR) },
        ]);
        await request("GET", "/");
        expect(recentFromLastRender().events).toEqual([]);
    });

    it("attaches the logs posted around the raid and skips unrelated ones", async () => {
        mockGetPastEvents.mockResolvedValueOnce([
            { id: "e1", channelId: "c1", title: "Kara", startTime: secs(6 * HOUR) },
        ]);
        logStore.listLogs.mockReturnValue([
            { id: "l1", guildId: "g1", reportId: "abc", postedAt: NOW - 3 * HOUR },
            { id: "l2", guildId: "g1", reportId: "old", postedAt: NOW - 20 * 24 * HOUR },
        ]);
        await request("GET", "/");
        expect(recentFromLastRender().events[0].logs.map((l) => l.id)).toEqual(["l1"]);
    });

    it("ignores logs tracked for another guild", async () => {
        mockGetPastEvents.mockResolvedValueOnce([
            { id: "e1", channelId: "c1", title: "Kara", startTime: secs(2 * HOUR) },
        ]);
        logStore.listLogs.mockReturnValue([
            { id: "other", guildId: "g2", reportId: "abc", postedAt: NOW - HOUR },
        ]);
        await request("GET", "/");
        expect(recentFromLastRender().events[0].logs).toEqual([]);
    });

    it("derives a log's post time from its message id when postedAt is missing", async () => {
        // snowflake for NOW - 1h (Discord epoch 1420070400000)
        const messageId = String((BigInt(NOW - HOUR - 1420070400000) << 22n));
        mockGetPastEvents.mockResolvedValueOnce([
            { id: "e1", channelId: "c1", title: "Kara", startTime: secs(2 * HOUR) },
        ]);
        logStore.listLogs.mockReturnValue([{ id: "l1", guildId: "g1", reportId: "abc", messageId }]);
        await request("GET", "/");
        expect(recentFromLastRender().events[0].logs.map((l) => l.id)).toEqual(["l1"]);
    });

    it("annotates the imported loot count and the softres list", async () => {
        mockGetPastEvents.mockResolvedValueOnce([
            { id: "e1", channelId: "c1", title: "Kara", startTime: secs(2 * HOUR) },
        ]);
        mockListLootByEvent.mockReturnValue([{ id: "i1" }, { id: "i2" }]);
        mockGetEventSoftres.mockReturnValue({ eventId: "e1", url: "https://softres.it/raid/r1" });
        await request("GET", "/");
        const ev = recentFromLastRender().events[0];
        expect(mockListLootByEvent).toHaveBeenCalledWith("e1");
        expect(ev.lootCount).toBe(2);
        expect(ev.softres).toMatchObject({ url: "https://softres.it/raid/r1" });
    });

    it("reports an error when the Raid-Helper API throws", async () => {
        mockGetPastEvents.mockRejectedValueOnce(new Error("API kaputt"));
        await request("GET", "/");
        const recent = recentFromLastRender();
        expect(recent.events).toEqual([]);
        expect(recent.error).toContain("API kaputt");
    });

    it("skips the Raid-Helper call entirely when no server is selected", async () => {
        auth.getActiveGuild.mockReturnValue("");
        discord.listGuilds.mockReturnValueOnce([{ id: "g1" }, { id: "g2" }]);
        await request("GET", "/");
        expect(mockGetPastEvents).not.toHaveBeenCalled();
        expect(recentFromLastRender()).toEqual({ events: [], error: null });
    });
});

describe("raidsheet fill route records the fill", () => {
    beforeEach(() => {
        store.getRaidsheet.mockReturnValue({ id: "tier45", name: "Tier 4/5", spreadsheetId: "sheet123", sheetName: "Setup", gid: "0" });
        mockGetEventSheet.mockReturnValue(null);
        mockCopyFile.mockResolvedValue({ id: "copy-1", url: "https://docs.google.com/spreadsheets/d/copy-1/edit" });
        mockShareAnyoneWriter.mockResolvedValue();
        mockDeleteFile.mockResolvedValue();
    });

    it("POST /admin/raids/fill marks the event sheet as filled on success", async () => {
        mockGetSetup.mockResolvedValueOnce({ setup: [{ name: "Tank" }] });
        const res = await request("POST", "/admin/raids/fill", { event: "e1", sheetId: "tier45" });
        expect(mockFillSetupSheet).toHaveBeenCalled();
        // the post-fill record carries the player count for the dashboard
        expect(mockMarkEventSheetFilled).toHaveBeenCalledWith("e1", {
            sheetId: "tier45", sheetName: "Tier 4/5", playerCount: 25,
        });
        expect(redirectTo(res)).toContain("/admin/raids/detail?event=e1&ok=");
    });

    it("does not record a fill when the setup is empty", async () => {
        mockGetSetup.mockResolvedValueOnce({ setup: [] });
        const res = await request("POST", "/admin/raids/fill", { event: "e1", sheetId: "tier45" });
        expect(mockMarkEventSheetFilled).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("&err=");
    });
});

describe("settings route: Battle.net credentials", () => {
    it("POST /admin/settings saves blizzard client id/region/realm and the new secret", async () => {
        store.saveConfig.mockClear();
        const res = await request("POST", "/admin/settings", {
            blizzardClientId: "cid", blizzardClientSecret: "sec",
            blizzardRegion: "eu", blizzardRealmSlug: "Thunderstrike",
        });
        expect(store.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
            blizzard: { clientId: "cid", region: "eu", realmSlug: "thunderstrike", namespace: "", clientSecret: "sec" },
        }));
        expect(redirectTo(res)).toBe("/admin/settings?msg=saved");
    });

    it("keeps the stored secret when the secret field is left blank", async () => {
        store.saveConfig.mockClear();
        await request("POST", "/admin/settings", {
            blizzardClientId: "cid", blizzardClientSecret: "",
            blizzardRegion: "eu", blizzardRealmSlug: "thunderstrike",
        });
        const arg = store.saveConfig.mock.calls[0][0];
        // no clientSecret key → settingsStore deep-merge keeps the existing one
        expect(arg.blizzard).not.toHaveProperty("clientSecret");
    });

    it("clears the stored secret when the field is a single dash", async () => {
        store.saveConfig.mockClear();
        await request("POST", "/admin/settings", {
            blizzardClientId: "cid", blizzardClientSecret: "-",
            blizzardRegion: "eu", blizzardRealmSlug: "thunderstrike",
        });
        expect(store.saveConfig.mock.calls[0][0].blizzard.clientSecret).toBe("");
    });
});

describe("event history & loot routes", () => {
    const GARGUL = "dateTime,character,itemID,offspec,id\n2026-07-12,Foo,29992,0,ABC";
    const RCLC = JSON.stringify([{
        player: "Foo-Thunderstrike", itemID: 100, itemName: "X", id: "r1",
        servertime: "1784574268", response: "BIS", responseID: "1", boss: "B", owner: "ML-Thunderstrike",
    }]);
    const body = (res) => res.end.mock.calls[0] && res.end.mock.calls[0][0];

    beforeEach(() => {
        mockAddLootImport.mockClear().mockReturnValue({ added: 2, skipped: 0 });
        mockClearLootEvent.mockClear().mockReturnValue(3);
        mockListLootByEvent.mockClear().mockReturnValue([]);
        mockListLootByCharacter.mockClear().mockReturnValue([]);
        mockEventsWithLoot.mockClear().mockReturnValue([]);
        mockLootCharacters.mockClear().mockReturnValue([]);
        mockBlizzardEquip.mockClear().mockResolvedValue(null);
        mockBlizzardSummary.mockClear().mockResolvedValue(null);
        mockBlizzardConfigured = false;
        store.saveConfig.mockClear();
    });

    it("GET /admin/history renders the history page", async () => {
        const res = await request("GET", "/admin/history");
        expect(body(res)).toBe("HISTORY");
    });

    it("POST /admin/history/import parses a manual Gargul import and stores it", async () => {
        const res = await request("POST", "/admin/history/import", {
            event: "__manual__", manualLabel: "SSC 12.07", tool: "gargul", data: GARGUL,
        });
        expect(mockAddLootImport).toHaveBeenCalledTimes(1);
        const [eventId, items, meta] = mockAddLootImport.mock.calls[0];
        expect(eventId).toBe("manual-ssc-12-07");
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ source: "gargul", character: "Foo", itemId: 29992 });
        expect(meta.eventLabel).toBe("SSC 12.07");
        expect(redirectTo(res)).toContain("/admin/history?ok=");
    });

    it("POST /admin/history/import auto-detects RCLootcouncil JSON", async () => {
        await request("POST", "/admin/history/import", {
            event: "__manual__", manualLabel: "Night", tool: "auto", data: RCLC,
        });
        const items = mockAddLootImport.mock.calls[0][1];
        expect(items[0]).toMatchObject({ source: "rclc", character: "Foo", itemId: 100 });
    });

    it("POST /admin/history/import rejects an empty paste", async () => {
        const res = await request("POST", "/admin/history/import", { event: "__manual__", manualLabel: "x", data: "" });
        expect(mockAddLootImport).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("err=");
    });

    it("POST /admin/history/import surfaces a parse error", async () => {
        const res = await request("POST", "/admin/history/import", {
            event: "__manual__", manualLabel: "x", tool: "rclc", data: "not json",
        });
        expect(mockAddLootImport).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("err=");
    });

    it("POST /admin/history/import requires an event or manual label", async () => {
        const res = await request("POST", "/admin/history/import", { event: "__manual__", manualLabel: "", data: GARGUL });
        expect(mockAddLootImport).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("err=");
    });

    it("POST /admin/history/category-tool saves the category mapping", async () => {
        const res = await request("POST", "/admin/history/category-tool", { categoryId: "cat1", tool: "rclc" });
        expect(store.saveConfig).toHaveBeenCalledWith({ categoryLootTool: { cat1: "rclc" } });
        expect(redirectTo(res)).toBe("/admin/history?msg=saved");
    });

    it("POST /admin/history/clear clears an event's loot", async () => {
        const res = await request("POST", "/admin/history/clear", { event: "e1" });
        expect(mockClearLootEvent).toHaveBeenCalledWith("e1");
        expect(redirectTo(res)).toContain("/admin/history?ok=");
    });

    describe("submitted from the Raid-Events detail page (origin=raid)", () => {
        it("POST /admin/history/import redirects back to the event's detail page on success", async () => {
            const res = await request("POST", "/admin/history/import", {
                event: "e1", origin: "raid", tool: "gargul", data: GARGUL,
            });
            expect(mockAddLootImport).toHaveBeenCalledTimes(1);
            expect(mockAddLootImport.mock.calls[0][0]).toBe("e1");
            expect(redirectTo(res)).toBe("/admin/raids/detail?event=e1&ok=2%20Item(s)%20importiert.");
        });

        it("POST /admin/history/import redirects back to the event's detail page on a parse error", async () => {
            const res = await request("POST", "/admin/history/import", {
                event: "e1", origin: "raid", tool: "rclc", data: "not json",
            });
            expect(mockAddLootImport).not.toHaveBeenCalled();
            expect(redirectTo(res)).toContain("/admin/raids/detail?event=e1&err=");
        });

        it("POST /admin/history/import redirects back to the event's detail page on a bad CSRF token", async () => {
            auth.checkCsrf.mockReturnValueOnce(false);
            const res = await request("POST", "/admin/history/import", { event: "e1", origin: "raid", data: GARGUL });
            expect(mockAddLootImport).not.toHaveBeenCalled();
            expect(redirectTo(res)).toBe("/admin/raids/detail?event=e1&msg=csrf");
        });

        it("POST /admin/history/clear redirects back to the event's detail page", async () => {
            const res = await request("POST", "/admin/history/clear", { event: "e1", origin: "raid" });
            expect(mockClearLootEvent).toHaveBeenCalledWith("e1");
            expect(redirectTo(res)).toBe("/admin/raids/detail?event=e1&ok=3%20Loot-Eintrag%2F-Eintr%C3%A4ge%20gel%C3%B6scht.");
        });

        it("ignores origin=raid without an event id and falls back to the history page", async () => {
            const res = await request("POST", "/admin/history/import", { event: "", origin: "raid", manualLabel: "x", data: GARGUL });
            expect(redirectTo(res)).toContain("/admin/history?ok=");
        });
    });

    it("GET /admin/history/event renders the event loot", async () => {
        mockListLootByEvent.mockReturnValue([{ eventLabel: "SSC", character: "Foo" }]);
        const res = await request("GET", "/admin/history/event?event=e1");
        expect(mockListLootByEvent).toHaveBeenCalledWith("e1");
        expect(body(res)).toBe("HISTORY_EVENT");
    });

    it("GET /admin/history/char skips the Blizzard call when unconfigured", async () => {
        const res = await request("GET", "/admin/history/char?name=Foo");
        expect(mockListLootByCharacter).toHaveBeenCalledWith("Foo");
        expect(mockBlizzardEquip).not.toHaveBeenCalled();
        expect(body(res)).toBe("HISTORY_CHAR");
    });

    it("GET /admin/history/char queries Blizzard gear + summary when configured", async () => {
        mockBlizzardConfigured = true;
        mockBlizzardEquip.mockResolvedValue([{ slot: "HEAD", itemId: 1, name: "Hat" }]);
        mockBlizzardSummary.mockResolvedValue({ level: 70, namespace: "profile-classic-eu" });
        await request("GET", "/admin/history/char?name=Foo");
        expect(mockBlizzardEquip).toHaveBeenCalledWith("Foo");
        expect(mockBlizzardSummary).toHaveBeenCalledWith("Foo");
    });

    it("POST /admin/settings saves the blizzard profile namespace override", async () => {
        const res = await request("POST", "/admin/settings", {
            blizzardClientId: "cid", blizzardRegion: "eu", blizzardRealmSlug: "thunderstrike",
            blizzardNamespace: "profile-classicann-eu",
        });
        expect(store.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
            blizzard: expect.objectContaining({ namespace: "profile-classicann-eu" }),
        }));
        expect(redirectTo(res)).toBe("/admin/settings?msg=saved");
    });
});

describe("attendance on the event detail route", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        auth.getUser.mockReturnValue({ id: "42", name: "Admin", isAdmin: true });
        auth.checkCsrf.mockReturnValue(true);
        auth.getActiveGuild.mockReturnValue("g1");
        mockGetAllEvents.mockResolvedValue([
            { id: "e1", channelId: "c1", title: "Kara", startTime: 100, signUps: [{ userId: "u1", specName: "Warrior" }] },
        ]);
        discord.getChannelCategoryMap.mockReturnValue({ c1: { name: "kara", categoryId: "cat", categoryName: "Raids" } });
        mockGetSetup.mockResolvedValue({ setup: [] });
        store.getConfig.mockReturnValue({ raidDefaults: {}, categoryIds: ["cat"], adminRoleIds: [], categoryRoles: { cat: ["r1"] } });
        discord.listMembersWithRoles.mockResolvedValue({
            members: [{ id: "u1", displayName: "Alice" }, { id: "u2", displayName: "Bob" }], error: null,
        });
    });

    it("GET /admin/raids/detail computes who reacted vs. who is still missing", async () => {
        await request("GET", "/admin/raids/detail?event=e1");
        expect(discord.listMembersWithRoles).toHaveBeenCalledWith("g1", ["r1"]);
        const opts = renderAdmin.renderEventDetail.mock.calls.at(-1)[1];
        expect(opts.attendance.responded.map((m) => m.id)).toEqual(["u1"]);
        expect(opts.attendance.missing.map((m) => m.id)).toEqual(["u2"]);
        expect(opts.attendanceRoleIds).toEqual(["r1"]);
    });

    it("skips the member lookup when the category has no roles assigned", async () => {
        store.getConfig.mockReturnValue({ raidDefaults: {}, categoryIds: ["cat"], adminRoleIds: [], categoryRoles: {} });
        await request("GET", "/admin/raids/detail?event=e1");
        expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
        const opts = renderAdmin.renderEventDetail.mock.calls.at(-1)[1];
        expect(opts.attendance).toEqual({ responded: [], missing: [] });
    });
});

describe("ping missing raiders route", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        auth.getUser.mockReturnValue({ id: "42", name: "Admin", isAdmin: true });
        auth.checkCsrf.mockReturnValue(true);
        auth.getActiveGuild.mockReturnValue("g1");
        mockGetAllEvents.mockResolvedValue([
            { id: "e1", channelId: "c1", title: "Kara", startTime: 100, signUps: [{ userId: "u1", specName: "Warrior" }] },
        ]);
        discord.getChannelCategoryMap.mockReturnValue({ c1: { name: "kara", categoryId: "cat", categoryName: "Raids" } });
        store.getConfig.mockReturnValue({ raidDefaults: {}, categoryIds: ["cat"], adminRoleIds: [], categoryRoles: { cat: ["r1"] } });
        discord.listMembersWithRoles.mockResolvedValue({
            members: [{ id: "u1", displayName: "Alice" }, { id: "u2", displayName: "Bob" }], error: null,
        });
        discord.postMissingPing.mockResolvedValue({ channelId: "c1", messageId: "m1", url: "u" });
    });

    it("POST /admin/raids/ping-missing pings only the non-responders", async () => {
        const res = await request("POST", "/admin/raids/ping-missing", { event: "e1", text: "Bitte melden" });
        expect(discord.listMembersWithRoles).toHaveBeenCalledWith("g1", ["r1"]);
        expect(discord.postMissingPing).toHaveBeenCalledWith("c1", ["u2"], "Bitte melden");
        expect(redirectTo(res)).toContain("/admin/raids/detail?event=e1&ok=");
    });

    it("errors when the category has no roles assigned", async () => {
        store.getConfig.mockReturnValue({ raidDefaults: {}, categoryIds: ["cat"], adminRoleIds: [], categoryRoles: {} });
        const res = await request("POST", "/admin/raids/ping-missing", { event: "e1" });
        expect(discord.postMissingPing).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("err=");
    });

    it("reports success without pinging when nobody is missing", async () => {
        discord.listMembersWithRoles.mockResolvedValueOnce({ members: [{ id: "u1", displayName: "Alice" }], error: null });
        const res = await request("POST", "/admin/raids/ping-missing", { event: "e1" });
        expect(discord.postMissingPing).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("ok=");
    });

    it("surfaces the members error (missing intent) without pinging", async () => {
        discord.listMembersWithRoles.mockResolvedValueOnce({ members: [], error: "Used disallowed intents" });
        const res = await request("POST", "/admin/raids/ping-missing", { event: "e1" });
        expect(discord.postMissingPing).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("err=");
    });

    it("rejects a bad CSRF token before doing anything", async () => {
        auth.checkCsrf.mockReturnValueOnce(false);
        const res = await request("POST", "/admin/raids/ping-missing", { event: "e1" });
        expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("msg=csrf");
    });
});

describe("settings categoryRoles", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        auth.getUser.mockReturnValue({ id: "42", name: "Admin", isAdmin: true });
        auth.checkCsrf.mockReturnValue(true);
        auth.getActiveGuild.mockReturnValue("g1");
    });

    it("POST /admin/settings collects chosen categories and their roles from checkboxes", async () => {
        const res = await request("POST", "/admin/settings", {
            "cat:cat": "1",
            "cat:cat2": "1",
            "catrole:cat:r1": "1",
            "catrole:cat:r2": "1",
            "catrole:other:r9": "1", // dropped: 'other' is not a chosen category
        });
        expect(store.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
            categoryIds: ["cat", "cat2"],
            categoryRoles: { cat: ["r1", "r2"] },
        }));
        expect(redirectTo(res)).toBe("/admin/settings?msg=saved");
    });
});

describe("recruitment applications tab (GET /admin/recruitment)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        auth.getUser.mockReturnValue({ id: "42", name: "Admin", isAdmin: true });
        auth.getActiveGuild.mockReturnValue("g1");
        store.getConfig.mockReturnValue({ raidDefaults: {}, categoryIds: [], adminRoleIds: [], applicationChannelId: "app1" });
        discord.listApplications.mockResolvedValue({ applications: [], error: null });
    });

    const lastRenderOpts = () => renderAdmin.renderRecruitment.mock.calls.at(-1)[1];

    it("fetches applications from the configured channel when the tab is open", async () => {
        discord.listApplications.mockResolvedValue({
            applications: [{ threadId: "1", name: "Feuer - Xyz", url: "u" }],
            error: null,
        });
        const res = await request("GET", "/admin/recruitment?view=applications");
        expect(res.end).toHaveBeenCalledWith("RECRUITMENT");
        expect(discord.listApplications).toHaveBeenCalledWith("app1");
        const opts = lastRenderOpts();
        expect(opts.view).toBe("applications");
        expect(opts.applications).toHaveLength(1);
        expect(opts.applicationChannelId).toBe("app1");
    });

    it("does NOT fetch applications on the default (templates) view", async () => {
        await request("GET", "/admin/recruitment");
        expect(discord.listApplications).not.toHaveBeenCalled();
        expect(lastRenderOpts().applications).toBeUndefined();
    });

    it("passes a fetch error through to the renderer", async () => {
        discord.listApplications.mockResolvedValue({ applications: [], error: "Bewerbungs-Channel nicht gefunden (ID prüfen)." });
        await request("GET", "/admin/recruitment?view=applications");
        expect(lastRenderOpts().applicationsError).toBe("Bewerbungs-Channel nicht gefunden (ID prüfen).");
    });
});

describe("raidsheet post-to-channel route", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        auth.getUser.mockReturnValue({ id: "42", name: "Admin", isAdmin: true });
        auth.checkCsrf.mockReturnValue(true);
        auth.getActiveGuild.mockReturnValue("g1");
        mockGetAllEvents.mockResolvedValue([
            { id: "e1", channelId: "c1", title: "GDKP Kara", startTime: 100, leaderId: "u1", signUps: [] },
        ]);
        discord.getChannelCategoryMap.mockReturnValue({
            c1: { name: "kara", categoryId: "cat", categoryName: "Raids" },
        });
    });

    it("posts the filled sheet link into the event channel with the optional message", async () => {
        mockGetEventSheet.mockReturnValue({ eventId: "e1", url: "https://docs.google.com/x" });
        const res = await request("POST", "/admin/raids/post-sheet", { event: "e1", message: "Bitte eintragen" });
        expect(discord.postLink).toHaveBeenCalledWith("c1", expect.objectContaining({
            url: "https://docs.google.com/x",
            message: "Bitte eintragen",
            title: expect.stringContaining("GDKP Kara"),
        }));
        expect(redirectTo(res)).toContain("/admin/raids/detail?event=e1&ok=");
    });

    it("errors when no sheet has been created yet", async () => {
        mockGetEventSheet.mockReturnValue(null);
        const res = await request("POST", "/admin/raids/post-sheet", { event: "e1" });
        expect(discord.postLink).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("/admin/raids/detail?event=e1&err=");
    });

    it("rejects a bad CSRF token", async () => {
        auth.checkCsrf.mockReturnValueOnce(false);
        const res = await request("POST", "/admin/raids/post-sheet", { event: "e1" });
        expect(discord.postLink).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("msg=csrf");
    });
});

describe("softres post-to-channel route", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        auth.getUser.mockReturnValue({ id: "42", name: "Admin", isAdmin: true });
        auth.checkCsrf.mockReturnValue(true);
        auth.getActiveGuild.mockReturnValue("g1");
        mockGetAllEvents.mockResolvedValue([
            { id: "e1", channelId: "c1", title: "SSC&TK&Gruul", startTime: 100, leaderId: "u1", signUps: [] },
        ]);
        discord.getChannelCategoryMap.mockReturnValue({
            c1: { name: "ssc-tk", categoryId: "cat", categoryName: "PUG Raids" },
        });
    });

    it("posts the softres link into the event channel with the optional message", async () => {
        mockGetEventSoftres.mockReturnValue({ eventId: "e1", url: "https://softres.it/raid/r1" });
        const res = await request("POST", "/admin/raids/post-softres", { event: "e1", message: "SR eintragen" });
        expect(discord.postLink).toHaveBeenCalledWith("c1", expect.objectContaining({
            url: "https://softres.it/raid/r1",
            message: "SR eintragen",
            title: expect.stringContaining("SSC&TK&Gruul"),
            label: "Softres öffnen",
        }));
        expect(redirectTo(res)).toContain("/admin/raids/detail?event=e1&ok=");
    });

    it("errors when no softres list exists yet", async () => {
        mockGetEventSoftres.mockReturnValue(null);
        const res = await request("POST", "/admin/raids/post-softres", { event: "e1" });
        expect(discord.postLink).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("/admin/raids/detail?event=e1&err=");
    });

    it("rejects a bad CSRF token", async () => {
        mockGetEventSoftres.mockReturnValue({ eventId: "e1", url: "https://softres.it/raid/r1" });
        auth.checkCsrf.mockReturnValueOnce(false);
        const res = await request("POST", "/admin/raids/post-softres", { event: "e1" });
        expect(discord.postLink).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("msg=csrf");
    });
});

describe("softres routes", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        auth.getUser.mockReturnValue({ id: "42", name: "Admin", isAdmin: true });
        auth.checkCsrf.mockReturnValue(true);
        auth.getActiveGuild.mockReturnValue("g1");
        mockGetAllEvents.mockResolvedValue([
            { id: "e1", channelId: "c1", title: "Kara + Gruul", startTime: 100, leaderId: "u1", signUps: [] },
        ]);
        discord.getChannelCategoryMap.mockReturnValue({
            c1: { name: "kara", categoryId: "cat", categoryName: "Raids" },
        });
        mockCreateRaid.mockResolvedValue({
            raidId: "r1", token: "t1", url: "https://softres.it/raid/r1", editUrl: "https://softres.it/raid/r1/t1",
        });
    });

    it("GET /admin/raids/softres/item-search proxies Wowhead and returns JSON", async () => {
        const res = await request("GET", "/admin/raids/softres/item-search?q=dragon&edition=tbc");
        expect(mockSearchItems).toHaveBeenCalledWith("dragon", { edition: "tbc" });
        const body = res.end.mock.calls[0][0];
        expect(JSON.parse(body).items[0].id).toBe(28830);
    });

    it("POST /admin/raids/softres creates a list with the chosen instances and reserves", async () => {
        const res = await request("POST", "/admin/raids/softres", {
            event: "e1", inst_kara: "1", inst_gruul: "1", amount: "2", faction: "Alliance",
            hardReserves: JSON.stringify([{ id: 28830, name: "Dragonspine Trophy" }]),
        });
        expect(mockCreateRaid).toHaveBeenCalledWith(expect.objectContaining({
            instances: expect.arrayContaining(["kara", "gruul"]),
            edition: "tbc",
            amount: "2",
            faction: "Alliance",
            hardReserves: [{ id: 28830, name: "Dragonspine Trophy" }],
        }));
        expect(mockSaveEventSoftres).toHaveBeenCalledWith("e1", expect.objectContaining({ raidId: "r1", edition: "tbc" }));
        expect(redirectTo(res)).toContain("/admin/raids/detail?event=e1&ok=");
    });

    it("errors when no instance is selected", async () => {
        const res = await request("POST", "/admin/raids/softres", { event: "e1", amount: "2", faction: "Alliance" });
        expect(mockCreateRaid).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("err=");
    });

    it("errors when instances mix editions", async () => {
        const res = await request("POST", "/admin/raids/softres", {
            event: "e1", inst_kara: "1", inst_mc: "1", amount: "2", faction: "Alliance",
        });
        expect(mockCreateRaid).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("err=");
    });

    it("surfaces a softres API error", async () => {
        mockCreateRaid.mockRejectedValueOnce(new Error("softres.it lehnte die Anfrage ab: nope"));
        const res = await request("POST", "/admin/raids/softres", {
            event: "e1", inst_kara: "1", amount: "1", faction: "Alliance",
        });
        expect(redirectTo(res)).toContain("err=");
    });
});

describe("log → event assignment routes", () => {
    // Raid starts 18:00 UTC, the log link is posted 30 minutes later.
    const START = Math.floor(Date.UTC(2026, 6, 24, 18, 0, 0) / 1000);
    const POSTED = Date.UTC(2026, 6, 24, 18, 30, 0);
    const openLog = (over = {}) => ({
        id: "l1", guildId: "g1", channelId: "c1", messageId: "m1", reportId: "RPT1",
        title: "SSC Log", status: "open", postedAt: POSTED, ...over,
    });

    beforeEach(() => {
        jest.clearAllMocks();
        auth.getUser.mockReturnValue({ id: "42", name: "Admin", isAdmin: true });
        auth.checkCsrf.mockReturnValue(true);
        auth.getActiveGuild.mockReturnValue("g1");
        auth.csrfToken.mockReturnValue("tok");
        mockGetPastEvents.mockResolvedValue([
            { id: "e1", channelId: "c1", title: "SSC/TK", startTime: START, signUps: [] },
        ]);
        discord.getChannelCategoryMap.mockReturnValue({
            c1: { name: "raid-logs", categoryId: "cat", categoryName: "Raids" },
        });
        discord.listGuilds.mockReturnValue([{ id: "g1", name: "Guild" }]);
        logStore.listLogs.mockReturnValue([openLog()]);
        logStore.getLog.mockReturnValue(openLog());
    });

    it("GET /admin/cla?view=logs offers the matching event per log", async () => {
        await request("GET", "/admin/cla?view=logs");
        const opts = renderAdmin.renderCla.mock.calls[0][1];
        expect(opts.matchEvents.map((e) => e.id)).toEqual(["e1"]);
        expect(opts.unlinkedCount).toBe(1);
        const item = opts.logPage.items[0];
        expect(item.candidates).toEqual([expect.objectContaining({ eventId: "e1", title: "SSC/TK" })]);
        expect(item.matchAmbiguous).toBe(false);
    });

    it("GET /admin/cla?view=logs looks weeks back for already finished raids", async () => {
        await request("GET", "/admin/cla?view=logs");
        const startFilter = mockGetPastEvents.mock.calls[mockGetPastEvents.mock.calls.length - 1][0];
        expect(typeof startFilter).toBe("number");
        expect(startFilter).toBeLessThan(Math.floor(Date.now() / 1000) - 7 * 86400);
    });

    it("GET /admin/cla?view=logs surfaces a Raid-Helper failure without breaking the page", async () => {
        mockGetPastEvents.mockRejectedValue(new Error("API down"));
        await request("GET", "/admin/cla?view=logs");
        const opts = renderAdmin.renderCla.mock.calls[0][1];
        expect(opts.matchEventsError).toBe("API down");
        expect(opts.matchEvents).toEqual([]);
    });

    it("GET /admin/cla?view=logs keeps an existing assignment instead of offering candidates", async () => {
        logStore.listLogs.mockReturnValue([openLog({ eventId: "e1", eventLabel: "SSC/TK" })]);
        await request("GET", "/admin/cla?view=logs");
        const opts = renderAdmin.renderCla.mock.calls[0][1];
        expect(opts.unlinkedCount).toBe(0);
        expect(opts.logPage.items[0].candidates).toBeUndefined();
    });

    it("POST /admin/cla/log-link stores the assignment with the event snapshot", async () => {
        const res = await request("POST", "/admin/cla/log-link", { logId: "l1", eventId: "e1" });
        expect(logStore.linkEvent).toHaveBeenCalledWith("l1", {
            eventId: "e1", eventLabel: "SSC/TK", eventStartTime: START, source: "manual",
        });
        expect(redirectTo(res)).toContain("/admin/cla?view=logs&ok=");
    });

    it("POST /admin/cla/log-link rejects an unknown log or event", async () => {
        logStore.getLog.mockReturnValue(null);
        const res1 = await request("POST", "/admin/cla/log-link", { logId: "nope", eventId: "e1" });
        expect(redirectTo(res1)).toContain("err=");

        logStore.getLog.mockReturnValue(openLog());
        const res2 = await request("POST", "/admin/cla/log-link", { logId: "l1", eventId: "e999" });
        expect(redirectTo(res2)).toContain("err=");
        expect(logStore.linkEvent).not.toHaveBeenCalled();
    });

    it("POST /admin/cla/log-link rejects an empty event selection", async () => {
        const res = await request("POST", "/admin/cla/log-link", { logId: "l1", eventId: "" });
        expect(logStore.linkEvent).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("err=");
    });

    it("POST /admin/cla/log-unlink removes the assignment", async () => {
        const res = await request("POST", "/admin/cla/log-unlink", { logId: "l1" });
        expect(logStore.unlinkEvent).toHaveBeenCalledWith("l1");
        expect(redirectTo(res)).toContain("ok=");
    });

    it("POST /admin/cla/log-unlink reports when there was nothing to remove", async () => {
        logStore.unlinkEvent.mockReturnValueOnce(null);
        const res = await request("POST", "/admin/cla/log-unlink", { logId: "l1" });
        expect(redirectTo(res)).toContain("err=");
    });

    it("POST /admin/cla/log-automatch assigns the unambiguous logs only", async () => {
        logStore.listLogs.mockReturnValue([
            openLog(),
            // posted days later — no event in the window, stays unassigned
            openLog({ id: "l2", reportId: "RPT2", postedAt: POSTED + 40 * 3600 * 1000 }),
            // already assigned — untouched
            openLog({ id: "l3", reportId: "RPT3", eventId: "e1" }),
        ]);
        const res = await request("POST", "/admin/cla/log-automatch");
        expect(logStore.linkEvent).toHaveBeenCalledTimes(1);
        expect(logStore.linkEvent).toHaveBeenCalledWith("l1", expect.objectContaining({ eventId: "e1", source: "auto" }));
        const location = decodeURIComponent(redirectTo(res));
        expect(location).toContain("1 Log(s) automatisch zugeordnet");
        expect(location).toContain("1 ohne eindeutiges Event");
    });

    it("POST /admin/cla/log-automatch surfaces a Raid-Helper failure", async () => {
        mockGetPastEvents.mockRejectedValue(new Error("API down"));
        const res = await request("POST", "/admin/cla/log-automatch");
        expect(logStore.linkEvent).not.toHaveBeenCalled();
        expect(redirectTo(res)).toContain("err=");
    });
});
