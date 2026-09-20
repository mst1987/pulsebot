const { ok, error } = require("../apiResponse");
const { requireAdmin } = require("../apiMiddleware");
const { listRecruitmentPosts, getConfig } = require("../settingsStore");
const { activeGuildFor } = require("../activeGuild");
const discord = require("../discord");
const {
    loadNextRaids, loadNextRaidDetails, loadRecentEvents, loadTopLoot,
    loadLatestReport, loadRosterFigures, loadInbox, loadNewLoot, loadChannelArchive,
} = require("../dashboardData");
const { userCanAny } = require("../../config/permissions");
const { buildTasks, zoneFor } = require("../dashboardOverview");
const { loadDrift } = require("../roleSync");
const { seriesFailures } = require("../eventSeries");
const { deployStatus } = require("../deployStatus");

/** The series failures with their category's name; best-effort, never fails the dashboard. */
function seriesFailuresFor(guildId) {
    try {
        const names = Object.fromEntries((discord.listCategories(guildId) || []).map((c) => [c.id, c.name]));
        return seriesFailures().map((f) => ({ ...f, categoryName: names[f.categoryId] || "" }));
    } catch {
        return [];
    }
}

/** The page head's kicker parts: the managed guild and the realm the loot lookups use ("Thunderstrike EU"). */
function kickerFor(guildId) {
    const guild = (discord.listGuilds() || []).find((g) => g.id === guildId);
    const bnet = getConfig().blizzard || {};
    const slug = String(bnet.realmSlug || "").replace(/-/g, " ");
    const realm = slug ? `${slug.replace(/\b\w/g, (c) => c.toUpperCase())} ${String(bnet.region || "").toUpperCase()}`.trim() : "";
    return { guild: (guild && guild.name) || "", realm };
}

/**
 * GET /api/dashboard — the start page: the next raid (and the one after), the
 * open tasks, one figure per area, the newest top-item awards and the last
 * raids. See dashboardOverview.js for what decides each part.
 */
async function getDashboard(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    const [next, recentEvents] = await Promise.all([
        loadNextRaids(guildId, 2),
        loadRecentEvents(guildId, 5),
    ]);
    const report = loadLatestReport();
    const inbox = loadInbox();
    const lastRaid = recentEvents.events[0];
    // Role-sync drift is a full admin's task: only they can open the section it
    // links to. Nothing configured means no member fetch at all.
    const roleDrift = user.isAdmin ? await loadDrift() : null;
    // How far the running code is behind main (#314) — for whoever can read the
    // settings, the same audience the footer line has. Best-effort and cached
    // for ten minutes in deployStatus.js, so it never slows the page down twice.
    const deploy = userCanAny(user, ["settings"], "read") ? await deployStatus() : null;

    ok(res, {
        kicker: kickerFor(guildId),
        nextRaid: next.raids[0] || null,
        followingRaid: next.raids[1] || null,
        nextRaidError: next.error,
        tasks: buildTasks({
            nextRaids: next.raids, recentEvents: recentEvents.events, report, inbox,
            // Only for whoever can open the archive the task leads to.
            archive: userCanAny(user, ["channels"], "read") ? loadChannelArchive(guildId) : null,
            roleDrift,
            // Failed dates of a recurring event (#289), for whoever can open the series page.
            seriesFailures: userCanAny(user, ["raids"], "read") ? seriesFailuresFor(guildId) : [],
            deploy,
        }),
        areas: {
            lastReport: report,
            newLoot: loadNewLoot(lastRaid ? lastRaid.startTime : 0),
            recruitment: { posts: listRecruitmentPosts().length },
            roster: loadRosterFigures(guildId),
        },
        topLoot: loadTopLoot(5),
        recentEvents: {
            ...recentEvents,
            events: recentEvents.events.map((ev) => ({ ...ev, icon: zoneFor(ev.title).icon })),
        },
        activeGuildId: guildId,
    });
}

/**
 * GET /api/dashboard/next-raid?event=<id> — the "Raid-Details" modal of an
 * upcoming raid: signups per role and class, preparation, who has not signed
 * up. Loaded when the modal opens, because the member list is a Discord call.
 */
async function getNextRaidDetails(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const eventId = String((url && url.searchParams.get("event")) || "").trim();
    if (!eventId) return error(res, 400, "missing_event", "Kein Event angegeben.");
    const guildId = activeGuildFor(req);
    const result = await loadNextRaidDetails(guildId, eventId);
    if (result.error) {
        return error(res, result.notFound ? 404 : 400, result.notFound ? "not_found" : "events_unavailable", result.error);
    }
    ok(res, { raid: result.raid, activeGuildId: guildId });
}

module.exports = { getDashboard, getNextRaidDetails };
