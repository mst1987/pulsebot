// Golden master of server.handle() (#424): every non-API path the server owns,
// with the status, headers and body it answers, recorded before handle() was
// turned into a dispatcher over pageRoutes.js and required to stay identical.
// The collaborators are mocked with answers that name their arguments, so a
// changed call shows up in the body. Run with GOLDEN_UPDATE=1 to re-record
// (only after a deliberate behaviour change) — the diff of
// fixtures/serverRoutes.golden.json is then the review.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

jest.mock("http", () => {
    const fakeServer = { on: jest.fn(), listen: jest.fn() };
    return { __fakeServer: fakeServer, createServer: jest.fn(() => fakeServer) };
});
jest.mock("../../../src/web/http/version", () => ({
    versionInfo: () => ({ commit: "c0ffee", short: "c0ffee", committedAt: "2026-09-01T00:00:00Z", subject: "Stand", startedAt: "2026-09-02T00:00:00Z" }),
}));
jest.mock("../../../src/stores/reportStore", () => ({
    getReport: jest.fn((id) => (id === "abc123" ? { id } : null)),
    deleteReport: jest.fn((id) => id === "abc123"),
}));
jest.mock("../../../src/web/report/render", () => ({
    renderReportPage: jest.fn((report, user) => `REPORT:${report.id}:${user ? user.id : "-"}`),
    renderPlayerPage: jest.fn((report, idx, user) => `PLAYER:${report.id}:${idx}:${user ? user.id : "-"}`),
    renderNotFound: jest.fn(() => "NOT_FOUND"),
    renderError: jest.fn((title, text) => `ERROR:${title}:${text}`),
}));
jest.mock("../../../src/web/http/auth", () => ({
    configured: jest.fn(() => true),
    loginUrl: jest.fn((state) => `https://discord.example/authorize?state=${state}`),
    completeLogin: jest.fn(async (code) => {
        if (code === "good") return "sid-1";
        const e = new Error("exchange failed");
        if (code === "bad-data") e.response = { data: { error: "invalid_grant" } };
        throw e;
    }),
    destroy: jest.fn(),
    getUser: jest.fn((req) => (req.headers.cookie === "admin" ? { id: "adm", isAdmin: true } : req.headers.cookie === "user" ? { id: "usr", isAdmin: false } : null)),
    parseCookies: jest.fn((req) => ({ sid: req.headers.cookie || "" })),
}));
jest.mock("../../../src/web/http/apiRouter", () => ({
    handle: jest.fn(async (pathname, req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(`API:${req.method}:${pathname}`);
    }),
}));
jest.mock("../../../src/web/http/staticClient", () => ({
    serve: jest.fn(async (req, res, pathname) => {
        if (pathname === "/kein-build") return false;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`SPA:${pathname}`);
        return true;
    }),
}));
jest.mock("../../../src/web/pages/eventPublicPage", () => ({ renderEventPage: jest.fn((id) => (id === "eh-1" ? `EVENT:${id}` : null)) }));
jest.mock("../../../src/web/pages/docsPage", () => ({ renderDocsPage: jest.fn((user) => `DOCS:${user ? user.id : "-"}`) }));
jest.mock("../../../src/web/icsFeed", () => ({
    buildIcs: jest.fn((event) => (event.id === "eh-leer" ? "" : `ICS:${event.id}`)),
    icsFileName: jest.fn((id) => `raid-${id}.ics`),
}));
jest.mock("../../../src/web/pages/calendarFeed", () => ({ feedFor: jest.fn((token) => (token === "ehc_ok" ? { body: `FEED:${token}` } : null)) }));
jest.mock("../../../src/stores/eventStore", () => ({
    ...jest.requireActual("../../../src/stores/eventStore"),
    getEvent: jest.fn((id) => (id === "eh-1" || id === "eh-leer" ? { id } : null)),
}));
jest.mock("../../../src/stores/raidplanStore", () => ({
    ...jest.requireActual("../../../src/stores/raidplanStore"),
    readMap: jest.fn((key) => (key === "bt/supremus" || key === "t/abc/kara" ? { buffer: Buffer.from(`MAP:${key}`), mime: "image/png" } : null)),
}));

// The asset files themselves change with every report-style tweak; what the
// server owns is only "ask serveAsset, else 404" (their content: reportAssets tests).
jest.mock("../../../src/web/report/assets", () => ({
    serveAsset: jest.fn((pathname, url, res) => {
        if (pathname !== "/r-assets/report.css") return false;
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
        res.end(`ASSET:${pathname}${url.search}`);
        return true;
    }),
}));

const http = require("http");
const auth = require("../../../src/web/http/auth");
const reportStore = require("../../../src/stores/reportStore");
const { startWebServer } = require("../../../src/web/http/server.js");

const GOLDEN = path.join(__dirname, "fixtures", "serverRoutes.golden.json");

startWebServer();
const handler = http.createServer.mock.calls[0][0];

function digest(body) {
    if (body === undefined || body === null) return null;
    const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
    if (text.length <= 160) return text;
    return `sha1:${crypto.createHash("sha1").update(text).digest("hex")}:${text.length}`;
}

async function request(method, url, cookie) {
    const out = { status: null, headers: null, body: null };
    auth.destroy.mockClear();
    reportStore.deleteReport.mockClear();
    const res = {
        headersSent: false,
        writeHead(status, headers) { out.status = status; out.headers = headers || null; this.headersSent = true; },
        end(body) { out.body = digest(body); },
    };
    await handler({ method, url, headers: cookie ? { cookie } : {} }, res);
    await new Promise((r) => setImmediate(r));
    const effects = [
        ...auth.destroy.mock.calls.map((c) => `destroy:${c[0]}`),
        ...reportStore.deleteReport.mock.calls.map((c) => `deleteReport:${c[0]}`),
    ];
    return effects.length ? { ...out, effects } : out;
}

// Order matters: the login with ?next= leaves a state the callback after it redeems.
const CASES = [
    ["GET", "/api/session"],
    ["POST", "/api/raids/notify"],
    ["GET", "/admin"],
    ["GET", "/admin/"],
    ["GET", "/admin/recruitment?view=posts"],
    ["GET", "/admin2"],
    ["GET", "/admin2/history?tab=awards"],
    ["POST", "/admin/x"],
    ["GET", "/administration"],
    ["GET", "/auth/login"],
    ["GET", "/auth/login?next=/p/abcdefghij"],
    ["GET", "/auth/callback?code=good&state=0a0a0a0a0a0a0a0a0a0a0a0a"],
    ["GET", "/auth/login?next=https://evil.example"],
    ["GET", "/auth/callback?code=good&state=0a0a0a0a0a0a0a0a0a0a0a0a"],
    ["GET", "/auth/callback?code=good&state=unbekannt"],
    ["GET", "/auth/callback?code=good"],
    ["GET", "/auth/callback?error=access_denied"],
    ["GET", "/auth/callback"],
    ["GET", "/auth/callback?code=bad"],
    ["GET", "/auth/callback?code=bad-data"],
    ["POST", "/auth/login"],
    ["GET", "/auth/logout", "user"],
    ["GET", "/auth/unbekannt"],
    ["DELETE", "/r/abc123"],
    ["DELETE", "/r/abc123", "user"],
    ["DELETE", "/r/abc123", "admin"],
    ["DELETE", "/r/abc123/", "admin"],
    ["DELETE", "/r/weg", "admin"],
    ["DELETE", "/r/abc123/p/1", "admin"],
    ["PUT", "/r/abc123"],
    ["POST", "/"],
    ["HEAD", "/health"],
    ["GET", "/health"],
    ["GET", "/health/"],
    ["GET", "/r/cal/user/ehc_ok.ics"],
    ["GET", "/r/cal/user/ehc_weg.ics"],
    ["GET", "/r/cal/user/a/b.ics"],
    ["GET", "/r/cal/eh-1.ics"],
    ["GET", "/r/cal/eh-leer.ics"],
    ["GET", "/r/cal/eh-weg.ics"],
    ["GET", "/r/cal/..%2f..%2f.env.ics"],
    ["GET", "/e/eh-1"],
    ["GET", "/e/eh-1/"],
    ["GET", "/e/eh-weg"],
    ["GET", "/e/a/b"],
    ["GET", "/e/../../.env"],
    ["GET", "/rp-map/bt/supremus?v=1"],
    ["GET", "/rp-map/t/abc/kara"],
    ["GET", "/rp-map/bt"],
    ["GET", "/rp-map/BT"],
    ["GET", "/rp-map/bt/a/b"],
    ["GET", "/r-assets/report.css?v=1"],
    ["GET", "/r-assets/report.js?v=old"],
    ["GET", "/r-assets/nope.js"],
    ["GET", "/r-assets/"],
    ["GET", "/docs"],
    ["GET", "/docs/", "admin"],
    ["GET", "/docs/x"],
    ["GET", "/r/abc123/p/2"],
    ["GET", "/r/abc123/p/2/", "admin"],
    ["GET", "/r/weg/p/2"],
    ["GET", "/r/abc123"],
    ["GET", "/r/abc123/", "admin"],
    ["GET", "/r/weg"],
    ["GET", "/r/a-b"],
    ["GET", "/p/abcdefghijklmnopqrstuv"],
    ["GET", "/"],
    ["GET", "/raids/detail?event=eh-1"],
    ["GET", "/kein-build"],
    ["GET", "/%E0%A4%A"],
];

describe("server.handle() golden master (#424)", () => {
    beforeAll(() => {
        jest.spyOn(crypto, "randomBytes").mockImplementation((n) => Buffer.alloc(n, 10));
        jest.spyOn(console, "warn").mockImplementation(() => {});
        jest.spyOn(console, "error").mockImplementation(() => {});
    });
    afterAll(() => jest.restoreAllMocks());

    it("answers every path exactly as recorded", async () => {
        const actual = [];
        for (const [method, url, cookie] of CASES) {
            actual.push({ request: `${method} ${url}${cookie ? ` (${cookie})` : ""}`, ...(await request(method, url, cookie)) });
        }
        if (process.env.GOLDEN_UPDATE === "1") fs.writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 2)}\n`);
        expect(actual).toEqual(JSON.parse(fs.readFileSync(GOLDEN, "utf8")));
    });
});
