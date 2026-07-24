// Route tests for the raid-template and channel-management admin endpoints.
// Every collaborator is mocked so routing is exercised in isolation.
const { EventEmitter } = require("events");

const mockGetTemplates = jest.fn();
const mockGetSetup = jest.fn();
const mockGetAllEvents = jest.fn();
const mockCreateEvent = jest.fn();

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
jest.mock("../../src/web/discord", () => ({
    setClient: jest.fn(),
    listGuilds: jest.fn(() => [{ id: "g1", name: "G" }]),
    listTextChannels: jest.fn(() => []),
    listCategories: jest.fn(() => [{ id: "cat", name: "Raids" }]),
    listAllChannels: jest.fn(() => [{ id: "t1", name: "kara" }]),
    listRoles: jest.fn(() => []),
    getChannelCategoryMap: jest.fn(() => ({})),
    postAnnouncement: jest.fn(),
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
});
