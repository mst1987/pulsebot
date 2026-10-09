// Data assembly shared by the dashboard's SSR route (server.js) and its JSON
// counterpart (apiRouter.js) — moved out of server.js so both can require it
// without a circular dependency (server.js requires apiRouter.js).
const { listStoredEvents, ownUpcomingRaw } = require("../../services/events/eventSources");
const { scanRaidEvents } = require("../../services/events/raidEventScan");
const { listByEvent: listLootByEvent } = require("../../stores/lootStore");
const { getEventSheet } = require("../../stores/eventSheetStore");
const { getEventSoftres } = require("../../stores/eventSoftresStore");
const { lootSystemOf } = require("../../stores/eventLootSystemStore");
const { listLogs } = require("../../stores/logStore");
const { buildRecentEvents, matchLogsForEvent, pendingLogsForEvent } = require("../../services/events/recentEvents");
const { autoLinkLogs } = require("../../services/logcheck/logAutoLink");
const { logPostedAt } = require("../../services/logcheck/reportList");
const { listAwards } = require("../loot/lootAwards");
const { createRaidhelperClient } = require("../../utils/raidhelper/client");
const discord = require("../../services/discord/discord");
const { getConfig, resolveEventSheetLink } = require("../../stores/settingsStore");
const { loadEventGroups } = require("../../services/events/raidEventGroups");
const { listReports, getReport } = require("../../stores/reportStore");
const { listPending } = require("../../stores/lootInboxStore");
const { getChannelConfig, listArchived, archiveHint } = require("../../stores/channelArchiveStore");
const { buildRoster } = require("../characters/roster");
const { rosterStats } = require("../characters/rosterStats");
const { resolveAssignmentProfiles } = require("../../stores/raiderCharactersStore");
const { applyReview } = require("../../utils/logcheck/recommendations");
const softres = require("../../utils/loot/softres");
const {
    computeAttendance, buildSpecHistory, withSpecProfiles, withCharacterAssignments,
} = require("../../utils/attendance");
const {
    zoneForEvent, raidSize, roleFill, classCounts, notSignedUp, isAttending,
    lastReportArea, openRecommendations, newLootSince,
} = require("./dashboardOverview");
const { getEvent, listEvents } = require("../../stores/eventStore");
const linkCheck = require("../../services/discord/linkCheck");
const { raidHelperSlots } = require("../../services/setup/setupEditor");
const { versionOfEvent, mainVersionFor } = require("../../services/events/mainVersion");
const { versionChoices } = require("../../services/characters/characterVersions");
const { hasExpected, listExpectedMembers } = require("../../services/roster/expectedRaiders");
const rosterStore = require("../../stores/rosterStore");
const { getProfile } = require("../../stores/raiderProfileStore");
const { canManageRosterLive } = require("../../services/roster/rosterAccess");
const { trialEnding, extendedTrialUntil } = require("../../services/roster/rosterTrials");
const { planningOf } = require("../../services/events/planning");

const RH_ERROR = "Events konnten nicht geladen werden (Raid-Helper API).";

/** The raidplan slots of an event, [] when none is built or Raid-Helper fails. */
async function setupSlots(rh, eventId) {
    try {
        const result = await rh.getSetup(eventId);
        return ((result && result.setup) || []).filter((s) => s && s.name);
    } catch {
        return [];
    }
}

/**
 * An own event's APPROVED setup as raidplan slots (#263, #291) — a draft counts
 * as no setup, exactly like a Raid-Helper event without a raidplan.
 */
function ownSetupSlots(eventId) {
    return raidHelperSlots(getEvent(eventId)).filter((s) => s && s.name);
}

/** The link a raid's sheet resolves to (own filled copy, else the category's fixed sheet), or null. */
function sheetFor(eventId, categoryId) {
    const own = getEventSheet(eventId);
    const link = resolveEventSheetLink(own, categoryId);
    if (!link) return null;
    return { url: link.url || "", playerCount: (own && own.playerCount) || 0, filledAt: (own && own.filledAt) || "" };
}

/**
 * The next `count` raids of the guild (the "Nächster Raid" card and its "Danach"
 * line): who fills which role against the size the raid is planned for, and
 * whether sheet, setup and softres list are ready. One getSetup call per raid,
 * best-effort — a raid without a raidplan simply counts its signups.
 * @param {{ versionId?: string }} [opts] filters by game version (#545, "" = every one)
 */
async function loadNextRaids(guildId, count = 2, { versionId = "" } = {}) {
    if (!guildId) return { raids: [], error: null };
    const rh = createRaidhelperClient();
    let rhEvents = [];
    let error = null;
    try {
        rhEvents = (await rh.getAllEvents()) || []; // upcoming, sorted ascending by startTime
    } catch (e) {
        error = (e && e.message) || RH_ERROR;
    }
    let catMap = {};
    try {
        catMap = discord.getChannelCategoryMap(guildId) || {};
    } catch (e) {
        return { raids: [], error: (e && e.message) || RH_ERROR };
    }
    // Both sources, soonest first. A Raid-Helper outage leaves the own events standing.
    // The version filter (#545) narrows before the slice, so "the next 2 Forever
    // raids" is really the next two, not two of a shorter list filtered after.
    const next = [
        ...rhEvents.filter((ev) => catMap[ev.channelId]).map((ev) => ({ source: "raidhelper", ...ev })),
        ...ownUpcomingRaw(guildId),
    ]
        .map((ev) => ({ ...ev, categoryId: (catMap[ev.channelId] || {}).categoryId || ev.categoryId || "" }))
        .filter((ev) => !versionId || versionOfEvent(ev) === versionId)
        .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0)).slice(0, count);
    const config = getConfig();
    const raids = [];
    for (const ev of next) {
        const own = ev.source === "eventhelper";
        const meta = catMap[ev.channelId] || {};
        // The raidplan lives at Raid-Helper; an own event counts its approved setup (#263).
        const slots = own ? ownSetupSlots(ev.id) : await setupSlots(rh, ev.id);
        const softresList = getEventSoftres(ev.id);
        const zone = zoneForEvent(ev);
        const size = own && ev.size
            ? ev.size
            : raidSize(zone.contentId, softres.targetSizeForInstances((softresList && softresList.instances) || []));
        const categoryId = meta.categoryId || ev.categoryId || "";
        raids.push({
            id: ev.id,
            source: ev.source,
            title: ev.title,
            startTime: ev.startTime,
            channelId: ev.channelId,
            channelName: meta.name || ev.channelName || "",
            categoryId,
            categoryName: meta.categoryName || ev.categoryName || "",
            // A category plans with the raid plan or a Google Sheet, never both (planning.js):
            // only a "sheet" raid can miss its sheet.
            planning: planningOf(categoryId, config),
            icon: zone.icon,
            size,
            signupCount: (ev.signUps || []).filter(isAttending).length,
            setupCount: slots.length,
            roles: roleFill({ setupSlots: slots, signUps: ev.signUps || [], size, composition: own ? ev.composition : null }),
            sheet: sheetFor(ev.id, categoryId),
            softres: softresList && softresList.url ? { url: softresList.url } : null,
            lootSystem: lootSystemOf(ev.id, categoryId),
        });
    }
    return { raids, error: raids.length ? null : error };
}

/**
 * Everything the "Raid-Details" modal shows for one upcoming raid, loaded only
 * when it is opened: signups per role and class, the preparation checklist, and
 * the raiders of the category who have not signed up (no answer, tentative,
 * bench, absent). The last part needs the Discord member list and the category's
 * raider roles; without either it is left empty and says why.
 */
async function loadNextRaidDetails(guildId, eventId) {
    const { groups, error: groupsError } = await loadEventGroups(guildId);
    const found = groups.flatMap((g) => g.events.map((e) => ({ e, g }))).find((x) => x.e.id === eventId);
    if (!found) return { error: groupsError || "Event nicht gefunden.", notFound: !groupsError };
    const { e: ev, g } = found;

    const own = ev.source === "eventhelper";
    const slots = own ? ownSetupSlots(ev.id) : await setupSlots(createRaidhelperClient(), ev.id);
    const softresList = getEventSoftres(ev.id);
    const zone = zoneForEvent(ev);
    const size = own && ev.size
        ? ev.size
        : raidSize(zone.contentId, softres.targetSizeForInstances((softresList && softresList.instances) || []));
    const signUps = ev.signUps || [];

    // a category with a roster expects its core + trial members (#658), else the role holders
    const config = getConfig();
    const expects = hasExpected(g.categoryId, config);
    let missing = [];
    let membersError = null;
    let specHistory = {};
    if (expects) {
        const result = await listExpectedMembers(guildId, g.categoryId, config);
        membersError = result.error;
        const attendance = computeAttendance(result.members, signUps);
        specHistory = buildSpecHistory(g.events);
        const assignments = resolveAssignmentProfiles(g.categoryId);
        const annotate = (people) => withCharacterAssignments(withSpecProfiles(people, specHistory), assignments);
        missing = notSignedUp({ missing: annotate(attendance.missing), responded: annotate(attendance.responded), specHistory });
    }

    return {
        error: null,
        raid: {
            id: ev.id,
            source: ev.source || "raidhelper",
            title: ev.title,
            startTime: ev.startTime,
            channelId: ev.channelId,
            channelName: ev.channelName || "",
            categoryId: g.categoryId || "",
            categoryName: g.categoryName || "",
            planning: planningOf(g.categoryId, config),
            icon: zone.icon,
            size,
            signupCount: signUps.filter(isAttending).length,
            roles: roleFill({ setupSlots: slots, signUps, size, composition: own ? ev.composition : null }),
            classes: classCounts(signUps),
            setupCount: slots.length,
            sheet: sheetFor(ev.id, g.categoryId),
            softres: softresList && softresList.url ? { url: softresList.url } : null,
            lootSystem: lootSystemOf(ev.id, g.categoryId),
            notSignedUp: missing,
            rolesConfigured: expects,
            membersError,
            fetchedAt: Date.now(),
        },
    };
}

/**
 * The newest evaluation as the "Letzte Auswertung" tile needs it, plus how many
 * of its recommendations are still unreviewed (the "Empfehlungen prüfen" task).
 * Reads one report file; null when there is none or it cannot be read.
 */
function loadLatestReport() {
    try {
        const summary = listReports()[0];
        if (!summary) return null;
        const report = getReport(summary.id);
        const area = lastReportArea(summary, report);
        const reviewed = report && report.recommendations
            ? applyReview(report.recommendations, report.recommendationReview)
            : null;
        return { ...area, open: openRecommendations(reviewed) };
    } catch (e) {
        console.error("dashboard latest report failed:", e.message);
        return null;
    }
}

/** Roster size and how many characters have no Discord account assigned; null when the roster cannot be built. */
function loadRosterFigures(guildId) {
    try {
        const stats = rosterStats(buildRoster(guildId).chars);
        return { total: stats.total, withoutDiscord: stats.fromLootOnly };
    } catch (e) {
        console.error("dashboard roster failed:", e.message);
        return null;
    }
}

/** The pending addon-inbox sessions (only what the task row counts). */
function loadInbox() {
    try {
        return listPending().map((s) => ({ id: s.id, items: s.items || [] }));
    } catch {
        return [];
    }
}

/**
 * The channel archive's hint for the open tasks (issue #259): how many channels
 * sit in the archive category and how many of them longer than the deadline.
 * Needs the live channel list — without the bot there is nothing to count.
 */
function loadChannelArchive(guildId) {
    try {
        if (!guildId) return null;
        const { archiveCategoryId, archiveDeleteHintDays } = getChannelConfig(guildId);
        if (!archiveCategoryId) return null;
        const archived = discord.listAllChannels(guildId).filter((c) => c.parentId === archiveCategoryId);
        return archiveHint({ archived, entries: listArchived(guildId), hintDays: archiveDeleteHintDays });
    } catch (e) {
        console.error("dashboard channel archive failed:", e.message);
        return null;
    }
}

/** Top-item awards since the newest past raid started — the "Neuer Loot" tile. */
function loadNewLoot(sinceStartTime) {
    const { items } = listAwards({ topOnly: true, page: 1, pageSize: 500 });
    const sinceMs = (Number(sinceStartTime) || 0) * 1000;
    return { count: newLootSince(items, sinceMs), since: sinceMs };
}

// Find the raids that already took place, annotated with everything the
// dashboard links to: their Warcraft-Logs (the ones assigned to them, see
// logAutoLink.js/recentEvents.js), the CLA evaluation of those logs, imported
// loot and the soft-reserve list.
//
// Reads from the locally persisted raidEventStore (see raidEventScan.js)
// instead of a live, windowed Raid-Helper call, so a raid stays listed once it
// has been scanned — even after Raid-Helper stops returning it or its channel
// is renamed/deleted. A scan runs first to pick up anything new since the last
// background sweep (every dashboard view is effectively an on-demand rescan);
// if that scan fails but the store already has events for this guild, they are
// shown regardless — only a guild with nothing stored yet surfaces the error.
/** @param {{ versionId?: string }} [opts] filters by game version (#545, "" = every one) */
async function loadRecentEvents(guildId, limit = 5, { versionId = "" } = {}) {
    if (!guildId) return { events: [], error: null };
    const { error: scanError } = await scanRaidEvents(guildId);
    // Assign freshly detected logs to their raid before reading them back, so a
    // log posted since the last sweep already shows up under its event here (and,
    // because the assignment is persisted, on that event's detail page too).
    await autoLinkLogs(guildId);
    const stored = listStoredEvents(guildId);
    // Only logs from this guild can belong to one of its raids.
    const logs = listLogs()
        .filter((l) => !l.guildId || l.guildId === guildId)
        .map((l) => ({ ...l, postedAt: logPostedAt(l) }));
    // Filtered before buildRecentEvents cuts to `limit` (#545), so "the last 5
    // Forever raids" really is the last five, not five of a shorter list.
    const scoped = versionId ? stored.filter((ev) => versionOfEvent(ev) === versionId) : stored;
    const recent = buildRecentEvents(scoped, { logs, limit, windowDays: Infinity });
    return {
        events: recent.map((ev) => ({
            id: ev.id,
            source: ev.source || "raidhelper",
            title: ev.title,
            startTime: ev.startTime,
            channelId: ev.channelId,
            channelName: ev.channelName || "",
            categoryId: ev.categoryId || "",
            categoryName: ev.categoryName || "",
            logs: ev.logs,
            pendingLogCount: ev.pendingLogs.length,
            lootCount: listLootByEvent(ev.id).length,
            softres: getEventSoftres(ev.id),
            // The game version this raid plays (#545): its own, else its category's.
            versionId: versionOfEvent(ev),
        })),
        error: stored.length ? null : scanError,
    };
}

// Annotate upcoming Raid-Helper events the same way loadRecentEvents() does for
// past ones (matched Warcraft-Logs, imported-loot count, softres list), so the
// History page's "Kommende Raids" table can use the same row rendering as
// "Vergangene Raids". Upcoming events don't go through the persisted
// raidEventStore — they come straight from the live Raid-Helper event list.
function annotateUpcomingExtras(events, guildId) {
    const logs = listLogs()
        .filter((l) => !l.guildId || l.guildId === guildId)
        .map((l) => ({ ...l, postedAt: logPostedAt(l) }));
    return (events || []).map((ev) => ({
        ...ev,
        logs: matchLogsForEvent(ev, logs),
        pendingLogCount: pendingLogsForEvent(ev, logs).length,
        lootCount: listLootByEvent(ev.id).length,
        softres: getEventSoftres(ev.id),
        // The game version this raid plays (#545): its own, else its category's.
        versionId: versionOfEvent(ev),
    }));
}

/**
 * The most recently awarded *top items* for the dashboard card — the first page
 * of exactly the list the Historie tab shows in full (see lootAwards.js), just
 * `limit` rows long.
 *
 * `configured` is how many top items are defined at all, so the card can tell
 * "nothing configured yet" from "configured, but none dropped yet".
 * @param {string} [versionId] filters by game version (#545, "" = every one)
 */
function loadTopLoot(limit = 5, versionId = "") {
    const { items, topItemCount } = listAwards({ topOnly: true, page: 1, pageSize: limit, versionId });
    return { items, configured: topItemCount };
}

/**
 * The dashboard's version toggle choices (#545): every version among the
 * guild's stored events (own events and the last scan of Raid-Helper's — no
 * live Raid-Helper call, so this stays cheap next to `loadNextRaids`'s own
 * one), plus the main version even with none.
 * @param {string} guildId
 * @param {{ config?: object }} [opts]
 */
function dashboardVersions(guildId, { config } = {}) {
    const mainVersion = mainVersionFor({ config });
    const rows = (guildId ? listStoredEvents(guildId) : [])
        .map((ev) => ({ versionIds: [versionOfEvent(ev)] }));
    return { mainVersion, versions: versionChoices(rows, mainVersion) };
}

/**
 * The own upcoming raids of the guild whose Discord channel is gone (#537),
 * soonest first — each one a dashboard task "Kanal von <Event> fehlt". Only a
 * channel known to be missing counts: with the bot offline nothing is known
 * and nothing is reported. A cancelled raid needs no channel.
 */
async function loadMissingChannels(guildId, now = Date.now()) {
    if (!guildId) return [];
    try {
        const events = listEvents(guildId, { sinceSeconds: Math.floor(now / 1000) })
            .filter((e) => e && e.channelId && e.status !== "cancelled");
        await linkCheck.checkChannels(events.map((e) => ({ guildId, channelId: e.channelId })), now);
        return events
            .filter((e) => linkCheck.channelState(guildId, e.channelId, now) === "missing")
            .sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
            .map((e) => ({ eventId: e.id, title: e.title || "", startTime: e.startTime || 0, channelName: e.channelName || "" }));
    } catch (e) {
        console.error("dashboard missing channels failed:", e.message);
        return [];
    }
}

/**
 * Trials ending within a week or overdue (#658) in the rosters of the server
 * the caller manages (full admin, or a manager of that roster) — the
 * dashboard's calm "Probezeit endet" rows. Names from the Discord member list
 * when the bot can read it, else the profile, else the id. Best-effort: a
 * failure is no task.
 * @returns {Promise<{ rosterId, rosterName, userId, displayName, trialUntil, overdue, extendTo }[]>}
 */
async function loadTrialEndings(guildId, user, { now = Date.now() } = {}) {
    try {
        const out = [];
        for (const roster of rosterStore.listRosters(guildId || "")) {
            const ending = trialEnding(roster, { now });
            if (!ending.length || !(await canManageRosterLive(user, roster).catch(() => false))) continue;
            const names = await discord.resolveUserNames(roster.guildId || guildId, ending.map((m) => m.userId)).catch(() => ({}));
            for (const m of ending) {
                const profile = getProfile(m.userId);
                out.push({
                    rosterId: roster.id,
                    rosterName: roster.name,
                    userId: m.userId,
                    displayName: (names && names[m.userId]) || (profile && profile.name) || m.userId,
                    trialUntil: m.trialUntil,
                    overdue: m.overdue,
                    extendTo: extendedTrialUntil(m.trialUntil, { now }),
                });
            }
        }
        return out;
    } catch (e) {
        console.error("dashboard trial endings failed:", e.message);
        return [];
    }
}

module.exports = {
    loadNextRaids, loadNextRaidDetails, loadLatestReport, loadRosterFigures, loadInbox, loadNewLoot, loadChannelArchive, loadMissingChannels,
    loadRecentEvents, annotateUpcomingExtras, loadTopLoot, dashboardVersions, loadTrialEndings,
};
