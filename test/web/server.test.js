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
// The public event page and the calendar file (#308) — the routing is what is
// tested here, their content in eventPublicPage.test.js / icsFeed.test.js.
jest.mock("../../src/web/eventPublicPage", () => ({ renderEventPage: jest.fn(() => null) }));
// The in-app documentation (#349) — again only the routing; its content lives
// in docsPage.test.js.
jest.mock("../../src/web/docsPage", () => ({ renderDocsPage: jest.fn(() => "DOCS_PAGE") }));
jest.mock("../../src/web/icsFeed", () => ({ buildIcs: jest.fn(() => ""), icsFileName: jest.fn((id) => `raid-${id}.ics`) }));
// The raider's subscription (#312) — again only the routing; the token check
// and the content live in calendarFeed.test.js.
jest.mock("../../src/web/calendarFeed", () => ({ feedFor: jest.fn(() => null) }));
jest.mock("../../src/web/eventStore", () => ({
    ...jest.requireActual("../../src/web/eventStore"),
    getEvent: jest.fn(() => null),
}));

const http = require("http");
const store = require("../../src/web/reportStore");
const render = require("../../src/web/render");
const eventPublicPage = require("../../src/web/eventPublicPage");
const docsPage = require("../../src/web/docsPage");
const icsFeed = require("../../src/web/icsFeed");
const calendarFeed = require("../../src/web/calendarFeed");
const eventStore = require("../../src/web/eventStore");
const raidplanStore = require("../../src/web/raidplanStore");
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
const { mockRes, json } = require("../helpers/http");

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
        // #314: the health check also says which commit is running — without a
        // login, and deliberately with nothing confidential in it.
        it("GET /health answers with the running version as JSON", async () => {
            const res = await request({ url: "/health", method: "GET", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Content-Type": "application/json; charset=utf-8" }));
            const body = json(res);
            expect(body.status).toBe("ok");
            expect(Object.keys(body).sort()).toEqual(["commit", "committedAt", "startedAt", "status", "subject"]);
            // Whatever git said, the fields are strings — no git leaves them empty.
            for (const key of ["commit", "committedAt", "subject", "startedAt"]) expect(typeof body[key]).toBe("string");
            expect(new Date(body.startedAt).getTime()).toBeLessThanOrEqual(Date.now());
        });

        it("keeps paths and secrets out of /health", async () => {
            const res = await request({ url: "/health", method: "GET", headers: {} });
            const raw = res.end.mock.calls[0][0];
            expect(raw).not.toMatch(/[A-Za-z]:\\|\/home\/|\/var\/|\/opt\/|token|secret/i);
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

    // #308: both are public and server-rendered, so they must be matched before
    // the SPA fallback — a page path that reaches the client answers 200 HTML.
    describe("public event page and calendar (#308)", () => {
        it("GET /r/cal/<id>.ics answers with a calendar file", async () => {
            eventStore.getEvent.mockReturnValue({ id: "eh-1" });
            icsFeed.buildIcs.mockReturnValue("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
            const res = await request({ url: "/r/cal/eh-1.ics", method: "GET", headers: {} });
            expect(eventStore.getEvent).toHaveBeenCalledWith("eh-1");
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
                "Content-Type": "text/calendar; charset=utf-8",
                "Content-Disposition": "attachment; filename=\"raid-eh-1.ics\"",
            }));
            expect(res.end).toHaveBeenCalledWith("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
            expect(staticClient.serve).not.toHaveBeenCalled();
        });

        it("GET /r/cal/<id>.ics 404s for an unknown event", async () => {
            eventStore.getEvent.mockReturnValue(null);
            const res = await request({ url: "/r/cal/eh-weg.ics", method: "GET", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(staticClient.serve).not.toHaveBeenCalled();
        });

        it("GET /e/<id> renders the public page without asking for a session", async () => {
            eventPublicPage.renderEventPage.mockReturnValue("EVENT_PAGE");
            const res = await request({ url: "/e/eh-1", method: "GET", headers: {} });
            expect(eventPublicPage.renderEventPage).toHaveBeenCalledWith("eh-1");
            expect(res.end).toHaveBeenCalledWith("EVENT_PAGE");
            expect(auth.getUser).not.toHaveBeenCalled();
            expect(staticClient.serve).not.toHaveBeenCalled();
        });

        it("GET /e/<id> 404s for an unknown event instead of serving the SPA", async () => {
            eventPublicPage.renderEventPage.mockReturnValue(null);
            const res = await request({ url: "/e/eh-weg", method: "GET", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(staticClient.serve).not.toHaveBeenCalled();
        });

        it("lets no path traversal through either route", async () => {
            for (const url of ["/e/../../.env", "/r/cal/..%2f..%2f.env.ics", "/e/a/b"]) {
                eventPublicPage.renderEventPage.mockClear();
                eventStore.getEvent.mockClear();
                await request({ url, method: "GET", headers: {} });
                expect(eventPublicPage.renderEventPage).not.toHaveBeenCalled();
                expect(eventStore.getEvent).not.toHaveBeenCalled();
            }
        });
    });

    describe("raid plan (docs/raidplan.md)", () => {
        it("GET /rp-map/<key> serves the stored map without a session, cached and not sniffable", async () => {
            const spy = jest.spyOn(raidplanStore, "readMap").mockReturnValue({ buffer: Buffer.from("IMG"), mime: "image/png", mtime: 1 });
            const res = await request({ url: "/rp-map/bt/supremus?v=1", method: "GET", headers: {} });
            expect(spy).toHaveBeenCalledWith("bt/supremus");
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Cache-Control": expect.stringContaining("max-age") }));
            expect(res.end).toHaveBeenCalledWith(Buffer.from("IMG"));
            expect(auth.getUser).not.toHaveBeenCalled();
            spy.mockRestore();
        });

        it("GET /rp-map/<key> answers 404 for a key without a map, and never reads a traversal path", async () => {
            const spy = jest.spyOn(raidplanStore, "readMap").mockReturnValue(null);
            expect((await request({ url: "/rp-map/bt", method: "GET", headers: {} })).writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            spy.mockClear();
            for (const url of ["/rp-map/../.env", "/rp-map/bt/../../x", "/rp-map/BT", "/rp-map/bt/a/b"]) await request({ url, method: "GET", headers: {} });
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });

        it("GET /p/<token> is the SPA (its data comes from the token-guarded /api/raidplan/public)", async () => {
            await request({ url: "/p/abcdefghijklmnopqrstuv", method: "GET", headers: {} });
            expect(staticClient.serve).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), "/p/abcdefghijklmnopqrstuv");
        });
    });
    describe("in-app documentation (#349)", () => {
        it("GET /docs renders the docs page without requiring a session", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await request({ url: "/docs", method: "GET", headers: {} });
            expect(docsPage.renderDocsPage).toHaveBeenCalledWith(null);
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(res.end).toHaveBeenCalledWith("DOCS_PAGE");
            expect(staticClient.serve).not.toHaveBeenCalled();
        });

        it("GET /docs/ (trailing slash) hits the same route", async () => {
            const res = await request({ url: "/docs/", method: "GET", headers: {} });
            expect(docsPage.renderDocsPage).toHaveBeenCalled();
            expect(res.end).toHaveBeenCalledWith("DOCS_PAGE");
            expect(staticClient.serve).not.toHaveBeenCalled();
        });

        it("passes the logged-in user through, for the topbar login state", async () => {
            const user = { id: "1", name: "Admin", isAdmin: true };
            auth.getUser.mockReturnValue(user);
            await request({ url: "/docs", method: "GET", headers: {} });
            expect(docsPage.renderDocsPage).toHaveBeenCalledWith(user);
        });
    });

    // #312: the token in the url is the whole authentication, so the route has
    // to be matched before the SPA and answer a bad token with a plain 404.
    describe("raider calendar subscription (#312)", () => {
        it("GET /r/cal/user/<token>.ics answers with a private calendar file", async () => {
            calendarFeed.feedFor.mockReturnValue({ body: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", cached: false, id: "t1" });
            const res = await request({ url: "/r/cal/user/ehc_abc123.ics", method: "GET", headers: {} });
            expect(calendarFeed.feedFor).toHaveBeenCalledWith("ehc_abc123");
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
                "Content-Type": "text/calendar; charset=utf-8",
                // never a shared cache: the file belongs to one raider
                "Cache-Control": "private, max-age=300",
            }));
            expect(res.end).toHaveBeenCalledWith("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
            expect(staticClient.serve).not.toHaveBeenCalled();
            // the single-event route must not have seen it
            expect(eventStore.getEvent).not.toHaveBeenCalled();
        });

        it("404s for an unknown or revoked token, without saying which", async () => {
            calendarFeed.feedFor.mockReturnValue(null);
            const res = await request({ url: "/r/cal/user/ehc_weg.ics", method: "GET", headers: {} });
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
            expect(res.end).not.toHaveBeenCalledWith(expect.stringContaining("Token"));
            expect(staticClient.serve).not.toHaveBeenCalled();
        });

        it("never lets a path traverse out of the token", async () => {
            for (const url of ["/r/cal/user/../../.env.ics", "/r/cal/user/a/b.ics", "/r/cal/user/.ics"]) {
                calendarFeed.feedFor.mockClear();
                await request({ url, method: "GET", headers: {} });
                expect(calendarFeed.feedFor).not.toHaveBeenCalled();
            }
        });

        it("is not reachable with anything but GET", async () => {
            calendarFeed.feedFor.mockClear();
            const res = await request({ url: "/r/cal/user/ehc_abc123.ics", method: "POST", headers: {} });
            expect(calendarFeed.feedFor).not.toHaveBeenCalled();
            expect(res.writeHead).toHaveBeenCalledWith(405, expect.any(Object));
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
            const payload = json(res);
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
