const { ok, error } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { listRecruitmentPosts, getConfig } = require("../../stores/settingsStore");
const { activeGuildFor } = require("../http/activeGuild");
const discord = require("../../services/discord/discord");
const {
    loadNextRaids, loadNextRaidDetails, loadRecentEvents, loadTopLoot,
    loadLatestReport, loadRosterFigures, loadInbox, loadNewLoot, loadChannelArchive, loadMissingChannels,
    dashboardVersions,
} = require("../dashboard/dashboardData");
const { userCanAny } = require("../../config/permissions");
const { buildTasks, zoneFor } = require("../dashboard/dashboardOverview");
const { loadDrift } = require("../../services/discord/roleSync");
const { seriesFailures } = require("../events/eventSeries");
const { deployStatus } = require("../http/deployStatus");
const linkCheck = require("../../services/discord/linkCheck");
const { mainVersionFor, resolveVersionQuery } = require("../../services/events/mainVersion");
const { settingsForVersion } = require("../../services/events/versionSettings");

/** The series failures with their category's name; best-effort, never fails the dashboard. */
function seriesFailuresFor(guildId) {
    try {
        const names = Object.fromEntries((discord.listCategories(guildId) || []).map((c) => [c.id, c.name]));
        return seriesFailures().map((f) => ({ ...f, categoryName: names[f.categoryId] || "" }));
    } catch {
        return [];
    }
}

/** The page head's kicker parts: the managed guild and the realm of the main version (#542, "Thunderstrike EU"; "" when it has none). */
function kickerFor(guildId) {
    const guild = (discord.listGuilds() || []).find((g) => g.id === guildId);
    const config = getConfig();
    const bnet = settingsForVersion(mainVersionFor({ config }), { config });
    const slug = String(bnet.blizzardRealmSlug || "").replace(/-/g, " ");
    const realm = slug ? `${slug.replace(/\b\w/g, (c) => c.toUpperCase())} ${String(bnet.blizzardRegion || "").toUpperCase()}`.trim() : "";
    return { guild: (guild && guild.name) || "", realm };
}

/**
 * GET /api/dashboard[?version=<id>|all] — the start page: the next raid (and
 * the one after), the open tasks, one figure per area, the newest top-item
 * awards and the last raids. See dashboardOverview.js for what decides each
 * part. The three raid/loot tiles share one version filter (#545): the main
 * version unless the page asks for another or "all".
 */
const getDashboard = withUser({}, async ({ user, req, res, url }) => {
    const guildId = activeGuildFor(req);
    const config = getConfig();
    const { versionId, mainVersion } = resolveVersionQuery(url.searchParams.get("version"), { config });
    const [next, recentEvents] = await Promise.all([
        loadNextRaids(guildId, 2, { versionId }),
        loadRecentEvents(guildId, 5, { versionId }),
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
    // Raids whose channel is gone (#537), for whoever sees the raids.
    const missingChannels = userCanAny(user, ["raids"], "read") ? await loadMissingChannels(guildId) : [];

    ok(res, {
        kicker: kickerFor(guildId),
        nextRaid: linkCheck.withChannelState(guildId, next.raids.slice(0, 1))[0] || null,
        followingRaid: linkCheck.withChannelState(guildId, next.raids.slice(1, 2))[0] || null,
        nextRaidError: next.error,
        tasks: buildTasks({
            nextRaids: next.raids, recentEvents: recentEvents.events, report, inbox,
            // Only for whoever can open the archive the task leads to.
            archive: userCanAny(user, ["channels"], "read") ? loadChannelArchive(guildId) : null,
            roleDrift,
            // Failed dates of a recurring event (#289), for whoever can open the series page.
            seriesFailures: userCanAny(user, ["raids"], "read") ? seriesFailuresFor(guildId) : [],
            deploy,
            missingChannels,
            canRecreate: userCanAny(user, ["raids"], "write"),
        }),
        areas: {
            lastReport: report,
            newLoot: loadNewLoot(lastRaid ? lastRaid.startTime : 0),
            recruitment: { posts: listRecruitmentPosts().length },
            roster: loadRosterFigures(guildId),
        },
        topLoot: loadTopLoot(5, versionId),
        recentEvents: {
            ...recentEvents,
            events: linkCheck.withChannelState(guildId, recentEvents.events).map((ev) => ({ ...ev, icon: zoneFor(ev.title).icon })),
        },
        activeGuildId: guildId,
        // The version filter shared by the three raid/loot tiles (#545).
        version: versionId,
        mainVersion,
        versions: dashboardVersions(guildId, { config }).versions,
    });
});

/**
 * GET /api/dashboard/next-raid?event=<id> — the "Raid-Details" modal of an
 * upcoming raid: signups per role and class, preparation, who has not signed
 * up. Loaded when the modal opens, because the member list is a Discord call.
 */
const getNextRaidDetails = withUser({}, async ({ req, res, url }) => {
    const eventId = String((url && url.searchParams.get("event")) || "").trim();
    if (!eventId) return error(res, 400, "missing_event", "Kein Event angegeben.");
    const guildId = activeGuildFor(req);
    const result = await loadNextRaidDetails(guildId, eventId);
    if (result.error) {
        return error(res, result.notFound ? 404 : 400, result.notFound ? "not_found" : "events_unavailable", result.error);
    }
    ok(res, { raid: result.raid, activeGuildId: guildId });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/dashboard", handler: getDashboard, area: "dashboard" },
    { method: "GET", path: "/api/dashboard/next-raid", handler: getNextRaidDetails, area: "dashboard" },
];

module.exports = { getDashboard, getNextRaidDetails, routes };
