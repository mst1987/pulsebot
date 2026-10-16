const { ok, error } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { getConfig } = require("../../stores/settingsStore");
const { activeGuildFor } = require("../http/activeGuild");
const discord = require("../../services/discord/discord");
const {
    loadNextRaids, loadNextRaidDetails, loadRecentEvents, loadTopLoot,
    loadLatestReport, loadRosterFigures, loadInbox, loadNewLoot, loadChannelArchive, loadMissingChannels,
    dashboardVersions, loadTrialEndings,
} = require("../dashboard/dashboardData");
const { userCanAny, userIsOrga } = require("../../config/permissions");
const { buildTasks, zoneFor } = require("../dashboard/dashboardOverview");
const { loadPersonal } = require("../dashboard/dashboardPersonal");
const { loadDrift } = require("../../services/discord/roleSync");
const { seriesFailures } = require("../events/eventSeries");
const { deployStatus } = require("../http/deployStatus");
const { readParts: readBackupParts } = require("../../services/backup/backupStatus");
const { backupEnabled } = require("../../services/backup/backupConfig");
const linkCheck = require("../../services/discord/linkCheck");
const { mainVersionFor, resolveVersionQuery } = require("../../services/events/mainVersion");
const { orgaCategoryIds, requestCache } = require("../../services/roster/categoryOrga");
const { canOrgaRaid, canCreateRaids } = require("../events/raidOrgaAccess");
const { loadEventGroups, eventLookbackSince } = require("../../services/events/raidEventGroups");
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
 * GET /api/dashboard[?version=<id>] — the start page, in two parts (design
 * canvas Oct 2026, direction A):
 *
 *   personal  "Für dich", for everyone with their own signup (area `signup`):
 *             their next raids, attendance, last raids and profile
 *             (dashboardPersonal.js)
 *   orga      for the orga - full admins and the orga roles (config.orgaRoleIds; an area
 *             is no orga rank, raider roles hold some): the next raid (and the one after),
 *             one figure per area and the last raids (dashboardOverview.js)
 *
 * The open tasks are filtered one by one by the right it takes to do them, so a
 * raider gets none. The newest top-item awards are for everyone. Every part with
 * game content shares one version (#545, #741): the main version unless the
 * page asks for another — the next raids, the last raids, the latest report, the
 * new loot and the roster figures.
 */
const getDashboard = withUser({}, async ({ user, req, res, url }) => {
    const guildId = activeGuildFor(req);
    const config = getConfig();
    const { versionId, mainVersion } = resolveVersionQuery(url.searchParams.get("version"), { config });
    // the orga block: the orga (full admins and the orga roles, Einstellungen → Berechtigungen) -
    // a raider role may hold any area, reading or even changing raids makes nobody orga
    const globalOrga = userIsOrga(user);
    // ... and the orga of a category (#729: a manager of its current roster) - with their categories only
    const managed = globalOrga ? [] : await orgaCategoryIds(user, { managerOnly: true, cache: requestCache(req) });
    const categoryIds = globalOrga ? null : managed;
    const orga = globalOrga || managed.length > 0;
    const raidsWrite = userCanAny(user, ["raids"], "write");
    const [next, recentEvents, personal] = await Promise.all([
        orga ? loadNextRaids(guildId, 2, { versionId, categoryIds }) : { raids: [], error: null },
        orga ? loadRecentEvents(guildId, 5, { versionId, categoryIds }) : { events: [], error: null },
        // "Für dich" is personal for everybody, the orga too: the raids one may sign up for (or did) - the orga block shows them all
        userCanAny(user, ["signup"], "read") ? loadPersonal(guildId, user, { config, versionId }) : null,
    ]);
    // the tasks of a category orga only for the raids they are the orga of (the gate of the raid's actions)
    const ownRaids = (rows, idOf = (r) => r.id) => (globalOrga ? rows : onlyOrgaRaids(user, rows, idOf, req));
    const report = globalOrga || userCanAny(user, ["cla"], "read") ? loadLatestReport({ versionId }) : null;
    const lastRaid = recentEvents.events[0];
    // Role-sync drift is a full admin's task: only they can open the section it
    // links to. Nothing configured means no member fetch at all.
    const roleDrift = user.isAdmin ? await loadDrift() : null;
    // How far the running code is behind main (#314) — for whoever can read the
    // settings, the same audience the footer line has. Best-effort and cached
    // for ten minutes in deployStatus.js, so it never slows the page down twice.
    const deploy = userCanAny(user, ["settings"], "read") ? await deployStatus() : null;
    // The state of the backup (#696): a full admin's task, and only where this instance takes backups at all.
    const backup = user.isAdmin && backupEnabled() ? readBackupParts() : null;
    // Raids whose channel is gone (#537), for whoever sees the raids - the orga of a category: theirs.
    const missingChannels = orga ? await ownRaids(await loadMissingChannels(guildId, Date.now(), { categoryIds }), (m) => m.eventId) : [];
    // Trials ending soon (#658), for whoever may change roster members: full admins and the roster's managers.
    const trials = userCanAny(user, ["roster"], "write") ? await loadTrialEndings(guildId, user) : [];

    ok(res, {
        kicker: kickerFor(guildId),
        // which part the page draws: the orga block, and "Für dich" (null without a signup of one's own)
        orga,
        // "Neues Raid" in the head: POST /api/raids lets them create (the global orga with `raids` write, a category's orga)
        canCreate: await canCreateRaids(user, req),
        personal,
        nextRaid: linkCheck.withChannelState(guildId, next.raids.slice(0, 1))[0] || null,
        followingRaid: linkCheck.withChannelState(guildId, next.raids.slice(1, 2))[0] || null,
        nextRaidError: next.error,
        tasks: buildTasks({
            // each task only for whoever can do it where it leads: the sheet (`orgaScoped`) for the orga of the raid,
            // assigning logs takes `cla` write - the global orga keeps its tasks as before
            nextRaids: globalOrga ? (raidsWrite ? next.raids : []) : await ownRaids(next.raids),
            recentEvents: (globalOrga ? raidsWrite : userCanAny(user, ["cla"], "write")) ? await ownRaids(recentEvents.events) : [],
            report: userCanAny(user, ["cla"], "write") ? report : null,
            inbox: userCanAny(user, ["history"], "write") ? loadInbox() : [],
            // Only for whoever can open the archive the task leads to.
            archive: userCanAny(user, ["channels"], "read") ? loadChannelArchive(guildId) : null,
            roleDrift,
            // Failed dates of a recurring event (#289), for whoever can open the series page - a category's orga: theirs.
            seriesFailures: orga ? seriesFailuresFor(guildId).filter((f) => !categoryIds || categoryIds.includes(String(f.categoryId || ""))) : [],
            deploy,
            backup,
            missingChannels,
            // "Kanal neu anlegen" (`orgaScoped`): a category's orga gets only their raids' channels listed
            canRecreate: globalOrga ? raidsWrite : true,
            trials,
        }),
        // the figures of the whole server stay the global orga's
        areas: globalOrga
            ? {
                lastReport: report,
                newLoot: loadNewLoot(lastRaid ? lastRaid.startTime : 0, { versionId }),
                roster: loadRosterFigures(guildId, { versionId }),
            }
            : null,
        topLoot: loadTopLoot(5, versionId),
        recentEvents: {
            ...recentEvents,
            events: linkCheck.withChannelState(guildId, recentEvents.events).map((ev) => ({ ...ev, icon: zoneFor(ev.title).icon })),
        },
        activeGuildId: guildId,
        // The version filter shared by the raid/loot parts (#545).
        version: versionId,
        mainVersion,
        versions: dashboardVersions(guildId, { config }).versions,
    });
});

/** The rows (ids by `idOf`) of the raids `user` is the orga of (raidOrgaAccess.canOrgaRaid), in their order. */
async function onlyOrgaRaids(user, rows, idOf, req) {
    // a Raid-Helper raid without a snapshot is found in the server's event groups, as at the gate
    const loadGroups = () => loadEventGroups(activeGuildFor(req), { sinceSeconds: eventLookbackSince() });
    const out = [];
    for (const row of rows || []) if (await canOrgaRaid(user, idOf(row), req, { loadGroups })) out.push(row);
    return out;
}

/**
 * GET /api/dashboard/next-raid?event=<id> — the "Raid-Details" modal of an
 * upcoming raid: signups per role and class, preparation, who has not signed
 * up. Loaded when the modal opens, because the member list is a Discord call.
 * Only the orga: the modal belongs to the orga block (who has not signed up) -
 * the orga of the raid's category as well (#729, `orgaScoped`), for their raids.
 */
const getNextRaidDetails = withUser({ orgaScoped: (body, query) => query.get("event") }, async ({ req, res, url }) => {
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
    // "Für dich" is every raider's start page: their own signup area opens it too (the orga part needs `raids` write)
    { method: "GET", path: "/api/dashboard", handler: getDashboard, area: ["dashboard", "signup"] },
    { method: "GET", path: "/api/dashboard/next-raid", handler: getNextRaidDetails, area: "dashboard" },
];

module.exports = { getDashboard, getNextRaidDetails, routes };
