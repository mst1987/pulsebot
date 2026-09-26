// The paths the web server owns besides /api/* (#424): the menu's old mounts,
// the Discord login, the public report, event, calendar and plan-map pages,
// /health and /docs. One declarative list, like the /api route table
// (routeTable.js): server.handle() looks a request up here, and whatever finds
// no entry is a 405 (any method but GET) or the React client (GET).
//
// An entry is { name, method, <one matcher>, handler }:
//   method   "GET", "DELETE", … or "*" for every method
//   exact    one path or a list of paths, compared as they are
//   prefix   the path starts with it
//   mount    the path is it or lies below it ("/admin" and "/admin/…")
//   pattern  a RegExp; its groups become `params`
// The first entry whose method and path both fit answers — so the order is the
// order the checks had in handle(), and it matters: /r/cal/user/<token>.ics
// before /r/cal/<id>.ics, both before the report pages; /r/<id>/p/<n> before
// /r/<id>. A handler gets { req, res, url, pathname, params, rest }.
const crypto = require("crypto");
const { getReport, deleteReport } = require("../../stores/reportStore");
const { renderReportPage, renderPlayerPage, renderNotFound, renderError } = require("../report/render");
const { renderEventPage } = require("../pages/eventPublicPage");
const { renderDocsPage } = require("../pages/docsPage");
const { buildIcs, icsFileName } = require("../icsFeed");
const calendarFeed = require("../pages/calendarFeed");
const raidplanStore = require("../../stores/raidplanStore");
const { getEvent } = require("../../stores/eventStore");
const { versionInfo } = require("./version");
const auth = require("./auth");
const apiRouter = require("./apiRouter");
const { serveAsset } = require("../report/assets");

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

// The menu used to sit under /admin (and before that /admin2). It serves
// members looking up loot as much as officers, so it moved to the root —
// both old mounts redirect there, which keeps every bookmark and every link
// already posted in Discord working, one hop later.
function legacyMount({ res, url, rest }) {
    return redirect(res, `${rest || "/"}${url.search || ""}`);
}

function authLogin({ res, url }) {
    if (!auth.configured()) return send(res, 503, renderNotFound());
    const state = crypto.randomBytes(12).toString("hex");
    // "?next=/p/<token>": after the login back to that plan page (only such a path, nothing else)
    const next = /^\/p\/[A-Za-z0-9_-]{8,80}$/.test(url.searchParams.get("next") || "") ? url.searchParams.get("next") : "";
    states.set(state, { expires: Date.now() + 600000, next });
    return redirect(res, auth.loginUrl(state));
}

async function authCallback({ res, url }) {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const err = url.searchParams.get("error");
    if (err) return send(res, 400, renderError("Login abgebrochen", `Discord meldete: ${err}`));
    if (!code) return send(res, 400, renderError("Login fehlgeschlagen", "Kein Autorisierungscode von Discord erhalten."));
    // state is CSRF protection; if it's unknown (e.g. the bot restarted) just warn and proceed
    if (state && !states.has(state)) console.warn("OAuth state not found (process restart?) — proceeding anyway");
    const pending = state ? states.get(state) : null;
    if (state) states.delete(state);
    try {
        const sid = await auth.completeLogin(code);
        return redirect(res, pending && pending.next ? pending.next : "/", { "Set-Cookie": `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800` });
    } catch (e) {
        const detail = e.response && e.response.data ? JSON.stringify(e.response.data) : e.message;
        console.error("OAuth callback failed:", detail);
        return send(res, 500, renderError("Login fehlgeschlagen", `Token-Austausch mit Discord fehlgeschlagen: ${detail}`));
    }
}

function authLogout({ req, res }) {
    auth.destroy(auth.parseCookies(req).sid);
    return redirect(res, "/", { "Set-Cookie": "sid=; HttpOnly; Path=/; Max-Age=0" });
}

// Admins only.
function deleteReportPage({ req, res, params }) {
    const user = auth.getUser(req);
    if (!user || !user.isAdmin) {
        res.writeHead(403);
        return res.end("forbidden");
    }
    const ok = deleteReport(params[0]);
    res.writeHead(ok ? 200 : 404);
    return res.end(ok ? "ok" : "not found");
}

// Reachable without a login, and deliberately so — a health check runs
// before anyone could log in. It therefore carries nothing confidential:
// which commit is running, when it was committed, its subject and when the
// process came up (#314). No path, no config, no token.
function health({ res }) {
    const version = versionInfo();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({
        status: "ok",
        commit: version.commit,
        committedAt: version.committedAt,
        subject: version.subject,
        startedAt: version.startedAt,
    }));
}

// The raider's calendar subscription (#312): /r/cal/user/<token>.ics. The
// token is the whole authentication — calendarFeed verifies it before it reads
// anything, and an unknown *or* revoked one gets the same plain 404 as a path
// that never existed, never a hint that it once was a token.
function userCalendar({ res, params }) {
    const feed = calendarFeed.feedFor(params[0]);
    if (!feed) return send(res, 404, renderNotFound());
    res.writeHead(200, {
        "Content-Type": "text/calendar; charset=utf-8",
        // Private: the file belongs to one raider, so no shared cache may
        // hold it. The five minutes match the server's own cache.
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": "inline; filename=\"meine-raids.ics\"",
    });
    return res.end(feed.body);
}

// The calendar file of an event (#308): /r/cal/<eventId>.ics.
function eventCalendar({ res, params }) {
    const event = getEvent(params[0]);
    if (!event) return send(res, 404, renderNotFound());
    const body = buildIcs(event);
    if (!body) return send(res, 404, renderNotFound());
    res.writeHead(200, {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "no-cache",
        "Content-Disposition": `attachment; filename="${icsFileName(event.id)}"`,
    });
    return res.end(body);
}

// The public event page (#308): /e/<eventId>, no login, nothing personal —
// see eventPublicPage.js.
function eventPage({ res, params }) {
    const html = renderEventPage(params[0]);
    return send(res, html ? 200 : 404, html || renderNotFound());
}

// Room maps of the raid plan (docs/raidplan.md): /rp-map/<instance>[/<boss>], no
// login — the public plan page shows them too, and a map is a picture the orga
// uploaded, nothing personal. The key is checked against the known instances
// and bosses before any file is touched; the url carries ?v=<mtime>, so the
// long cache never hides a new upload.
function raidplanMap({ res, params }) {
    const map = raidplanStore.readMap(params[0]);
    if (!map) return send(res, 404, renderNotFound());
    res.writeHead(200, {
        "Content-Type": map.mime,
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
    });
    return res.end(map.buffer);
}

// The report pages' stylesheet and client script (#423): /r-assets/<file>, no
// login, a fixed list of files — see report/assets.js.
function reportAsset({ res, url, pathname }) {
    if (serveAsset(pathname, url, res)) return undefined;
    return send(res, 404, renderNotFound());
}

// The in-app documentation (#349): /docs, no login needed — the "Dokumentation"
// icon in the web menu's topbar (Shell.tsx) points here too. See docsPage.js.
function docs({ req, res }) {
    return send(res, 200, renderDocsPage(auth.getUser(req)));
}

// per-raider detail page: /r/<id>/p/<idx>
function playerPage({ req, res, params }) {
    const report = getReport(params[0]);
    if (report) return send(res, 200, renderPlayerPage(report, Number(params[1]), auth.getUser(req)));
    return send(res, 404, renderNotFound());
}

function reportPage({ req, res, params }) {
    const report = getReport(params[0]);
    if (report) return send(res, 200, renderReportPage(report, auth.getUser(req)));
    return send(res, 404, renderNotFound());
}

// The public report, event and calendar pages are server-rendered, reachable
// without a login and matched before the React client. Every id pattern allows
// nothing but [A-Za-z0-9_-], so no path can traverse.
const PAGE_ROUTES = [
    // the React client's data (src/web-client/), every method — see routeTable.js
    { name: "api", method: "*", prefix: "/api/", handler: ({ req, res, url, pathname }) => apiRouter.handle(pathname, req, res, url) },
    { name: "legacy-admin2", method: "*", mount: "/admin2", handler: legacyMount },
    { name: "legacy-admin", method: "*", mount: "/admin", handler: legacyMount },
    { name: "auth-login", method: "GET", exact: "/auth/login", handler: authLogin },
    { name: "auth-callback", method: "GET", exact: "/auth/callback", handler: authCallback },
    { name: "auth-logout", method: "GET", exact: "/auth/logout", handler: authLogout },
    { name: "report-delete", method: "DELETE", pattern: /^\/r\/([a-zA-Z0-9]+)\/?$/, handler: deleteReportPage },
    { name: "health", method: "GET", exact: "/health", handler: health },
    { name: "calendar-user", method: "GET", pattern: /^\/r\/cal\/user\/([a-zA-Z0-9_-]+)\.ics$/, handler: userCalendar },
    { name: "calendar-event", method: "GET", pattern: /^\/r\/cal\/([a-zA-Z0-9_-]+)\.ics$/, handler: eventCalendar },
    { name: "event-page", method: "GET", pattern: /^\/e\/([a-zA-Z0-9_-]+)\/?$/, handler: eventPage },
    { name: "raidplan-map", method: "GET", pattern: /^\/rp-map\/((?:[te]\/[a-z0-9-]{3,40}\/)?[a-z0-9]+(?:\/[a-z0-9-]+)?)$/, handler: raidplanMap },
    { name: "report-asset", method: "GET", prefix: "/r-assets/", handler: reportAsset },
    { name: "docs", method: "GET", exact: ["/docs", "/docs/"], handler: docs },
    { name: "report-player", method: "GET", pattern: /^\/r\/([a-zA-Z0-9]+)\/p\/(\d+)\/?$/, handler: playerPage },
    { name: "report", method: "GET", pattern: /^\/r\/([a-zA-Z0-9]+)\/?$/, handler: reportPage },
];

/** How a route's path matcher sees `pathname`: null for no match, else { params, rest }. */
function matchPath(route, pathname) {
    if (route.exact !== undefined) {
        const list = Array.isArray(route.exact) ? route.exact : [route.exact];
        return list.includes(pathname) ? { params: [], rest: "" } : null;
    }
    if (route.prefix !== undefined) return pathname.startsWith(route.prefix) ? { params: [], rest: pathname.slice(route.prefix.length) } : null;
    if (route.mount !== undefined) {
        if (pathname !== route.mount && !pathname.startsWith(`${route.mount}/`)) return null;
        return { params: [], rest: pathname.slice(route.mount.length) };
    }
    const m = pathname.match(route.pattern);
    return m ? { params: m.slice(1), rest: "" } : null;
}

/** The first route for this method and path, with what its matcher captured; null when none fits. */
function findPageRoute(method, pathname, routes = PAGE_ROUTES) {
    for (const route of routes) {
        if (route.method !== "*" && route.method !== method) continue;
        const hit = matchPath(route, pathname);
        if (hit) return { route, ...hit };
    }
    return null;
}

module.exports = {
    PAGE_ROUTES, findPageRoute, send,
    // only for the tests: not part of the module's API
    _internal: { matchPath, states },
};
