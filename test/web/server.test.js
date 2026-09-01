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
}));
jest.mock("../../src/web/render", () => ({
    renderReportPage: jest.fn(() => "REPORT_PAGE"),
    renderPlayerPage: jest.fn(() => "PLAYER_PAGE"),
    renderNotFound: jest.fn(() => "NOT_FOUND"),
    renderError: jest.fn(() => "ERROR_PAGE"),
}));
jest.mock("../../src/web/auth", () => ({
    configured: jest.fn(() => true),
    loginUrl: jest.fn(() => "https://discord.example/authorize"),
    completeLogin: jest.fn(),
    destroy: jest.fn(),
    getUser: jest.fn(() => null),
    parseCookies: jest.fn(() => ({})),
}));
jest.mock("../../src/web/apiRouter", () => ({ handle: jest.fn(() => true) }));
jest.mock("../../src/web/staticClient", () => ({ serve: jest.fn(() => true) }));

const http = require("http");
const store = require("../../src/web/reportStore");
const render = require("../../src/web/render");
const auth = require("../../src/web/auth");
const apiRouter = require("../../src/web/apiRouter");
const staticClient = require("../../src/web/staticClient");
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

        it("GET / serves the SPA regardless of auth state (client-side gated there)", async () => {
            auth.getUser.mockReturnValue(null);
            await request({ url: "/", method: "GET", headers: {} });
            expect(staticClient.serve).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), "/");
        });

        it("GET /r/<id> renders the report when it exists", async () => {
            store.getReport.mockReturnValue({ id: "abc" });
            const res = await request({ url: "/r/abc123", method: "GET", headers: {} });
            expect(store.getReport).toHaveBeenCalledWith("abc123");
            expect(render.renderReportPage).toHaveBeenCalled();
            expect(res.end).toHaveBeenCalledWith("REPORT_PAGE");
        });

        it("GET /r/<id> passes the current visitor to renderReportPage so it can show the admin-menu link", async () => {
            store.getReport.mockReturnValue({ id: "abc" });
            auth.getUser.mockReturnValue({ id: "u1", name: "Admin", isAdmin: true });
            await request({ url: "/r/abc123", method: "GET", headers: {} });
            expect(render.renderReportPage).toHaveBeenCalledWith({ id: "abc" }, { id: "u1", name: "Admin", isAdmin: true });
        });

        it("GET /r/<id> returns 404 when missing", async () => {
            store.getReport.mockReturnValue(null);
            const res = await request({ url: "/r/missing1", method: "GET", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(res.end).toHaveBeenCalledWith("NOT_FOUND");
        });

        it("GET /r/<id>/p/<idx> renders the player detail page", async () => {
            store.getReport.mockReturnValue({ id: "abc" });
            auth.getUser.mockReturnValue(null);
            const res = await request({ url: "/r/abc123/p/2", method: "GET", headers: {} });
            expect(store.getReport).toHaveBeenCalledWith("abc123");
            expect(render.renderPlayerPage).toHaveBeenCalledWith({ id: "abc" }, 2, null);
            expect(res.end).toHaveBeenCalledWith("PLAYER_PAGE");
        });

        it("GET /r/<id>/p/<idx> passes the current visitor to renderPlayerPage too", async () => {
            store.getReport.mockReturnValue({ id: "abc" });
            auth.getUser.mockReturnValue({ id: "u1", name: "Admin", isAdmin: true });
            await request({ url: "/r/abc123/p/2", method: "GET", headers: {} });
            expect(render.renderPlayerPage).toHaveBeenCalledWith({ id: "abc" }, 2, { id: "u1", name: "Admin", isAdmin: true });
        });

        // An unknown GET is a client route as far as the server is concerned;
        // the "not found" page is the client's (App.tsx). A server 404 is left
        // for the case where there is no build to serve at all.
        it("hands an unknown path to the client", async () => {
            const res = await request({ url: "/nope", method: "GET", headers: {} });
            expect(staticClient.serve).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), "/nope");
            expect(res.writeHead).not.toHaveBeenCalledWith(404, expect.any(Object));
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

    describe("React admin client (src/web-client/)", () => {
        it("delegates /api/* requests to apiRouter", async () => {
            await request({ url: "/api/session", method: "GET", headers: {} });
            expect(apiRouter.handle).toHaveBeenCalledWith("/api/session", expect.any(Object), expect.any(Object), expect.any(URL));
        });

        it("delegates a page path to staticClient", async () => {
            await request({ url: "/recruitment", method: "GET", headers: {} });
            expect(staticClient.serve).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), "/recruitment");
        });

        it("returns 404 when staticClient has no build to serve yet", async () => {
            staticClient.serve.mockResolvedValueOnce(false);
            const res = await request({ url: "/", method: "GET", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(res.end).toHaveBeenCalledWith("NOT_FOUND");
        });

        // The menu moved from /admin (and, before that, /admin2) to the root.
        // Both old mounts redirect, so bookmarks and links already posted in
        // Discord keep working.
        it("redirects /admin/* to the same path at the root, query intact", async () => {
            const res = await request({ url: "/admin/recruitment?view=posts", method: "GET", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(302, expect.objectContaining({ Location: "/recruitment?view=posts" }));
            expect(staticClient.serve).not.toHaveBeenCalled();
        });

        it("redirects bare /admin and bare /admin2 to the root", async () => {
            for (const url of ["/admin", "/admin2"]) {
                const res = await request({ url, method: "GET", headers: {} });
                expect(res.writeHead).toHaveBeenCalledWith(302, expect.objectContaining({ Location: "/" }));
            }
        });

        it("redirects the older /admin2/* mount to the root as well", async () => {
            const res = await request({ url: "/admin2/history?tab=awards", method: "GET", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(302, expect.objectContaining({ Location: "/history?tab=awards" }));
        });

        // The report pages are server-rendered and public; the SPA fallback must
        // not swallow them.
        it("keeps the report pages ahead of the SPA fallback", async () => {
            store.getReport.mockReturnValue({ id: "abc" });
            await request({ url: "/r/abc123", method: "GET", headers: {} });
            expect(render.renderReportPage).toHaveBeenCalled();
            expect(staticClient.serve).not.toHaveBeenCalled();
        });

        it("still 404s an unknown report id instead of serving the SPA", async () => {
            store.getReport.mockReturnValue(null);
            const res = await request({ url: "/r/weggeworfen", method: "GET", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(staticClient.serve).not.toHaveBeenCalled();
        });
    });

    // The client parses every /api/* body as JSON, so answering a failure with
    // plain text surfaces as a bare "Unexpected token" instead of the real error.
    describe("catch-all failures", () => {
        it("answers a failing /api/* request with a JSON error, not plain text", async () => {
            apiRouter.handle.mockRejectedValueOnce(new Error("RPB-Auswertung geplatzt"));
            const res = mockRes();
            res.headersSent = false;
            await capturedHandler({ url: "/api/cla/eval", method: "POST", headers: {} }, res);
            await flush();
            expect(res.writeHead).toHaveBeenCalledWith(500, expect.objectContaining({
                "Content-Type": "application/json; charset=utf-8",
            }));
            const payload = JSON.parse(res.end.mock.calls[0][0]);
            expect(payload.error).toEqual({
                code: "internal_error", message: "RPB-Auswertung geplatzt",
            });
        });

        it("keeps the plain-text fallback for non-API routes", async () => {
            staticClient.serve.mockRejectedValueOnce(new Error("kaputt"));
            const res = mockRes();
            res.headersSent = false;
            await capturedHandler({ url: "/", method: "GET", headers: {} }, res);
            await flush();
            expect(res.writeHead).toHaveBeenCalledWith(500);
            expect(res.end).toHaveBeenCalledWith("error");
        });

        it("does not write again when the response already started", async () => {
            apiRouter.handle.mockRejectedValueOnce(new Error("zu spät"));
            const res = mockRes();
            res.headersSent = true;
            await capturedHandler({ url: "/api/cla/eval", method: "POST", headers: {} }, res);
            await flush();
            expect(res.writeHead).not.toHaveBeenCalled();
            expect(res.end).not.toHaveBeenCalled();
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
