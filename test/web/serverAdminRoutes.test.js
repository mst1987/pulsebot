// Route tests for the raid-template and channel-management admin endpoints.
// Every collaborator is mocked so routing is exercised in isolation.
const { EventEmitter } = require("events");

const mockGetTemplates = jest.fn();
const mockGetSetup = jest.fn();
const mockGetAllEvents = jest.fn();
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
let mockBlizzardConfigured = false;
jest.mock("../../src/classes/blizzard", () =>
    jest.fn().mockImplementation(() => ({
        isConfigured: () => mockBlizzardConfigured,
        getEquipment: mockBlizzardEquip,
    })));
jest.mock("../../src/web/logStore", () => ({
    listLogs: jest.fn(() => []),
    deleteLog: jest.fn(),
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
}));
jest.mock("../../src/classes/raidhelper", () =>
    jest.fn().mockImplementation(() => ({
        getTemplates: mockGetTemplates,
        getSetup: mockGetSetup,
        getAllEvents: mockGetAllEvents,
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
        mockFillSetupSheet.mockResolvedValue({ playerCount: 25 });
    });

    it("copies the source sheet, shares it, fills the copy, and schedules deletion", async () => {
        const res = await request("POST", "/admin/raids/fill", { event: "e1", sheetId: "tier45", tank3: "Cosma" });
        // copy of the source (never the source itself)
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
        expect(redirectTo(res)).toContain("/admin/raids/detail?event=e1");
        expect(redirectTo(res)).toContain("ok=");
    });

    it("deletes the previous copy's Drive file before creating a new one on re-fill", async () => {
        mockGetEventSheet.mockReturnValue({ spreadsheetId: "copy-old", eventId: "e1" });
        await request("POST", "/admin/raids/fill", { event: "e1", sheetId: "tier45" });
        expect(mockDeleteFile).toHaveBeenCalledWith("copy-old");
        expect(mockCopyFile).toHaveBeenCalled();
    });

    it("errors without copying when the setup is empty", async () => {
        mockGetSetup.mockResolvedValueOnce({ setup: [] });
        const res = await request("POST", "/admin/raids/fill", { event: "e1", sheetId: "tier45" });
        expect(mockCopyFile).not.toHaveBeenCalled();
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

describe("raidsheet fill route records the fill", () => {
    beforeEach(() => {
        store.getRaidsheet.mockReturnValue({ id: "tier45", name: "Tier 4/5", spreadsheetId: "sheet123", sheetName: "Setup", gid: "0" });
        mockGetEventSheet.mockReturnValue(null);
        mockCopyFile.mockResolvedValue({ id: "copy-1", url: "https://docs.google.com/spreadsheets/d/copy-1/edit" });
        mockShareAnyoneWriter.mockResolvedValue();
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
            blizzard: { clientId: "cid", region: "eu", realmSlug: "thunderstrike", clientSecret: "sec" },
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

    it("GET /admin/history/char queries Blizzard gear when configured", async () => {
        mockBlizzardConfigured = true;
        mockBlizzardEquip.mockResolvedValue([{ slot: "HEAD", itemId: 1, name: "Hat" }]);
        await request("GET", "/admin/history/char?name=Foo");
        expect(mockBlizzardEquip).toHaveBeenCalledWith("Foo");
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
