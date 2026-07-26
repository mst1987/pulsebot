// JSON API layer for the React admin client (src/web-client/), built up alongside
// the existing SSR routes in server.js — see CLAUDE.md / the migration plan for
// context. Mounted under /api/* by server.js's handle().
const auth = require("./auth");
const { ok, error } = require("./apiResponse");
const { requireAdmin, requireCsrf } = require("./apiMiddleware");
const { readJsonBody } = require("./apiBody");
const { listReports } = require("./reportStore");
const { getConfig, listRecruitment, listRecruitmentPosts } = require("./settingsStore");
const { activeGuildFor } = require("./activeGuild");
const { loadUpcomingSetups, loadRecentEvents } = require("./dashboardData");
const discord = require("./discord");

/** GET /api/session — who the caller is (if anyone), plus their CSRF token. */
function getSession(req, res) {
    const user = auth.getUser(req);
    ok(res, {
        user: user ? { id: user.id, name: user.name, isAdmin: !!user.isAdmin } : null,
        csrfToken: user ? auth.csrfToken(req) : null,
    });
}

/** GET /api/dashboard — the admin start page's key figures + quick lists. */
async function getDashboard(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const reports = listReports();
    const cfg = getConfig();
    const stats = {
        reportsTotal: reports.length,
        reportsWithIssues: reports.filter((r) => (r.issueCount || 0) > 0).length,
        templates: listRecruitment().length,
        posts: listRecruitmentPosts().length,
        categories: (cfg.categoryIds || []).length,
        adminRoles: (cfg.adminRoleIds || []).length,
    };
    const guildId = activeGuildFor(req);
    const [upcoming, recentEvents] = await Promise.all([
        loadUpcomingSetups(guildId, 3),
        loadRecentEvents(guildId, 5),
    ]);
    ok(res, {
        stats,
        recentReports: reports.slice(0, 8).map((r) => ({
            id: r.id, title: r.title, zone: r.zone, generatedAt: r.generatedAt, issueCount: r.issueCount || 0,
        })),
        upcoming,
        recentEvents,
        activeGuildId: guildId,
    });
}

/** GET /api/channels — the active guild's categories + channels (for the create/duplicate forms). */
function getChannels(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    ok(res, {
        categories: discord.listCategories(guildId),
        channels: discord.listAllChannels(guildId),
        activeGuildId: guildId,
    });
}

/** POST /api/channels — create a channel in the active guild. Body: { name, type, parentId }. */
async function createChannel(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_guild", "Kein Server gewählt.");
    const body = await readJsonBody(req);
    try {
        const created = await discord.createChannel(guildId, {
            name: String(body.name || "").trim(),
            type: String(body.type || "text").trim(),
            parentId: String(body.parentId || "").trim(),
        });
        ok(res, created, 201);
    } catch (e) {
        error(res, 400, "create_failed", e.message || "Kanal konnte nicht erstellt werden.");
    }
}

/** POST /api/channels/duplicate — clone a channel. Body: { channelId, name }. */
async function duplicateChannel(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const channelId = String(body.channelId || "").trim();
    if (!channelId) return error(res, 400, "no_channel", "Kein Kanal gewählt.");
    try {
        const created = await discord.duplicateChannel(channelId, String(body.name || "").trim());
        ok(res, created, 201);
    } catch (e) {
        error(res, 400, "duplicate_failed", e.message || "Kanal konnte nicht dupliziert werden.");
    }
}

/** Dispatches an /api/* request. Returns true if handled, false to fall through. */
async function handle(pathname, req, res) {
    if (pathname === "/api/session" && req.method === "GET") {
        getSession(req, res);
        return true;
    }
    if (pathname === "/api/dashboard" && req.method === "GET") {
        await getDashboard(req, res);
        return true;
    }
    if (pathname === "/api/channels" && req.method === "GET") {
        getChannels(req, res);
        return true;
    }
    if (pathname === "/api/channels" && req.method === "POST") {
        await createChannel(req, res);
        return true;
    }
    if (pathname === "/api/channels/duplicate" && req.method === "POST") {
        await duplicateChannel(req, res);
        return true;
    }
    error(res, 404, "not_found", "Unbekannter API-Endpunkt.");
    return true;
}

module.exports = { handle };
