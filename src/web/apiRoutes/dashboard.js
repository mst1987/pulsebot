const { ok } = require("../apiResponse");
const { requireAdmin } = require("../apiMiddleware");
const { listReports } = require("../reportStore");
const { getConfig, listRecruitment, listRecruitmentPosts } = require("../settingsStore");
const { activeGuildFor } = require("../activeGuild");
const { loadUpcomingSetups, loadRecentEvents } = require("../dashboardData");

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

module.exports = { getDashboard };
