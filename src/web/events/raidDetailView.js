// What the raid detail page reads in one request (GET /api/raids/detail, #424):
// meta, raidplan setup, attendance vs. role holders, softres/sheet links
// already created, the loot already imported, the logs, the step bar. The
// route (apiRoutes/raidDetail.js) only speaks HTTP; this module builds the
// payload from one small builder per part. The parts that go outside — the
// setup (Raid-Helper), the member list (Discord), the own signups' names
// (Discord), the log titles (Warcraft Logs) — run in parallel; only the softres
// part waits, it reads the attendance.
//
// Some fields (notifyTemplates, roles, matchedSheetId, tankCandidates,
// softresCatalogue/Edition/Suggested) are only consumed by the page's action
// modals, but are included here since this read already computes all of it.
const { fail } = require("../http/apiResult");
const { loadEventGroups, eventLookbackSince } = require("../../services/events/raidEventGroups");
const {
    getConfig, listNotify, listRaidsheets, resolveEventSheetLink,
} = require("../../stores/settingsStore");
const { pickRaidsheet } = require("../../utils/setup/raidsheets");
const { versionOfEvent } = require("../../services/events/mainVersion");
const { archiveOf } = require("../../services/events/eventArchive");
const { settingsForVersion, versionLinks } = require("../../services/events/versionSettings");
const { buildSetupView, tankCandidates } = require("../../utils/setup/setupView");
const {
    computeAttendance, buildSpecHistory, withSpecProfiles, withCharacterAssignments,
    hasStarted, isRosterKnown,
} = require("../../utils/attendance");
const { resolveAssignmentProfiles } = require("../../stores/raiderCharactersStore");
const { getEventSheet } = require("../../stores/eventSheetStore");
const { getRaidEvent } = require("../../stores/raidEventStore");
const { listStoredEvents } = require("../../services/events/eventSources");
const { getEventSoftres } = require("../../stores/eventSoftresStore");
const softres = require("../../utils/loot/softres");
const { lootSystemOf } = require("../../stores/eventLootSystemStore");
const { listByEvent: listLootByEvent, listAll: listAllLoot } = require("../../stores/lootStore");
const { lootOfGuild } = require("../../services/loot/lootServer");
const { raidSteps, eventSteps } = require("./raidDetailSteps");
const { summarizePlayers } = require("./raidPlayerSummary");
const { withClassLook: withLootClassLook } = require("../loot/lootClassLook");
const { listLogs, listLogsForEvent, evaluatedSections } = require("../../stores/logStore");
const { backfillLogTitles } = require("../../services/logcheck/logChannel");
const { createRaidhelperClient, raidhelperDisabled } = require("../../utils/raidhelper/client");
const discord = require("../../services/discord/discord");
const { listSignups } = require("../../stores/signupStore");
const { eventSignupList } = require("../signups/signupView");
const { getEvent } = require("../../stores/eventStore");
const { signupEventIdOf } = require("../../utils/raidGroup");
const { groupSummary } = require("../../services/events/raidGroup");
const raidplanStore = require("../../stores/raidplanStore");
const { raidplanPostState } = require("../../services/raidplan/raidplanPost");
const linkCheck = require("../../services/discord/linkCheck");
const { setupSummary } = require("../../services/setup/setupEditor");
const setupPresence = require("../../services/setup/setupPresence");
const { planningOf } = require("../../services/events/planning");
const { featureState, sheetOffered } = require("../../services/events/versionCapabilities");
const { expectedRoleIds } = require("../../services/roster/categoryRoles");
const { openToAll } = require("../../services/signups/signupAccess");
const { expectedRosterIds, listExpectedMembers } = require("../../services/roster/expectedRaiders");
const { eventShown } = require("../../services/signups/eventVisibility");

/**
 * The version of the event on this page and its settings (#542): an own event
 * carries its version, a scanned Raid-Helper one its stored version (#737),
 * one not scanned yet plays its category's. The softres edition and the
 * default raidsheet follow it - a version without a softres edition (Forever
 * until softres.it has it) offers no list at all.
 */
function eventVersionSettings(found, config) {
    const versionId = versionOfEvent({ id: found.e.id, versionId: found.e.versionId, categoryId: found.g.categoryId }, { config });
    const all = config.versionSettings || {};
    return {
        ...settingsForVersion(versionId, { config }),
        otherSheetIds: Object.entries(all).filter(([id]) => id !== versionId).map(([, s]) => (s && s.raidsheetId) || ""),
    };
}

const isOwn = (found) => found.e.source === "eventhelper";

/**
 * An own event's planned places per role (its composition), for the role heads "3 von 3":
 * a role without a planned number (melee/ranged left open) is missing, null for an event without any.
 */
function roleTargetsOf(stored) {
    const comp = stored && stored.composition;
    if (!comp) return null;
    const out = {};
    for (const role of ["tank", "healer", "melee", "ranged"]) {
        const n = Number(comp[role]);
        if (Number.isInteger(n) && n > 0) out[role] = n;
    }
    return Object.keys(out).length ? out : null;
}

/** The state "Event verwalten" (#288) sets on an own event, for the page head and the menu. */
function manageState(eventId, stored = getEvent(eventId)) {
    const ev = stored || {};
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
function setupPostState(eventId, stored = getEvent(eventId)) {
    const post = (stored || {}).setupPost;
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
 * Attendance: who of the expected raiders has not reacted to the signup yet —
 * the core and trial members of the category's roster (#658, `attendanceSource`
 * "roster"), else the holders of a role assigned to the category ("roles").
 * Neither → the feature stays inactive (`attendanceSource` null).
 * Skipped entirely when the signups are unknown: every expected raider would
 * land in "missing" and the page would invite a pointless mass ping.
 */
async function attendancePart(guildId, found, signupsKnown) {
    const config = getConfig();
    // the roster of the raid's version (#739): a raid of the old version expects the closed roster's members
    const versionId = versionOfEvent({ id: found.e.id, versionId: found.e.versionId, categoryId: found.g.categoryId }, { config });
    const categoryRoleIds = expectedRoleIds(found.g.categoryId, config, { versionId });
    const attendanceSource = expectedRosterIds(found.g.categoryId, { versionId, config }) !== null ? "roster" : (categoryRoleIds.length ? "roles" : null);
    let attendance = { responded: [], missing: [] };
    let membersError = null;
    if (attendanceSource && signupsKnown) {
        const membersResult = await listExpectedMembers(guildId, found.g.categoryId, config, { versionId });
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
        const assignmentProfiles = resolveAssignmentProfiles(found.g.categoryId, { versionId });
        attendance = {
            responded: withCharacterAssignments(attendance.responded, assignmentProfiles),
            missing: withCharacterAssignments(attendance.missing, assignmentProfiles),
        };
    }
    return { categoryRoleIds, attendanceSource, attendance, membersError };
}

/**
 * An own event's signups with what only the EventHelper knows ("kann auch",
 * comment, character) — the roster tab lists them in place of a raidplan —
 * plus the setup's counts and state and where it was posted. The lineup
 * itself comes from GET /api/raids/setup, which hands a draft to nobody but
 * the orga.
 */
async function ownEventPart(guildId, found, eventId, stored = isOwn(found) ? getEvent(eventId) : null) {
    if (!isOwn(found)) return { ownSignups: null, ownSetup: null, ownSetupPost: null };
    const ownSetupPost = setupPostState(eventId, stored);
    const ownSetup = setupSummary(stored);
    // a further raid of a raid group (#811) shows the signups of the group's first raid — the raiders signed up there once
    const rows = listSignups(stored ? signupEventIdOf(stored) : eventId);
    const names = rows.length ? await discord.resolveUserNames(guildId, rows.map((s) => s.userId)) : {};
    // who of the orga is in the setup editor right now (only the names; the editor itself polls for more)
    const ownSetupEditors = setupPresence.editorsOf(eventId).map((p) => p.name);
    return { ownSignups: eventSignupList(rows, names), ownSetup, ownSetupPost, ownSetupEditors };
}

/**
 * Softres: pre-select the instances the event title implies — an own event
 * names its raids (instanceIds, #291), and those win over the title guess.
 * The signup counter's target: the raid size implied by the created softres
 * list, else the expected headcount from the attendance role(s); an own event
 * names the size it is planned for, which beats both guesses.
 */
function softresPart(found, eventId, { attendanceSource, attendance }, edition = "tbc") {
    const ownCodes = edition && isOwn(found) ? softres.codesForRulesetInstances(found.e.instanceIds, edition) : [];
    const suggestedInstances = ownCodes.length
        ? ownCodes.map((code) => ({ code }))
        : (edition ? softres.parseInstancesFromTitle(found.e.title, edition) : []);
    const eventSoftres = getEventSoftres(eventId);
    let signupTarget = eventSoftres && eventSoftres.instances && eventSoftres.instances.length
        ? softres.targetSizeForInstances(eventSoftres.instances)
        : (attendanceSource ? (attendance.responded.length + attendance.missing.length) : 0);
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
    const unlinkedLogs = listLogs().filter((l) => l.guildId === guildId && !l.eventId);
    await backfillLogTitles([...eventLogs, ...unlinkedLogs]);
    for (const l of [...eventLogs, ...unlinkedLogs]) l.sections = evaluatedSections(l);
    return { eventLogs, unlinkedLogs };
}

/** The page head's event: what every source has, plus what only an own event plans with. */
function eventMeta(found, eventId, { isPast, signupsKnown, guildId = "", planning = "raidplan", stored }) {
    return {
        id: found.e.id,
        source: found.e.source || "raidhelper",
        title: found.e.title,
        startTime: found.e.startTime,
        channelId: found.e.channelId,
        channelName: found.e.channelName,
        // "ok" | "missing" | "unknown" (#537): the head links the channel only on "ok".
        channelState: linkCheck.channelState(found.e.guildId || guildId, found.e.channelId),
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
            ...manageState(eventId, stored),
            size: Number(found.e.size) || 0,
            signupDeadline: Number(found.e.signupDeadline) || 0,
        } : {}),
        // a Raid-Helper event whose raid plan the orga switched on (docs/raidplan.md, "Raid-Helper-Events"): the page shows the
        // "Raidplan" tab; an own event always has it - unless its category plans with a sheet (services/events/planning.js)
        raidplanEnabled: planning !== "sheet" && (isOwn(found) || raidplanSwitchedOn(eventId)),
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
    // Only the loot of this Discord server (#919).
    return summarizePlayers(names, lootOfGuild(listAllLoot(), guildId), listStoredEvents(guildId), { categoryId: found.g.categoryId });
}

/**
 * The roles the Anmelde-Aufruf offers: every role of the server, or - `categoryOnly`, the orga of a category
 * (#727: POST /api/raids/notify refuses any other role with 400 "role_not_allowed") - the raider roles of the
 * raid's category in the raid's version (categoryRoles.expectedRoleIds), in the server's order.
 */
function notifyRoles(guildId, categoryId, versionId, config, categoryOnly) {
    const roles = discord.listRoles(guildId) || [];
    if (!categoryOnly) return roles;
    const allowed = new Set(expectedRoleIds(categoryId, config, { versionId }).map(String));
    return roles.filter((r) => allowed.has(String(r.id)));
}

/**
 * The caller's rights on this raid (`viewer` in the answer, #729), so the client draws no button the server
 * refuses: `canOrga` the raid's actions (`orgaScoped` with `raids` write: steps, Event verwalten, Aufruf,
 * Ping, Invite, Raider eintragen, sheet, softres, loot system), `canPlan` the "Raidplan" tab (GET
 * /api/raidplan), `canSwitchPlan` "Raidplan aktivieren" (POST /api/raidplan/link). No `rights` (an older
 * caller, the tests): the orga's view counts as the orga's rights.
 */
function viewerRights(rights, orga) {
    if (!rights) return { canOrga: orga, canPlan: true, canSwitchPlan: orga };
    return { canOrga: !!rights.canOrga, canPlan: !!rights.canPlan, canSwitchPlan: !!rights.canSwitchPlan };
}

/** What a raider's read has in place of the attendance part: nobody expected, nothing missing. */
const NO_ATTENDANCE = { categoryRoleIds: [], attendanceSource: null, attendance: { responded: [], missing: [] }, membersError: null };

/** A softres list as a raider sees it: the link and what it covers, never the edit link or the posted message. */
function softresForRaider(so) {
    if (!so) return so;
    return {
        url: so.url || "", editUrl: "", edition: so.edition || "",
        instances: so.instances || [], amount: Number(so.amount) || 0, hardReserveCount: Number(so.hardReserveCount) || 0,
    };
}

/**
 * The payload as a raider gets it (Oct 2026, owner's decision): only what interests them - the date,
 * the category, the signup list (names, characters, specs, roles; their own signup in full), the
 * setup, the loot and the links. Left out are the orga's parts: the logs, who has not reacted and
 * the role ids behind it, the other raiders' comments and "kann auch", the player summaries (other
 * people's raids), the event log count, the step bar and everything only the action dialogs read.
 */
function forRaider(payload, userId) {
    const uid = String(userId || "");
    const event = { ...payload.event };
    if ("logCount" in event) event.logCount = 0;
    const out = {
        ...payload,
        event,
        // the Raid-Helper sync message points into the settings: the orga's
        eventsWarning: null,
        notifyTemplates: [],
        roles: [],
        raidsheets: [],
        matchedSheetId: "",
        tankCandidates: [],
        eventSheet: null,
        eventSoftres: softresForRaider(payload.eventSoftres),
        softresCatalogue: [],
        softresSuggested: [],
        ownSignups: payload.ownSignups
            ? payload.ownSignups.map((s) => (s.userId === uid ? s : { ...s, comment: "", canAlso: [] }))
            : payload.ownSignups,
        ownSetupEditors: [],
        progress: { steps: [], next: "", primary: null },
        steps: null,
        playerSummaries: {},
    };
    return out;
}

/**
 * The whole read for one event.
 * @param {{ guildId: string, eventId: string, planPost?: boolean, viewer?: object }} o `planPost` false (a reader without
 *   "raidplan" write) leaves out the raid plan's link state and with it the "Einteilungen" step; `viewer`
 *   (services/signups/eventVisibility.raidViewer, none = the orga): a raider gets only a raid they may see
 *   (else the same 404 as an unknown one) and only their parts of it (forRaider); `rights` (the route's, #729):
 *   `{ canOrga, canPlan, canSwitchPlan, categoryRolesOnly }` - see viewerRights and notifyRoles
 * @returns {Promise<{ body: object } | { error: { status, code, message } }>} for apiResult.sendResult
 */
async function buildRaidDetail({ guildId, eventId, planPost = true, viewer = null, rights = null }) {
    const { found, groupsError, stale } = await findEvent(guildId, eventId);
    if (!found) return fail(groupsError ? 400 : 404, groupsError ? "events_unavailable" : "not_found", groupsError || "Event nicht gefunden.");
    const orga = !viewer || !!viewer.orga;
    // a raid of a category the raider may not see answers like one that does not exist: nothing leaks
    if (!eventShown({ id: found.e.id, categoryId: found.g.categoryId, versionId: found.e.versionId, signUps: found.e.signUps }, viewer)) {
        return fail(404, "not_found", "Event nicht gefunden.");
    }

    const config = getConfig();
    // Raid plan or Google Sheet, never both: the category's choice gates the plan's tab and step and the sheet's.
    // A version without a Google raid sheet layout (everything but TBC, #751), or with the raid sheet switched off
    // (#761, Einstellungen → Spielversion), always plans with the raid plan.
    const version = eventVersionSettings(found, config);
    const planning = sheetOffered(version.versionId, { config }) ? planningOf(found.g.categoryId, config) : "raidplan";
    // Softres only where the version has an edition and it is not switched off (#761).
    const softresState = featureState(version.versionId, "softres", { config });
    const softresEdition = softresState.on ? version.softresEdition : "";
    const raidsheets = listRaidsheets();
    const matched = pickRaidsheet(raidsheets, found.e.title, { ownId: version.raidsheetId, otherIds: version.otherSheetIds });
    // A raid that is over and whose signups Raid-Helper no longer returns (and
    // that was never snapshotted) has an UNKNOWN roster — not an empty one.
    // Reporting it as "0 Anmeldungen, alle fehlen" is what made past raids look
    // like nobody had ever reacted.
    const isPast = hasStarted(found.e);
    const signupsKnown = isRosterKnown(found.e);
    // The own event's stored record, read once for the head, the setup state and its post.
    const stored = isOwn(found) ? getEvent(eventId) : null;
    // The four outside reads do not depend on each other — Raid-Helper's setup,
    // Discord's member list, Discord's names for the own signups, Warcraft Logs'
    // titles — so they run side by side: the page waits for the slowest, not the sum.
    // A raider gets neither the attendance nor the logs (the orga's parts): both are not even read.
    const [setupInfo, attendanceInfo, own, logs] = await Promise.all([
        setupPart(found, eventId),
        orga ? attendancePart(guildId, found, signupsKnown) : NO_ATTENDANCE,
        ownEventPart(guildId, found, eventId, stored),
        orga ? logsPart(guildId, eventId) : { eventLogs: [], unlinkedLogs: [] },
    ]);
    const softresInfo = softresPart(found, eventId, attendanceInfo, softresEdition);

    const payload = {
        event: eventMeta(found, eventId, { isPast, signupsKnown, guildId, planning, stored }),
        // "raidplan" | "sheet": which of the two this raid's category plans with (Einstellungen → Kategorien).
        planning,
        setupFromSnapshot: setupInfo.setupFromSnapshot,
        categoryName: found.e.categoryName || found.g.categoryName,
        // no raider role, no roster-only signup: open to everyone, a PuG raid (the head's "PuG" badge)
        openToAll: openToAll(found.g.categoryId, { config, versionId: version.versionId }),
        guildId,
        eventsWarning: stale ? (groupsError || "Raid-Helper aktuell nicht erreichbar — zeige zwischengespeicherte Event-Daten.") : null,
        notifyTemplates: listNotify(),
        // the Anmelde-Aufruf's roles: the category's raider roles only for whom POST /api/raids/notify allows no more (#727, #729)
        roles: notifyRoles(guildId, found.g.categoryId, version.versionId, config, !!(rights && rights.categoryRolesOnly)),
        raidsheets,
        matchedSheetId: matched ? matched.id : "",
        setup: setupInfo.setup,
        setupError: setupInfo.setupError,
        tankCandidates: setupInfo.tankCandidates,
        eventSheet: getEventSheet(eventId),
        // Which sheet this raid actually links: its own filled copy, else the
        // fixed sheet assigned to its category in the settings, else null.
        sheetLink: resolveEventSheetLink(getEventSheet(eventId), found.g.categoryId),
        // The raid plan's read link in the event channel (#502): null without a plan, for a reader who may not post it,
        // or in a category that plans with a sheet.
        raidplanPost: planPost && planning === "raidplan" ? raidplanPostState(found.e) : null,
        eventSoftres: softresInfo.eventSoftres,
        softresCatalogue: softresEdition ? softres.catalogue().filter((g) => g.edition === softresEdition) : [],
        softresEdition,
        // Softres switched off for the version (#761): the dialog says so instead of "no edition".
        softresOff: softresState.reason === "disabled",
        // The event's version and its Wowhead path (#542) for the softres item search.
        versionId: version.versionId,
        wowheadPath: versionLinks(version.versionId, { config }).wowheadPath,
        // A hidden game version (#563): the page opens as a read-only archive (null = a normal event).
        archived: archiveOf({ versionId: version.versionId, categoryId: found.g.categoryId }, { config }),
        softresSuggested: softresInfo.suggestedInstances.map((i) => i.code),
        attendance: attendanceInfo.attendance,
        ownSignups: own.ownSignups,
        ownSetup: own.ownSetup,
        // the raids of the event's raid group (#811): the head links them, null outside a group
        raidGroup: stored ? groupSummary(stored) : null,
        ownSetupPost: own.ownSetupPost,
        // only an own event: who of the orga is in its setup editor right now
        ownSetupEditors: own.ownSetupEditors,
        attendanceRoleIds: attendanceInfo.categoryRoleIds,
        // who the "fehlt" list measures against (#658): "roster" (core + trial), "roles" or null (nobody expected)
        attendanceSource: attendanceInfo.attendanceSource,
        membersError: attendanceInfo.membersError,
        signupTarget: softresInfo.signupTarget,
        // an own event's planned places per role (its composition): the role heads read "3 von 3"
        roleTargets: roleTargetsOf(stored),
        lootItems: withLootClassLook(listLootByEvent(eventId)),
        lootTool: (getConfig().categoryLootTool || {})[found.g.categoryId] || "",
        // Softres, Loot-Council, … — decides whether the softres step and menu
        // entry are offered at all (src/services/loot/lootSystem.js).
        lootSystem: lootSystemOf(eventId, found.g.categoryId),
        eventLogs: logs.eventLogs,
        // the server's unassigned logs (of every category) are the "Log zuordnen" dialog's: only with `cla`
        // write, the dialog's own right (#729: a category orga without it gets none of them)
        unlinkedLogs: rights && rights.canLogs === false ? [] : logs.unlinkedLogs,
        // whom the page is for: the client draws the orga's parts only for the orga (the server already left them out)
        orga,
        // what the caller may do on this raid, each the gate of the route its buttons call (#729)
        viewer: viewerRights(rights, orga),
    };
    if (!orga) return { body: forRaider(payload, viewer.userId) };
    // The progress bar and the head's primary action, from the same payload.
    payload.progress = raidSteps(payload);
    // An own event answers the orga's one question as a six-step route instead
    // (#319, #502). Raid-Helper events keep exactly today's view: steps stays null.
    payload.steps = isOwn(found) ? eventSteps(payload, { plan: planPost }) : null;
    payload.playerSummaries = playerSummariesPart(guildId, found, { setup: setupInfo.setup, attendance: attendanceInfo.attendance });
    return { body: payload };
}

module.exports = {
    buildRaidDetail,
    // only for the tests: not part of the module's API
    _internal: {
        findEvent, setupPart, attendancePart, ownEventPart, softresPart, logsPart, eventMeta, playerSummariesPart,
        manageState, raidplanSwitchedOn, setupPostState, forRaider, roleTargetsOf,
    },
};
