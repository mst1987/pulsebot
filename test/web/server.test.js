// Never bind a real port: mock http so createServer returns a fake server.
jest.mock("http", () => {
    const fakeServer = { on: jest.fn(), listen: jest.fn() };
    return {
        __fakeServer: fakeServer,
        createServer: jest.fn(() => fakeServer),
    };
});
// Isolate routing from disk/network by mocking the collaborators.
jest.mock("../../src/web/reportStore", () => ({
    getReport: jest.fn(),
    deleteReport: jest.fn(),
    listReports: jest.fn(() => []),
}));
jest.mock("../../src/web/render", () => ({
    renderReportPage: jest.fn(() => "REPORT_PAGE"),
    renderPlayerPage: jest.fn(() => "PLAYER_PAGE"),
    renderNotFound: jest.fn(() => "NOT_FOUND"),
    renderError: jest.fn(() => "ERROR_PAGE"),
}));
jest.mock("../../src/web/renderAdmin", () => ({
    renderDashboard: jest.fn(() => "DASHBOARD"),
    renderAdminDenied: jest.fn(() => "DENIED"),
    renderRecruitment: jest.fn(() => "RECRUITMENT"),
    renderCla: jest.fn(() => "CLA"),
    renderRaids: jest.fn(() => "RAIDS"),
    renderSettings: jest.fn(() => "SETTINGS"),
}));
jest.mock("../../src/web/auth", () => ({
    configured: jest.fn(() => true),
    loginUrl: jest.fn(() => "https://discord.example/authorize"),
    completeLogin: jest.fn(),
    destroy: jest.fn(),
    getUser: jest.fn(() => null),
    parseCookies: jest.fn(() => ({})),
}));

const http = require("http");
const store = require("../../src/web/reportStore");
const render = require("../../src/web/render");
const auth = require("../../src/web/auth");
const { webPort } = require("../../src/config/variables");
const { startWebServer } = require("../../src/web/server.js");

// The server is created lazily on the very first startWebServer() call and is
// idempotent thereafter. Capture the load-time facts now, before Jest's
// clearMocks (beforeEach) wipes the recorded calls.
const firstReturn = startWebServer();
const capturedHandler = http.createServer.mock.calls[0][0];
const createCallsAtLoad = http.createServer.mock.calls.length;
const listenArgsAtLoad = http.__fakeServer.listen.mock.calls[0];

const flush = () => new Promise((r) => setImmediate(r));

function mockRes() {
    return { writeHead: jest.fn(), end: jest.fn() };
}

// exercise a single request against the captured handler
async function request(req) {
    const res = mockRes();
    await capturedHandler(req, res);
    await flush();
    return res;
}

describe("web/server", () => {
    describe("startWebServer", () => {
        it("created the server exactly once at load and listened on the configured port", () => {
            expect(createCallsAtLoad).toBe(1);
            expect(listenArgsAtLoad[0]).toBe(webPort);
            expect(typeof listenArgsAtLoad[1]).toBe("function");
        });

        it("returns the same server instance on repeated calls (idempotent)", () => {
            expect(firstReturn).toBe(http.__fakeServer);
            expect(startWebServer()).toBe(http.__fakeServer);
            // no new server was created by the repeat call
            expect(http.createServer).not.toHaveBeenCalled();
        });
    });

    describe("routing", () => {
        it("GET /health responds with plain text ok", async () => {
            const res = await request({ url: "/health", method: "GET", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "text/plain" });
            expect(res.end).toHaveBeenCalledWith("ok");
        });

        it("GET / is admin-only: anonymous visitors get the login/denied page", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await request({ url: "/", method: "GET", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.objectContaining({
                "Content-Type": "text/html; charset=utf-8",
            }));
            expect(res.end).toHaveBeenCalledWith("DENIED");
        });

        it("GET /r/<id> renders the report when it exists", async () => {
            store.getReport.mockReturnValue({ id: "abc" });
            const res = await request({ url: "/r/abc123", method: "GET", headers: {} });
            expect(store.getReport).toHaveBeenCalledWith("abc123");
            expect(render.renderReportPage).toHaveBeenCalled();
            expect(res.end).toHaveBeenCalledWith("REPORT_PAGE");
        });

        it("GET /r/<id> returns 404 when missing", async () => {
            store.getReport.mockReturnValue(null);
            const res = await request({ url: "/r/missing1", method: "GET", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(res.end).toHaveBeenCalledWith("NOT_FOUND");
        });

        it("GET /r/<id>/p/<idx> renders the player detail page", async () => {
            store.getReport.mockReturnValue({ id: "abc" });
            const res = await request({ url: "/r/abc123/p/2", method: "GET", headers: {} });
            expect(store.getReport).toHaveBeenCalledWith("abc123");
            expect(render.renderPlayerPage).toHaveBeenCalledWith({ id: "abc" }, 2);
            expect(res.end).toHaveBeenCalledWith("PLAYER_PAGE");
        });

        it("returns 404 for an unknown path", async () => {
            const res = await request({ url: "/nope", method: "GET", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        });

        it("returns 405 for a non-GET method on a normal path", async () => {
            const res = await request({ url: "/", method: "POST", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(405, expect.any(Object));
        });
    });

    describe("auth routes", () => {
        it("GET /auth/login redirects to the Discord authorize URL", async () => {
            auth.configured.mockReturnValue(true);
            const res = await request({ url: "/auth/login", method: "GET", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(302, expect.objectContaining({
                Location: "https://discord.example/authorize",
            }));
        });

        it("GET /auth/login returns 503 when OAuth is not configured", async () => {
            auth.configured.mockReturnValue(false);
            const res = await request({ url: "/auth/login", method: "GET", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
        });

        it("GET /auth/callback with an error shows a 400 error page", async () => {
            const res = await request({
                url: "/auth/callback?error=access_denied", method: "GET", headers: {},
            });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(render.renderError).toHaveBeenCalled();
        });

        it("GET /auth/callback without a code shows a 400 error page", async () => {
            const res = await request({ url: "/auth/callback", method: "GET", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        });

        it("GET /auth/callback with a code logs in and sets a cookie", async () => {
            auth.completeLogin.mockResolvedValue("sid-999");
            const res = await request({
                url: "/auth/callback?code=xyz&state=st", method: "GET", headers: {},
            });
            expect(auth.completeLogin).toHaveBeenCalledWith("xyz");
            expect(res.writeHead).toHaveBeenCalledWith(302, expect.objectContaining({
                Location: "/",
                "Set-Cookie": expect.stringContaining("sid=sid-999"),
            }));
        });

        it("GET /auth/callback returns 500 when the token exchange fails", async () => {
            auth.completeLogin.mockRejectedValue(new Error("boom"));
            const res = await request({
                url: "/auth/callback?code=xyz", method: "GET", headers: {},
            });
            expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
            expect(render.renderError).toHaveBeenCalled();
        });

        it("GET /auth/logout destroys the session and clears the cookie", async () => {
            auth.parseCookies.mockReturnValue({ sid: "old" });
            const res = await request({ url: "/auth/logout", method: "GET", headers: {} });
            expect(auth.destroy).toHaveBeenCalledWith("old");
            expect(res.writeHead).toHaveBeenCalledWith(302, expect.objectContaining({
                "Set-Cookie": expect.stringContaining("Max-Age=0"),
            }));
        });
    });

    describe("delete route", () => {
        it("DELETE /r/<id> is forbidden without an admin session", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await request({ url: "/r/abc123", method: "DELETE", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(403);
            expect(res.end).toHaveBeenCalledWith("forbidden");
            expect(store.deleteReport).not.toHaveBeenCalled();
        });

        it("DELETE /r/<id> deletes for an admin and returns 200", async () => {
            auth.getUser.mockReturnValue({ isAdmin: true });
            store.deleteReport.mockReturnValue(true);
            const res = await request({ url: "/r/abc123", method: "DELETE", headers: {} });
            expect(store.deleteReport).toHaveBeenCalledWith("abc123");
            expect(res.writeHead).toHaveBeenCalledWith(200);
            expect(res.end).toHaveBeenCalledWith("ok");
        });

        it("DELETE /r/<id> returns 404 when nothing was removed", async () => {
            auth.getUser.mockReturnValue({ isAdmin: true });
            store.deleteReport.mockReturnValue(false);
            const res = await request({ url: "/r/abc123", method: "DELETE", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(404);
            expect(res.end).toHaveBeenCalledWith("not found");
        });
    });
});
