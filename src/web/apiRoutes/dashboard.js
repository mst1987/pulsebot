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
const { canOrgaRaid, canCreateRaids, isGlobalRaidOrga, withOrgaFlags } = require("../events/raidOrgaAccess");
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
    const bnet = settingsForVersion(mainVersionFor({ config }), { config, guildId });
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
    const [next, recentEvents, personal] = await Promise.all([
        orga ? loadNextRaids(guildId, 2, { versionId, categoryIds }) : { raids: [], error: null },
        orga ? loadRecentEvents(guildId, 5, { versionId, categoryIds }) : { events: [], error: null },
        // "Für dich" is personal for everybody, the orga too: the raids one may sign up for (or did) - the orga block shows them all
        userCanAny(user, ["signup"], "read") ? loadPersonal(guildId, user, { config, versionId }) : null,
    ]);
    // A task that acts on a raid only for whom its gate lets through (`orgaScoped` with `raids` write): the global
    // orga with `raids` write every raid, anyone else (a global orga without the write right too) the raids of
    // the categories they manage - no button without the right, no right without the button.
    const globalWrite = isGlobalRaidOrga(user);
    const actionRaids = (rows, idOf = (r) => r.id) => (globalWrite ? rows : onlyOrgaRaids(user, rows, idOf, req));
    const claWrite = userCanAny(user, ["cla"], "write");
    const report = globalOrga || userCanAny(user, ["cla"], "read") ? loadLatestReport({ guildId, versionId }) : null;
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
    // Raids whose channel is gone (#537), for whoever sees the raids - the orga of a category: theirs. "Kanal neu
    // anlegen" per raid where its gate lets them through.
    const missingChannels = orga ? await missingWithAction(await loadMissingChannels(guildId, Date.now(), { categoryIds }), { globalOrga, actionRaids }) : [];
    // The last raids: the logs are the orga's work - a category's orga keeps them on its own raids only, as on /past.
    const recentRows = globalOrga ? recentEvents.events : (await withOrgaFlags(user, recentEvents.events, req)).map((ev) => (ev.canOrga ? ev : withoutLogs(ev)));
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
            nextRaids: await actionRaids(next.raids),
            recentEvents: globalWrite ? recentRows : (claWrite ? await actionRaids(recentRows) : []),
            report: userCanAny(user, ["cla"], "write") ? report : null,
            inbox: userCanAny(user, ["history"], "write") ? loadInbox() : [],
            // Only for whoever can open the archive the task leads to.
            archive: userCanAny(user, ["channels"], "read") ? loadChannelArchive(guildId) : null,
            roleDrift,
            // Failed dates of a recurring event (#289), for whoever can open the series page - a category's orga: theirs.
            seriesFailures: orga ? seriesFailuresFor(guildId).filter((f) => !categoryIds || categoryIds.includes(String(f.categoryId || ""))) : [],
            deploy,
            backup,
            // "Kanal neu anlegen" (`orgaScoped`) is decided per raid (missingWithAction)
            missingChannels,
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
            events: linkCheck.withChannelState(guildId, recentRows).map((ev) => ({ ...ev, icon: zoneFor(ev.title).icon })),
        },
        activeGuildId: guildId,
        // The version filter shared by the raid/loot parts (#545).
        version: versionId,
        mainVersion,
        versions: dashboardVersions(guildId, { config }).versions,
    });
});

/** A last raid's row without its logs (the orga of a category on a raid that is not theirs), as /api/raids/past. */
function withoutLogs(row) {
    const out = { ...row, logs: [], pendingLogCount: 0 };
    delete out.canOrga;
    return out;
}

/**
 * The missing channels with `canRecreate` per raid: the global orga sees every one and may recreate those its
 * gate lets through (`actionRaids`), the orga of a category gets only its own raids, each with the action.
 */
async function missingWithAction(list, { globalOrga, actionRaids }) {
    const own = new Set((await actionRaids(list || [], (m) => m.eventId)).map((m) => m.eventId));
    return (list || []).filter((m) => globalOrga || own.has(m.eventId)).map((m) => ({ ...m, canRecreate: own.has(m.eventId) }));
}

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
