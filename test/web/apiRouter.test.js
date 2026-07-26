const { EventEmitter } = require("events");

jest.mock("../../src/web/auth", () => ({
    getUser: jest.fn(),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(),
}));
jest.mock("../../src/web/reportStore", () => ({ listReports: jest.fn(() => []) }));
jest.mock("../../src/web/settingsStore", () => ({
    getConfig: jest.fn(() => ({})),
    listRecruitment: jest.fn(() => []),
    listRecruitmentPosts: jest.fn(() => []),
}));
jest.mock("../../src/web/activeGuild", () => ({ activeGuildFor: jest.fn(() => "") }));
jest.mock("../../src/web/dashboardData", () => ({
    loadUpcomingSetups: jest.fn(() => Promise.resolve({ events: [], error: null })),
    loadRecentEvents: jest.fn(() => Promise.resolve({ events: [], error: null })),
}));
jest.mock("../../src/web/discord", () => ({
    listCategories: jest.fn(() => []),
    listAllChannels: jest.fn(() => []),
    createChannel: jest.fn(),
    duplicateChannel: jest.fn(),
}));

const auth = require("../../src/web/auth");
const reportStore = require("../../src/web/reportStore");
const settingsStore = require("../../src/web/settingsStore");
const { activeGuildFor } = require("../../src/web/activeGuild");
const dashboardData = require("../../src/web/dashboardData");
const discord = require("../../src/web/discord");
const { handle } = require("../../src/web/apiRouter");

function mockRes() {
    return { writeHead: jest.fn(), end: jest.fn() };
}

function body(res) {
    return JSON.parse(res.end.mock.calls[0][0]);
}

// Drive a POST /api/* request through the router with a JSON body.
async function post(pathname, jsonBody, headers) {
    const req = new EventEmitter();
    req.method = "POST";
    req.headers = { "x-csrf-token": "tok", ...headers };
    const res = mockRes();
    const p = handle(pathname, req, res);
    req.emit("data", JSON.stringify(jsonBody || {}));
    req.emit("end");
    await p;
    return res;
}

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

    it("responds 404 with a JSON error for an unknown /api/ route", async () => {
        const res = mockRes();
        const handled = await handle("/api/does-not-exist", { method: "GET" }, res);
        expect(handled).toBe(true);
        expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        expect(body(res)).toEqual({ error: { code: "not_found", message: expect.any(String) } });
    });
});
