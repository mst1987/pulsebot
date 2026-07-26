const { EventEmitter } = require("events");

jest.mock("../../src/web/auth", () => ({
    getUser: jest.fn(),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(),
}));
jest.mock("../../src/web/reportStore", () => ({ listReports: jest.fn(() => []) }));
jest.mock("../../src/web/settingsStore", () => ({
    getConfig: jest.fn(() => ({})),
    saveConfig: jest.fn((partial) => ({ ...partial })),
    listRecruitment: jest.fn(() => []),
    listRecruitmentPosts: jest.fn(() => []),
    listRaidsheets: jest.fn(() => []),
    saveRaidsheet: jest.fn(),
    deleteRaidsheet: jest.fn(),
    listRaidTemplates: jest.fn(() => []),
    saveRaidTemplate: jest.fn(),
    saveRaidTemplates: jest.fn(),
    deleteRaidTemplate: jest.fn(),
}));
jest.mock("../../src/web/activeGuild", () => ({ activeGuildFor: jest.fn(() => "") }));
jest.mock("../../src/web/dashboardData", () => ({
    loadUpcomingSetups: jest.fn(() => Promise.resolve({ events: [], error: null })),
    loadRecentEvents: jest.fn(() => Promise.resolve({ events: [], error: null })),
}));
jest.mock("../../src/web/discord", () => ({
    listCategories: jest.fn(() => []),
    listAllChannels: jest.fn(() => []),
    listTextChannels: jest.fn(() => []),
    listRoles: jest.fn(() => []),
    createChannel: jest.fn(),
    duplicateChannel: jest.fn(),
}));
jest.mock("../../src/web/raidEventGroups", () => ({
    loadEventGroups: jest.fn(() => Promise.resolve({ groups: [], error: null })),
}));
const mockGetTemplates = jest.fn(() => Promise.resolve([]));
const mockCreateEvent = jest.fn(() => Promise.resolve({ id: "ev1" }));
jest.mock("../../src/classes/raidhelper", () =>
    jest.fn().mockImplementation(() => ({
        getTemplates: mockGetTemplates,
        createEvent: mockCreateEvent,
    })));

const auth = require("../../src/web/auth");
const reportStore = require("../../src/web/reportStore");
const settingsStore = require("../../src/web/settingsStore");
const { activeGuildFor } = require("../../src/web/activeGuild");
const dashboardData = require("../../src/web/dashboardData");
const discord = require("../../src/web/discord");
const raidEventGroups = require("../../src/web/raidEventGroups");
const { handle } = require("../../src/web/apiRouter");

function mockRes() {
    return { writeHead: jest.fn(), end: jest.fn() };
}

function body(res) {
    return JSON.parse(res.end.mock.calls[0][0]);
}

// Drive a mutating /api/* request through the router with a JSON body.
async function request(method, pathname, jsonBody, headers) {
    const req = new EventEmitter();
    req.method = method;
    req.headers = { "x-csrf-token": "tok", ...headers };
    const res = mockRes();
    const p = handle(pathname, req, res);
    req.emit("data", JSON.stringify(jsonBody || {}));
    req.emit("end");
    await p;
    return res;
}
const post = (pathname, jsonBody, headers) => request("POST", pathname, jsonBody, headers);
const patch = (pathname, jsonBody, headers) => request("PATCH", pathname, jsonBody, headers);

describe("web/apiRouter", () => {
    describe("GET /api/session", () => {
        it("returns user + csrfToken for a logged-in caller", async () => {
            auth.getUser.mockReturnValue({ id: "42", name: "Anna", isAdmin: true });
            auth.csrfToken.mockReturnValue("csrf-abc");
            const res = mockRes();
            const handled = await handle("/api/session", { method: "GET" }, res);
            expect(handled).toBe(true);
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(body(res)).toEqual({
                data: { user: { id: "42", name: "Anna", isAdmin: true }, csrfToken: "csrf-abc" },
            });
        });

        it("returns user: null and no csrfToken for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            await handle("/api/session", { method: "GET" }, res);
            expect(auth.csrfToken).not.toHaveBeenCalled();
            expect(body(res)).toEqual({ data: { user: null, csrfToken: null } });
        });
    });

    describe("GET /api/dashboard", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            const handled = await handle("/api/dashboard", { method: "GET" }, res);
            expect(handled).toBe(true);
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
        });

        it("returns 403 for a logged-in non-admin", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Bob", isAdmin: false });
            const res = mockRes();
            await handle("/api/dashboard", { method: "GET" }, res);
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "forbidden", message: expect.any(String) } });
        });

        it("assembles stats, recent reports, upcoming/recent events, and the active guild for an admin", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            reportStore.listReports.mockReturnValue([
                { id: "r1", title: "Report 1", zone: "MC", generatedAt: 100, issueCount: 2 },
                { id: "r2", title: "Report 2", zone: "BWL", generatedAt: 200, issueCount: 0 },
            ]);
            settingsStore.getConfig.mockReturnValue({ categoryIds: ["a", "b"], adminRoleIds: ["r"] });
            settingsStore.listRecruitment.mockReturnValue([{ id: "t1" }]);
            settingsStore.listRecruitmentPosts.mockReturnValue([{ id: "p1" }, { id: "p2" }]);
            activeGuildFor.mockReturnValue("guild-1");
            dashboardData.loadUpcomingSetups.mockResolvedValue({ events: [{ id: "u1" }], error: null });
            dashboardData.loadRecentEvents.mockResolvedValue({ events: [{ id: "e1" }], error: null });

            const res = mockRes();
            const handled = await handle("/api/dashboard", { method: "GET" }, res);

            expect(handled).toBe(true);
            expect(dashboardData.loadUpcomingSetups).toHaveBeenCalledWith("guild-1", 3);
            expect(dashboardData.loadRecentEvents).toHaveBeenCalledWith("guild-1", 5);
            expect(body(res)).toEqual({
                data: {
                    stats: {
                        reportsTotal: 2,
                        reportsWithIssues: 1,
                        templates: 1,
                        posts: 2,
                        categories: 2,
                        adminRoles: 1,
                    },
                    recentReports: [
                        { id: "r1", title: "Report 1", zone: "MC", generatedAt: 100, issueCount: 2 },
                        { id: "r2", title: "Report 2", zone: "BWL", generatedAt: 200, issueCount: 0 },
                    ],
                    upcoming: { events: [{ id: "u1" }], error: null },
                    recentEvents: { events: [{ id: "e1" }], error: null },
                    activeGuildId: "guild-1",
                },
            });
        });
    });

    describe("GET /api/channels", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            await handle("/api/channels", { method: "GET" }, res);
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });

        it("returns the active guild's categories and channels for an admin", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            discord.listCategories.mockReturnValue([{ id: "cat1", name: "Raids" }]);
            discord.listAllChannels.mockReturnValue([{ id: "c1", name: "kara", type: 0, typeLabel: "Text", category: "Raids", parentId: "cat1" }]);

            const res = mockRes();
            await handle("/api/channels", { method: "GET" }, res);

            expect(body(res)).toEqual({
                data: {
                    categories: [{ id: "cat1", name: "Raids" }],
                    channels: [{ id: "c1", name: "kara", type: 0, typeLabel: "Text", category: "Raids", parentId: "cat1" }],
                    activeGuildId: "guild-1",
                },
            });
        });
    });

    describe("POST /api/channels", () => {
        it("returns 403 when the CSRF token is invalid", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(false);
            const res = await post("/api/channels", { name: "kara-signup" });
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "csrf", message: expect.any(String) } });
            expect(discord.createChannel).not.toHaveBeenCalled();
        });

        it("returns 400 when no guild is active", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("");
            const res = await post("/api/channels", { name: "kara-signup" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "no_guild", message: expect.any(String) } });
        });

        it("creates the channel and returns it on success", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            discord.createChannel.mockResolvedValue({ id: "c9", name: "kara-signup" });

            const res = await post("/api/channels", { name: " kara-signup ", type: "voice", parentId: "cat1" });

            expect(discord.createChannel).toHaveBeenCalledWith("guild-1", { name: "kara-signup", type: "voice", parentId: "cat1" });
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(body(res)).toEqual({ data: { id: "c9", name: "kara-signup" } });
        });

        it("returns 400 with the Discord error message on failure", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            discord.createChannel.mockRejectedValue(new Error("Kanalname fehlt."));

            const res = await post("/api/channels", {});

            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "create_failed", message: "Kanalname fehlt." } });
        });
    });

    describe("POST /api/channels/duplicate", () => {
        it("returns 400 when no channel id is given", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/channels/duplicate", { name: "clone" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "no_channel", message: expect.any(String) } });
            expect(discord.duplicateChannel).not.toHaveBeenCalled();
        });

        it("duplicates the channel and returns it on success", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            discord.duplicateChannel.mockResolvedValue({ id: "c10", name: "kara-signup-2" });

            const res = await post("/api/channels/duplicate", { channelId: "c1", name: "kara-signup-2" });

            expect(discord.duplicateChannel).toHaveBeenCalledWith("c1", "kara-signup-2");
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(body(res)).toEqual({ data: { id: "c10", name: "kara-signup-2" } });
        });
    });

    describe("GET /api/settings", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            await handle("/api/settings", { method: "GET" }, res);
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });

        it("returns config, raidsheets, roles, categories and the active guild for an admin", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            settingsStore.getConfig.mockReturnValue({ adminRoleIds: ["r1"] });
            settingsStore.listRaidsheets.mockReturnValue([{ id: "s1", name: "Tier 4/5" }]);
            discord.listRoles.mockReturnValue([{ id: "role1", name: "Raider" }]);
            discord.listCategories.mockReturnValue([{ id: "cat1", name: "Raids" }]);

            const res = mockRes();
            await handle("/api/settings", { method: "GET" }, res);

            expect(body(res)).toEqual({
                data: {
                    config: { adminRoleIds: ["r1"] },
                    raidsheets: [{ id: "s1", name: "Tier 4/5" }],
                    roles: [{ id: "role1", name: "Raider" }],
                    categories: [{ id: "cat1", name: "Raids" }],
                    activeGuildId: "guild-1",
                },
            });
        });
    });

    describe("PATCH /api/settings", () => {
        it("returns 403 when the CSRF token is invalid", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(false);
            const res = await patch("/api/settings", { officerRoleId: "r1" });
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(settingsStore.saveConfig).not.toHaveBeenCalled();
        });

        it("only forwards fields present in the body, trimmed/split as needed", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);

            await patch("/api/settings", {
                adminRoleIds: [" r1 ", "r2", ""],
                officerRoleId: " off1 ",
                categoryRoles: { cat1: ["role1"] },
                blizzard: { clientSecret: "" },
            });

            expect(settingsStore.saveConfig).toHaveBeenCalledWith({
                adminRoleIds: ["r1", "r2"],
                officerRoleId: "off1",
                categoryRoles: { cat1: ["role1"] },
                blizzard: { clientSecret: "" },
            });
        });

        it("omits blizzard entirely when not present in the body, keeping the stored secret", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);

            await patch("/api/settings", { officerRoleId: "off1" });

            expect(settingsStore.saveConfig).toHaveBeenCalledWith({ officerRoleId: "off1" });
        });
    });

    describe("POST /api/settings/raidsheets", () => {
        it("returns 400 when the name is missing", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/settings/raidsheets", { spreadsheetId: "abc" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(settingsStore.saveRaidsheet).not.toHaveBeenCalled();
        });

        it("saves the raidsheet and returns it", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.saveRaidsheet.mockReturnValue({ id: "s1", name: "Tier 4/5" });

            const res = await post("/api/settings/raidsheets", { name: "Tier 4/5" });

            expect(settingsStore.saveRaidsheet).toHaveBeenCalledWith({ name: "Tier 4/5" });
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(body(res)).toEqual({ data: { id: "s1", name: "Tier 4/5" } });
        });
    });

    describe("POST /api/settings/raidsheets/delete", () => {
        it("returns 404 when nothing was removed", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.deleteRaidsheet.mockReturnValue(false);
            const res = await post("/api/settings/raidsheets/delete", { id: "s1" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        });

        it("deletes and returns the id on success", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.deleteRaidsheet.mockReturnValue(true);
            const res = await post("/api/settings/raidsheets/delete", { id: "s1" });
            expect(settingsStore.deleteRaidsheet).toHaveBeenCalledWith("s1");
            expect(body(res)).toEqual({ data: { id: "s1" } });
        });
    });

    describe("GET /api/raids", () => {
        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = mockRes();
            await handle("/api/raids", { method: "GET" }, res);
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(raidEventGroups.loadEventGroups).not.toHaveBeenCalled();
        });

        it("returns the active guild's upcoming events grouped by category", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [{ id: "e1", title: "Kara" }] }],
                error: null,
            });

            const res = mockRes();
            await handle("/api/raids", { method: "GET" }, res);

            expect(raidEventGroups.loadEventGroups).toHaveBeenCalledWith("guild-1");
            expect(body(res)).toEqual({
                data: {
                    groups: [{ categoryId: "cat1", categoryName: "Raids", events: [{ id: "e1", title: "Kara" }] }],
                    error: null,
                    activeGuildId: "guild-1",
                },
            });
        });

        it("passes the Raid-Helper API error through instead of failing the request", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("guild-1");
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: "Raid-Helper nicht erreichbar." });

            const res = mockRes();
            await handle("/api/raids", { method: "GET" }, res);

            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(body(res)).toEqual({
                data: { groups: [], error: "Raid-Helper nicht erreichbar.", activeGuildId: "guild-1" },
            });
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
            settingsStore.getConfig.mockReturnValue({ raidDefaults: { templateId: "t1", channelId: "c1" } });
            settingsStore.listRaidTemplates.mockReturnValue([{ id: "t1", name: "GDKP Kara" }]);
            discord.listTextChannels.mockReturnValue([{ id: "c1", name: "kara", category: "Raids" }]);
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [
                    { id: "e1", title: "Kara", templateId: "t1", description: "desc", channelId: "c1", channelName: "kara" },
                ] }],
                error: null,
            });

            const res = mockRes();
            await handle("/api/raids/new", { method: "GET" }, res);

            expect(body(res)).toEqual({
                data: {
                    defaults: { templateId: "t1", channelId: "c1" },
                    leaderId: "42",
                    channels: [{ id: "c1", name: "kara", category: "Raids" }],
                    templates: [{ id: "t1", name: "GDKP Kara" }],
                    reusableEvents: [{ id: "e1", title: "Kara", templateId: "t1", description: "desc", channelId: "c1", channelName: "kara" }],
                },
            });
        });
    });

    describe("POST /api/raids", () => {
        it("returns 400 for an invalid date", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/raids", { date: "not-a-date", channelId: "c1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "invalid_date", message: expect.any(String) } });
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
            expect(body(res)).toEqual({ data: { id: "ev1" } });
        });

        it("clones the source event's channel when sourceEventId is given", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            raidEventGroups.loadEventGroups.mockResolvedValue({
                groups: [{ categoryId: "cat1", categoryName: "Raids", events: [{ id: "e1", channelId: "c-old" }] }],
                error: null,
            });
            discord.duplicateChannel.mockResolvedValue({ id: "c-new", name: "kara-clone" });
            mockCreateEvent.mockResolvedValue({ id: "ev2" });

            const res = await post("/api/raids", {
                date: "2026-07-12", time: "20:00", title: "Kara", sourceEventId: "e1", channelName: "kara-clone",
            });

            expect(discord.duplicateChannel).toHaveBeenCalledWith("c-old", "kara-clone");
            expect(mockCreateEvent).toHaveBeenCalledWith(expect.objectContaining({ channelId: "c-new" }));
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
        });

        it("returns 400 with Raid-Helper's reason when it rejects the event", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            mockCreateEvent.mockResolvedValue({ status: "failed", reason: "invalid token" });

            const res = await post("/api/raids", { date: "2026-07-12", time: "20:00", channelId: "c1" });

            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(body(res)).toEqual({ error: { code: "create_failed", message: "invalid token" } });
        });
    });

    describe("GET /api/raid-templates", () => {
        it("returns the stored templates", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            settingsStore.listRaidTemplates.mockReturnValue([{ id: "t1", name: "GDKP Kara" }]);
            const res = mockRes();
            await handle("/api/raid-templates", { method: "GET" }, res);
            expect(body(res)).toEqual({ data: { templates: [{ id: "t1", name: "GDKP Kara" }] } });
        });
    });

    describe("POST /api/raid-templates", () => {
        it("returns 400 when saveRaidTemplate rejects a blank id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.saveRaidTemplate.mockReturnValue(null);
            const res = await post("/api/raid-templates", { name: "GDKP Kara" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("saves and returns the template", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.saveRaidTemplate.mockReturnValue({ id: "t1", name: "GDKP Kara" });
            const res = await post("/api/raid-templates", { id: "t1", name: "GDKP Kara" });
            expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
            expect(body(res)).toEqual({ data: { id: "t1", name: "GDKP Kara" } });
        });
    });

    describe("POST /api/raid-templates/delete", () => {
        it("returns 404 when nothing was removed", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.deleteRaidTemplate.mockReturnValue(false);
            const res = await post("/api/raid-templates/delete", { id: "t1" });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        });

        it("deletes and returns the id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            settingsStore.deleteRaidTemplate.mockReturnValue(true);
            const res = await post("/api/raid-templates/delete", { id: "t1" });
            expect(body(res)).toEqual({ data: { id: "t1" } });
        });
    });

    describe("POST /api/raid-templates/import", () => {
        it("returns 400 when Raid-Helper has no templates", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            mockGetTemplates.mockResolvedValue([]);
            const res = await post("/api/raid-templates/import", {});
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("imports and returns added/updated counts plus the refreshed list", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            mockGetTemplates.mockResolvedValue([{ id: "t1", name: "GDKP Kara" }]);
            settingsStore.saveRaidTemplates.mockReturnValue({ added: 1, updated: 0 });
            settingsStore.listRaidTemplates.mockReturnValue([{ id: "t1", name: "GDKP Kara" }]);

            const res = await post("/api/raid-templates/import", {});

            expect(settingsStore.saveRaidTemplates).toHaveBeenCalledWith([{ id: "t1", name: "GDKP Kara" }]);
            expect(body(res)).toEqual({ data: { added: 1, updated: 0, templates: [{ id: "t1", name: "GDKP Kara" }] } });
        });
    });

    it("responds 404 with a JSON error for an unknown /api/ route", async () => {
        const res = mockRes();
        const handled = await handle("/api/does-not-exist", { method: "GET" }, res);
        expect(handled).toBe(true);
        expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        expect(body(res)).toEqual({ error: { code: "not_found", message: expect.any(String) } });
    });
});
