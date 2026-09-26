const { mockRes, json, jsonRequest, routerClient } = require("../helpers/http");

jest.mock("../../src/web/auth", () => ({
    getUser: jest.fn(),
    // "Ansicht als Rolle": the caller's own rights, and starting/stopping the view
    getRealUser: jest.fn(),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../src/web/reportStore", () => ({
    listReports: jest.fn(() => []),
    deleteReport: jest.fn(() => true),
    getReport: jest.fn(() => null),
    saveReport: jest.fn((report, id) => id || "new-id"),
}));
jest.mock("../../src/web/activeGuild", () => ({ activeGuildFor: jest.fn(() => "") }));
jest.mock("../../src/web/logStore", () => ({
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
jest.mock("../../src/web/discord", () => require("../helpers/discordMock").withClientHelpers({
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
jest.mock("../../src/web/raidEventGroups", () => ({
    loadEventGroups: jest.fn(() => Promise.resolve({ groups: [], error: null })),
    eventLookbackSince: jest.fn(() => 0),
    fetchEventsCached: jest.fn(() => Promise.resolve({ events: [] })),
}));
const auth = require("../../src/web/auth");
const reportStore = require("../../src/web/reportStore");
const { activeGuildFor } = require("../../src/web/activeGuild");
const discord = require("../../src/web/discord");
const raidEventGroups = require("../../src/web/raidEventGroups");
const logStore = require("../../src/web/logStore");
const { AppError } = require("../../src/web/apiResult");
const { emptyAccess } = require("../../src/config/permissions");
const { request, post, patch, urlFor, handle } = routerClient();

describe("web/apiRouter", () => {
    // A route that throws must not escape to server.js's catch-all, which answers
    // with the plain-text body "error" — the client then fails on res.json() with
    // a bare "Unexpected token" instead of showing what actually broke.
    describe("error handling", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
        });

        it("turns an escaping exception into a JSON error carrying the real message", async () => {
            logStore.getLog.mockImplementation(() => { throw new Error("Datenspeicher kaputt"); });
            const res = await post("/api/cla/eval", { logId: "l1" });
            expect(res.writeHead).toHaveBeenCalledWith(500, expect.objectContaining({
                "Content-Type": "application/json; charset=utf-8",
            }));
            expect(json(res)).toEqual({
                error: { code: "internal_error", message: "Datenspeicher kaputt" },
            });
        });

        it("falls back to a generic message when the failure carries none", async () => {
            logStore.getLog.mockImplementation(() => { throw new Error(""); });
            const res = await post("/api/cla/eval", { logId: "l1" });
            expect(json(res).error).toEqual({
                code: "internal_error", message: "Unerwarteter Serverfehler.",
            });
        });

        it("reports the request as handled so nothing falls through", async () => {
            logStore.getLog.mockImplementation(() => { throw new Error("boom"); });
            const req = jsonRequest("POST", "/api/cla/eval", { logId: "l1" }, { "x-csrf-token": "tok" });
            expect(await handle("/api/cla/eval", req, mockRes())).toBe(true);
        });

        it("keeps the 404 JSON shape for unknown endpoints and reports them handled", async () => {
            const res = mockRes();
            expect(await handle("/api/does-not-exist", { method: "GET" }, res)).toBe(true);
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(json(res)).toEqual({
                error: { code: "not_found", message: "Unbekannter API-Endpunkt." },
            });
        });

        // The route table (#421): a path the API knows, called with a method it
        // has no handler for, is told which methods it does answer to.
        it("answers 405 with the allowed methods for a known path and a wrong method", async () => {
            const res = await request("DELETE", "/api/dashboard", {});
            expect(res.writeHead).toHaveBeenCalledWith(405, expect.objectContaining({ Allow: "GET" }));
            expect(json(res).error.code).toBe("method_not_allowed");
            expect(json(res).error.message).toContain("DELETE");
            expect(json(res).error.message).toContain("GET");
        });

        it("lists every method of a path in the 405", async () => {
            const res = await request("DELETE", "/api/channels", {});
            expect(res.writeHead).toHaveBeenCalledWith(405, expect.objectContaining({ Allow: "GET, POST, PATCH" }));
        });

        it("refuses a wrong method on a path the caller may not use before saying 405", async () => {
            auth.getUser.mockReturnValue({ id: "7", name: "Bob", isAdmin: false, access: { raids: { read: true, write: false } } });
            const res = await request("DELETE", "/api/dashboard", {});
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
        });

        // A handler's own answer, thrown instead of sent: apiResult.js's AppError
        it("sends an AppError with its own status and code instead of a 500", async () => {
            logStore.getLog.mockImplementation(() => { throw new AppError("busy", 409, "Gerade nicht."); });
            const res = await post("/api/cla/eval", { logId: "l1" });
            expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "busy", message: "Gerade nicht." } });
        });
    });

    // End-to-end proof that the central gate (src/web/apiAccess.js) runs before
    // any handler — the per-endpoint rules themselves live in apiAccess.test.js.
    describe("area gate", () => {
        const readOnlyRaider = {
            id: "7", name: "Bob", isAdmin: false,
            access: { ...emptyAccess(), raids: { read: true, write: false } },
        };

        it("lets a read-only role load its area", async () => {
            auth.getUser.mockReturnValue(readOnlyRaider);
            activeGuildFor.mockReturnValue("guild-1");
            raidEventGroups.loadEventGroups.mockResolvedValue({ groups: [], error: null });

            const res = mockRes();
            await handle("/api/raids", { method: "GET" }, res);

            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        });

        it("blocks the same role from acting in it, before the handler runs", async () => {
            auth.getUser.mockReturnValue(readOnlyRaider);
            auth.checkCsrf.mockReturnValue(true);

            const res = await post("/api/raids/notify", { eventId: "e1" });

            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(json(res).error.code).toBe("forbidden");
            expect(discord.postAnnouncement).not.toHaveBeenCalled();
        });

        it("needs raids write to edit an event (PATCH /api/raids, #261)", async () => {
            auth.getUser.mockReturnValue(readOnlyRaider);
            auth.checkCsrf.mockReturnValue(true);
            const denied = await patch("/api/raids", { id: "eh-1", title: "x" });
            expect(denied.writeHead).toHaveBeenCalledWith(403, expect.any(Object));

            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            // a Raid-Helper event is edited at Raid-Helper, never here
            const refused = await patch("/api/raids", { id: "123456", title: "x" });
            expect(refused.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(refused).error.code).toBe("not_own_event");
        });

        it("blocks an area the role was not given at all", async () => {
            auth.getUser.mockReturnValue(readOnlyRaider);

            const res = mockRes();
            await handle("/api/cla", { method: "GET" }, res, urlFor("/api/cla"));

            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
            expect(reportStore.listReports).not.toHaveBeenCalled();
        });
    });
});
