const http = require("http");
const crypto = require("crypto");
const { webPort } = require("../config/variables");
const { getReport, deleteReport } = require("./reportStore");
const { startRaidEventScan } = require("./raidEventScan");
const { renderReportPage, renderPlayerPage, renderNotFound, renderError } = require("./render");
const { startSheetCleanup } = require("../utils/sheetCleanup");
const discord = require("./discord");
const auth = require("./auth");
const apiRouter = require("./apiRouter");
const staticClient = require("./staticClient");

function send(res, status, html, headers = {}) {
    res.writeHead(status, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        ...headers,
    });
    res.end(html);
}

function redirect(res, location, headers = {}) {
    res.writeHead(302, { Location: location, ...headers });
    res.end();
}

// pending OAuth states (csrf) -> expiry
const states = new Map();

async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    let pathname = "/";
    try { pathname = decodeURIComponent(url.pathname); } catch { pathname = "/"; }

    // --- React admin client (see src/web-client/) ---
    if (pathname.startsWith("/api/")) {
        await apiRouter.handle(pathname, req, res, url);
        return;
    }
    // Transitional redirect for the client's old "/admin2" mount (pre-cutover
    // bookmarks) to its current path under "/admin".
    if (pathname === "/admin2" || pathname.startsWith("/admin2/")) {
        const rest = pathname === "/admin2" ? "" : pathname.slice("/admin2".length);
        return redirect(res, `/admin${rest}${url.search || ""}`);
    }
    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
        if (await staticClient.serve(req, res, pathname)) return;
        return send(res, 404, renderNotFound());
    }

    // --- auth routes ---
    if (pathname === "/auth/login" && req.method === "GET") {
        if (!auth.configured()) return send(res, 503, renderNotFound());
        const state = crypto.randomBytes(12).toString("hex");
        states.set(state, Date.now() + 600000);
        return redirect(res, auth.loginUrl(state));
    }
    if (pathname === "/auth/callback" && req.method === "GET") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const err = url.searchParams.get("error");
        if (err) return send(res, 400, renderError("Login abgebrochen", `Discord meldete: ${err}`));
        if (!code) return send(res, 400, renderError("Login fehlgeschlagen", "Kein Autorisierungscode von Discord erhalten."));
        // state is CSRF protection; if it's unknown (e.g. the bot restarted) just warn and proceed
        if (state && !states.has(state)) console.warn("OAuth state not found (process restart?) — proceeding anyway");
        if (state) states.delete(state);
        try {
            const sid = await auth.completeLogin(code);
            return redirect(res, "/", { "Set-Cookie": `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800` });
        } catch (e) {
            const detail = e.response && e.response.data ? JSON.stringify(e.response.data) : e.message;
            console.error("OAuth callback failed:", detail);
            return send(res, 500, renderError("Login fehlgeschlagen", `Token-Austausch mit Discord fehlgeschlagen: ${detail}`));
        }
    }
    if (pathname === "/auth/logout" && req.method === "GET") {
        auth.destroy(auth.parseCookies(req).sid);
        return redirect(res, "/", { "Set-Cookie": "sid=; HttpOnly; Path=/; Max-Age=0" });
    }

    // --- delete (admins only) ---
    const dm = pathname.match(/^\/r\/([a-zA-Z0-9]+)\/?$/);
    if (dm && req.method === "DELETE") {
        const user = auth.getUser(req);
        if (!user || !user.isAdmin) { res.writeHead(403); return res.end("forbidden"); }
        const ok = deleteReport(dm[1]);
        res.writeHead(ok ? 200 : 404);
        return res.end(ok ? "ok" : "not found");
    }

    if (req.method !== "GET") return send(res, 405, renderNotFound());

    if (pathname === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end("ok");
    }
    // Start page = admin dashboard, now the React SPA under /admin. Auth gating
    // for the admin menu happens client-side there (see src/web-client/src/App.tsx);
    // the public report pages below (/r/...) stay reachable without login.
    if (pathname === "/" || pathname === "") {
        return redirect(res, "/admin");
    }
    // per-raider detail page: /r/<id>/p/<idx>
    const pm = pathname.match(/^\/r\/([a-zA-Z0-9]+)\/p\/(\d+)\/?$/);
    if (pm) {
        const report = getReport(pm[1]);
        if (report) return send(res, 200, renderPlayerPage(report, Number(pm[2]), auth.getUser(req)));
        return send(res, 404, renderNotFound());
    }
    const m = pathname.match(/^\/r\/([a-zA-Z0-9]+)\/?$/);
    if (m) {
        const report = getReport(m[1]);
        if (report) return send(res, 200, renderReportPage(report, auth.getUser(req)));
        return send(res, 404, renderNotFound());
    }
    return send(res, 404, renderNotFound());
}

let server = null;

/** Start the report web server (idempotent). Pass the bot client for role lookups. */
function startWebServer(client) {
    if (client) { auth.setClient(client); discord.setClient(client); }
    if (server) return server;
    server = http.createServer((req, res) => {
        Promise.resolve(handle(req, res)).catch((err) => {
            console.error("Logcheck web server handler error:", err.message);
            try { res.writeHead(500); res.end("error"); } catch { /* already sent */ }
        });
    });
    server.on("error", (err) => {
        console.error("Logcheck web server error:", err.message);
    });
    server.listen(webPort, () => {
        console.log(`Logcheck web server listening on port ${webPort}`);
    });
    // Sweep due raid-sheet copies (deleted a few days after each raid).
    startSheetCleanup();
    // Periodically snapshot finished Raid-Helper events into raidEventStore (see
    // loadRecentEvents), so a raid shows up on the dashboard even if nobody opens
    // it right after the raid ends.
    startRaidEventScan();
    return server;
}

module.exports = { startWebServer };
