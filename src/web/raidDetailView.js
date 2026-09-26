// What the raid detail page reads in one request (GET /api/raids/detail, #424):
// meta, raidplan setup, attendance vs. role holders, softres/sheet links
// already created, the loot already imported, the logs, the step bar. The
// route (apiRoutes/raidDetail.js) only speaks HTTP; this module builds the
// payload from one small builder per part, in the order the old handler ran
// them — the setup (Raid-Helper) before the member list (Discord) before the
// own signups before the log titles, so the outside calls go out as before.
//
// Some fields (notifyTemplates, roles, matchedSheetId, tankCandidates,
// softresCatalogue/Edition/Suggested) are only consumed by the page's action
// modals, but are included here since this read already computes all of it.
const { fail } = require("./apiResult");
const { loadEventGroups, eventLookbackSince } = require("./raidEventGroups");
const {
    getConfig, listNotify, listRaidsheets, resolveEventSheetLink,
} = require("./settingsStore");
const { matchRaidsheet } = require("../utils/raidsheets");
const { buildSetupView, tankCandidates } = require("../utils/setupView");
const {
    computeAttendance, buildSpecHistory, withSpecProfiles, withCharacterAssignments,
    hasStarted, isRosterKnown,
} = require("../utils/attendance");
const { resolveAssignmentProfiles } = require("./raiderCharactersStore");
const { getEventSheet } = require("./eventSheetStore");
const { getRaidEvent } = require("./raidEventStore");
const { listStoredEvents } = require("./eventSources");
const { getEventSoftres } = require("./eventSoftresStore");
const softres = require("../utils/softres");
const { lootSystemOf } = require("./eventLootSystemStore");
const { listByEvent: listLootByEvent, listAll: listAllLoot } = require("./lootStore");
const { raidSteps, eventSteps } = require("./raidDetailSteps");
const { summarizePlayers } = require("./raidPlayerSummary");
const { withClassLook: withLootClassLook } = require("./lootClassLook");
const { listLogs, listLogsForEvent, evaluatedSections } = require("./logStore");
const { backfillLogTitles } = require("./logChannel");
const { createRaidhelperClient, raidhelperDisabled } = require("../utils/raidhelperClient");
const discord = require("./discord");
const { listSignups } = require("./signupStore");
const { eventSignupList } = require("./signupView");
const { getEvent } = require("./eventStore");
const raidplanStore = require("./raidplanStore");
const { setupSummary } = require("./setupEditor");
const { pingTargetInfo } = require("./pingDelivery");

// For now the guild only raids TBC, so the softres suggestion and the pickable
// catalogue are restricted to the TBC edition.
const SOFTRES_EDITION = "tbc";

const isOwn = (found) => found.e.source === "eventhelper";

/** The state "Event verwalten" (#288) sets on an own event, for the page head and the menu. */
function manageState(eventId) {
    const ev = getEvent(eventId) || {};
    return {
        status: ev.status || "active",
        signupsClosed: !!ev.signupsClosed,
        cancelReason: (ev.cancel && ev.cancel.reason) || "",
        cancelArchived: !!(ev.cancel && ev.cancel.archived),
        logCount: Array.isArray(ev.log) ? ev.log.length : 0,
        // The cockpit (#319) needs to tell "no setup yet" from "this raid runs
        // without one": a proposal is still coming while autoSuggest is on.
        autoSuggest: !!ev.autoSuggest,
    };
}

/** Whether a Raid-Helper event's raid plan is switched on (raidplanStore `link`). */
function raidplanSwitchedOn(eventId) {
    const plan = raidplanStore.getPlan(eventId);
    return !!(plan && plan.link && plan.link.enabled);
}

/**
 * Where the approved setup was posted (#290), reduced to what the cockpit's
 * Freigabe step says: is it out, which state does it show, how many DMs went.
 * Deliberately no `told` map and no failed user ids — the bar names numbers.
 */
function setupPostState(eventId) {
    const post = (getEvent(eventId) || {}).setupPost;
    if (!post || !post.messageId) return null;
    const dms = post.dms || null;
    return {
        channelId: post.channelId || "",
        messageId: post.messageId || "",
        version: Number(post.version) || 0,
        dms: dms ? { total: Number(dms.total) || 0, sent: Number(dms.sent) || 0, failed: (dms.failed || []).length } : null,
    };
}

/**
 * The event and its category group. Past raids are included: the dashboard's
 * "Latest Events" card links here. A Raid-Helper hiccup does not block the
 * page — loadEventGroups() still finds the event via its cached/persisted
 * fallback — so only an event that cannot be resolved at all fails.
 */
async function findEvent(guildId, eventId) {
    const { groups, error: groupsError, stale } = await loadEventGroups(guildId, { sinceSeconds: eventLookbackSince() });
    const found = groups.flatMap((g) => g.events.map((e) => ({ e, g }))).find((x) => x.e.id === eventId) || null;
    return { found, groupsError, stale };
}

/**
 * The Raid-Helper raidplan setup, shown inline (best-effort). Once a raid is
 * over, Raid-Helper eventually answers with an empty raidplan; the snapshot
 * raidEventScan.js froze while it was still there then stands in, so a past
 * raid keeps showing the setup it actually ran with. An own event has no
 * Raid-Helper raidplan (its lineup comes from GET /api/raids/setup).
 */
async function setupPart(found, eventId) {
    if (isOwn(found)) return { setup: buildSetupView([]), setupError: null, tankCandidates: [], setupFromSnapshot: false };
    const snapshot = getRaidEvent(eventId);
    const snapshotSetup = (snapshot && snapshot.setup) || [];
    try {
        const rh = createRaidhelperClient();
        const result = await rh.getSetup(eventId);
        let slots = result && result.setup ? result.setup : [];
        let setupFromSnapshot = false;
        if (!slots.length && snapshotSetup.length) {
            slots = snapshotSetup;
            setupFromSnapshot = true;
        }
        return { setup: buildSetupView(slots), setupError: null, tankCandidates: tankCandidates(slots), setupFromSnapshot };
    } catch (e) {
        if (snapshotSetup.length) {
            return { setup: buildSetupView(snapshotSetup), setupError: null, tankCandidates: tankCandidates(snapshotSetup), setupFromSnapshot: true };
        }
        console.error("event setup load failed:", e.message);
        return { setup: null, setupError: e.message || "Setup konnte nicht geladen werden.", tankCandidates: [], setupFromSnapshot: false };
    }
}

/**
 * Attendance: who (holding a role assigned to this event's category) has not
 * reacted to the signup yet. Empty roleIds → the feature stays inactive.
 * Skipped entirely when the roster is unknown: every expected raider would
 * land in "missing" and the page would invite a pointless mass ping.
 */
async function attendancePart(guildId, found, signupsKnown) {
    const categoryRoleIds = (getConfig().categoryRoles || {})[found.g.categoryId] || [];
    let attendance = { responded: [], missing: [] };
    let membersError = null;
    if (categoryRoleIds.length && signupsKnown) {
        const membersResult = await discord.listMembersWithRoles(guildId, categoryRoleIds);
        membersError = membersResult.error;
        attendance = computeAttendance(membersResult.members, found.e.signUps || []);
        // Enrich with class/spec/colour from each member's most recent signup in
        // *this same category* (raiders often play a different character on a
        // different raid day/type, so history from other categories would guess
        // wrong) so raiders who haven't reacted here yet can still be shown with
        // their known class.
        const specHistory = buildSpecHistory(found.g.events);
        attendance = {
            responded: withSpecProfiles(attendance.responded, specHistory),
            missing: withSpecProfiles(attendance.missing, specHistory),
        };
        // A manual raider->character assignment for this category (see
        // raiderCharactersStore.js) is admin-confirmed and overrides the guess above.
        const assignmentProfiles = resolveAssignmentProfiles(found.g.categoryId);
        attendance = {
            responded: withCharacterAssignments(attendance.responded, assignmentProfiles),
            missing: withCharacterAssignments(attendance.missing, assignmentProfiles),
        };
    }
    return { categoryRoleIds, attendance, membersError };
}

/**
 * An own event's signups with what only the EventHelper knows ("kann auch",
 * comment, character) — the roster tab lists them in place of a raidplan —
 * plus the setup's counts and state and where it was posted. The lineup
 * itself comes from GET /api/raids/setup, which hands a draft to nobody but
 * the orga.
 */
async function ownEventPart(guildId, found, eventId) {
    if (!isOwn(found)) return { ownSignups: null, ownSetup: null, ownSetupPost: null };
    const ownSetupPost = setupPostState(eventId);
    const ownSetup = setupSummary(getEvent(eventId));
    const rows = listSignups(eventId);
    const names = rows.length ? await discord.resolveUserNames(guildId, rows.map((s) => s.userId)) : {};
    return { ownSignups: eventSignupList(rows, names), ownSetup, ownSetupPost };
}

/**
 * Softres: pre-select the instances the event title implies — an own event
 * names its raids (instanceIds, #291), and those win over the title guess.
 * The signup counter's target: the raid size implied by the created softres
 * list, else the expected headcount from the attendance role(s); an own event
 * names the size it is planned for, which beats both guesses.
 */
function softresPart(found, eventId, { categoryRoleIds, attendance }) {
    const ownCodes = isOwn(found) ? softres.codesForRulesetInstances(found.e.instanceIds, SOFTRES_EDITION) : [];
    const suggestedInstances = ownCodes.length
        ? ownCodes.map((code) => ({ code }))
        : softres.parseInstancesFromTitle(found.e.title, SOFTRES_EDITION);
    const eventSoftres = getEventSoftres(eventId);
    let signupTarget = eventSoftres && eventSoftres.instances && eventSoftres.instances.length
        ? softres.targetSizeForInstances(eventSoftres.instances)
        : (categoryRoleIds.length ? (attendance.responded.length + attendance.missing.length) : 0);
    if (isOwn(found) && found.e.size) signupTarget = found.e.size;
    return { eventSoftres, suggestedInstances, signupTarget };
}

/**
 * Logs: already assigned to this event, plus the still-unassigned ones from
 * this guild (candidates for the "Log zuordnen" picker). Which analyses
 * already ran is normalised, so the UI can offer the CLA and RPB buttons
 * independently without knowing about legacy log entries.
 */
async function logsPart(guildId, eventId) {
    const eventLogs = listLogsForEvent(eventId);
    const unlinkedLogs = listLogs().filter((l) => (!l.guildId || l.guildId === guildId) && !l.eventId);
    await backfillLogTitles([...eventLogs, ...unlinkedLogs]);
    for (const l of [...eventLogs, ...unlinkedLogs]) l.sections = evaluatedSections(l);
    return { eventLogs, unlinkedLogs };
}

/** The page head's event: what every source has, plus what only an own event plans with. */
function eventMeta(found, eventId, { isPast, signupsKnown }) {
    return {
        id: found.e.id,
        source: found.e.source || "raidhelper",
        title: found.e.title,
        startTime: found.e.startTime,
        channelId: found.e.channelId,
        channelName: found.e.channelName,
        signupCount: found.e.signupCount,
        isPast,
        // false → the roster is unknown (past raid, Raid-Helper dropped it and
        // nothing was snapshotted); the UI must not render it as "0".
        signupsKnown,
        signUpsFromSnapshot: Boolean(found.e.signUpsFromSnapshot),
        // Event verwalten (#288): cancelled / closed signup, with the reason —
        // plus what only an own event plans with: the cockpit's Anmeldung step
        // measures against the size and ends at the signup deadline (#319).
        ...(isOwn(found) ? {
            ...manageState(eventId),
            size: Number(found.e.size) || 0,
            signupDeadline: Number(found.e.signupDeadline) || 0,
        } : {}),
        // a Raid-Helper event whose raid plan the orga switched on (docs/raidplan.md, "Raid-Helper-Events"): the page shows the
        // "Raidplan" tab; an own event always has it
        raidplanEnabled: isOwn(found) || raidplanSwitchedOn(eventId),
        // Raid-Helper switched off in the settings: the menu says the plan works from its saved line-up only
        ...(isOwn(found) ? {} : { raidhelperDisabled: raidhelperDisabled() }),
    };
}

/**
 * What the player dialog shows beyond this raid (raids in the category's last
 * eight weeks, recent loot), for every name the page can open.
 */
function playerSummariesPart(guildId, found, { setup, attendance }) {
    const names = [
        ...((setup && setup.groups) || []).flatMap((g) => g.players.map((p) => p.name)),
        ...[...attendance.responded, ...attendance.missing].map((p) => p.character || ""),
    ];
    return summarizePlayers(names, listAllLoot(), listStoredEvents(guildId), { categoryId: found.g.categoryId });
}

/**
 * The whole read for one event.
 * @returns {Promise<{ body: object } | { error: { status, code, message } }>} for apiResult.sendResult
 */
async function buildRaidDetail({ guildId, eventId }) {
    const { found, groupsError, stale } = await findEvent(guildId, eventId);
    if (!found) return fail(groupsError ? 400 : 404, groupsError ? "events_unavailable" : "not_found", groupsError || "Event nicht gefunden.");

    const raidsheets = listRaidsheets();
    const matched = matchRaidsheet(raidsheets, found.e.title);
    const setupInfo = await setupPart(found, eventId);
    // A raid that is over and whose signups Raid-Helper no longer returns (and
    // that was never snapshotted) has an UNKNOWN roster — not an empty one.
    // Reporting it as "0 Anmeldungen, alle fehlen" is what made past raids look
    // like nobody had ever reacted.
    const isPast = hasStarted(found.e);
    const signupsKnown = isRosterKnown(found.e);
    const attendanceInfo = await attendancePart(guildId, found, signupsKnown);
    const own = await ownEventPart(guildId, found, eventId);
    const softresInfo = softresPart(found, eventId, attendanceInfo);
    const logs = await logsPart(guildId, eventId);

    const payload = {
        event: eventMeta(found, eventId, { isPast, signupsKnown }),
        setupFromSnapshot: setupInfo.setupFromSnapshot,
        categoryName: found.g.categoryName,
        guildId,
        eventsWarning: stale ? (groupsError || "Raid-Helper aktuell nicht erreichbar — zeige zwischengespeicherte Event-Daten.") : null,
        notifyTemplates: listNotify(),
        roles: discord.listRoles(guildId),
        // Whether the ping/notify modals may offer the talk server as a target.
        pingTargets: pingTargetInfo(),
        raidsheets,
        matchedSheetId: matched ? matched.id : "",
        setup: setupInfo.setup,
        setupError: setupInfo.setupError,
        tankCandidates: setupInfo.tankCandidates,
        eventSheet: getEventSheet(eventId),
        // Which sheet this raid actually links: its own filled copy, else the
        // fixed sheet assigned to its category in the settings, else null.
        sheetLink: resolveEventSheetLink(getEventSheet(eventId), found.g.categoryId),
        eventSoftres: softresInfo.eventSoftres,
        softresCatalogue: softres.catalogue().filter((g) => g.edition === SOFTRES_EDITION),
        softresEdition: SOFTRES_EDITION,
        softresSuggested: softresInfo.suggestedInstances.map((i) => i.code),
        attendance: attendanceInfo.attendance,
        ownSignups: own.ownSignups,
        ownSetup: own.ownSetup,
        ownSetupPost: own.ownSetupPost,
        attendanceRoleIds: attendanceInfo.categoryRoleIds,
        membersError: attendanceInfo.membersError,
        signupTarget: softresInfo.signupTarget,
        lootItems: withLootClassLook(listLootByEvent(eventId)),
        lootTool: (getConfig().categoryLootTool || {})[found.g.categoryId] || "",
        // Softres, Loot-Council, … — decides whether the softres step and menu
        // entry are offered at all (src/web/lootSystem.js).
        lootSystem: lootSystemOf(eventId, found.g.categoryId),
        eventLogs: logs.eventLogs,
        unlinkedLogs: logs.unlinkedLogs,
    };
    // The progress bar and the head's primary action, from the same payload.
    payload.progress = raidSteps(payload);
    // An own event answers the orga's one question as a five-step route instead
    // (#319). Raid-Helper events keep exactly today's view: steps stays null.
    payload.steps = isOwn(found) ? eventSteps(payload) : null;
    payload.playerSummaries = playerSummariesPart(guildId, found, { setup: setupInfo.setup, attendance: attendanceInfo.attendance });
    return { body: payload };
}

module.exports = {
    buildRaidDetail,
    // only for the tests: not part of the module's API
    _internal: {
        findEvent, setupPart, attendancePart, ownEventPart, softresPart, logsPart, eventMeta, playerSummariesPart,
        manageState, raidplanSwitchedOn, setupPostState,
    },
};
