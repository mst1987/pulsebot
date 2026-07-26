// JSON API for the Raid-Event-Detail page (Part A: the read-only overview —
// meta header, Setup tab, Anwesenheit tab, Loot tab). Faithful JSON port of the
// SSR GET /admin/raids/detail route in server.js, minus the HTML rendering.
// Part B (Anmelde-Aufruf, Fehlende-Raider-pingen, Raidsheet füllen, Sheet/Softres
// posten, Softres-Liste erstellen) is a separate, later PR — this file only
// reads data, it never posts to Discord, writes to Sheets/Drive, or calls
// softres.it.
const { ok, error } = require("../apiResponse");
const { requireAdmin } = require("../apiMiddleware");
const { activeGuildFor } = require("../activeGuild");
const { loadEventGroups, eventLookbackSince } = require("../raidEventGroups");
const { getConfig, listNotify, listRaidsheets } = require("../settingsStore");
const { matchRaidsheet } = require("../../utils/raidsheets");
const { buildSetupView, tankCandidates } = require("../../utils/setupView");
const { computeAttendance, buildSpecHistory, withSpecProfiles } = require("../../utils/attendance");
const { getEventSheet } = require("../eventSheetStore");
const { getEventSoftres } = require("../eventSoftresStore");
const softres = require("../../utils/softres");
const { listByEvent: listLootByEvent } = require("../lootStore");
const Raidhelper = require("../../classes/raidhelper");
const discord = require("../discord");

/**
 * GET /api/raids/detail?event=<id> — everything the event-detail page needs in
 * one read: meta, raidplan setup, attendance vs. role holders, softres/sheet
 * links already created, and the loot already imported for this event. Some
 * fields (notifyTemplates, roles, matchedSheetId, tankCandidates,
 * softresCatalogue/Edition/Suggested) are only consumed by Part B's UI, but are
 * included here since this read already computes all of it in one pass.
 */
async function getRaidDetail(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    const eventId = (url.searchParams.get("event") || "").trim();
    // Include past raids: the dashboard's "Latest Events" card links here.
    const { groups, error: groupsError } = await loadEventGroups(guildId, { sinceSeconds: eventLookbackSince() });
    if (groupsError) return error(res, 400, "events_unavailable", groupsError);
    const found = groups.flatMap((g) => g.events.map((e) => ({ e, g }))).find((x) => x.e.id === eventId);
    if (!found) return error(res, 404, "not_found", "Event nicht gefunden.");

    const raidsheets = listRaidsheets();
    const matched = matchRaidsheet(raidsheets, found.e.title);

    // Pull the Raid-Helper raidplan setup so it can be shown inline (best-effort).
    let setup = null;
    let setupError = null;
    let tankCands = [];
    try {
        const rh = new Raidhelper();
        const result = await rh.getSetup(eventId);
        const slots = result && result.setup ? result.setup : [];
        setup = buildSetupView(slots);
        tankCands = tankCandidates(slots);
    } catch (e) {
        console.error("event setup load failed:", e.message);
        setupError = e.message || "Setup konnte nicht geladen werden.";
    }

    // Attendance: who (holding a role assigned to this event's category) has not
    // reacted to the signup yet. Empty roleIds → feature simply stays inactive.
    const categoryRoleIds = (getConfig().categoryRoles || {})[found.g.categoryId] || [];
    let attendance = { responded: [], missing: [] };
    let membersError = null;
    if (categoryRoleIds.length) {
        const membersResult = await discord.listMembersWithRoles(guildId, categoryRoleIds);
        membersError = membersResult.error;
        attendance = computeAttendance(membersResult.members, found.e.signUps || []);
        // Enrich with class/spec/colour from each member's most recent signup in
        // another event (within the same lookback window) so raiders who haven't
        // reacted here yet can still be shown with their known class.
        const specHistory = buildSpecHistory(groups.flatMap((g) => g.events));
        attendance = {
            responded: withSpecProfiles(attendance.responded, specHistory),
            missing: withSpecProfiles(attendance.missing, specHistory),
        };
    }

    // Softres: pre-select the instances the event title implies. For now the
    // guild only raids TBC, so restrict both the suggestion and the pickable
    // catalogue to the TBC edition.
    const softresEdition = "tbc";
    const suggestedInstances = softres.parseInstancesFromTitle(found.e.title, softresEdition);
    const eventSoftres = getEventSoftres(eventId);
    // Signup counter target: the raid size implied by the created softres list,
    // falling back to the expected headcount from the attendance role(s).
    const signupTarget = eventSoftres && eventSoftres.instances && eventSoftres.instances.length
        ? softres.targetSizeForInstances(eventSoftres.instances)
        : (categoryRoleIds.length ? (attendance.responded.length + attendance.missing.length) : 0);

    ok(res, {
        event: {
            id: found.e.id,
            title: found.e.title,
            startTime: found.e.startTime,
            channelId: found.e.channelId,
            channelName: found.e.channelName,
            signupCount: found.e.signupCount,
        },
        categoryName: found.g.categoryName,
        guildId,
        notifyTemplates: listNotify(),
        roles: discord.listRoles(guildId),
        raidsheets,
        matchedSheetId: matched ? matched.id : "",
        setup,
        setupError,
        tankCandidates: tankCands,
        eventSheet: getEventSheet(eventId),
        eventSoftres,
        softresCatalogue: softres.catalogue().filter((g) => g.edition === softresEdition),
        softresEdition,
        softresSuggested: suggestedInstances.map((i) => i.code),
        attendance,
        attendanceRoleIds: categoryRoleIds,
        membersError,
        signupTarget,
        lootItems: listLootByEvent(eventId),
        lootTool: (getConfig().categoryLootTool || {})[found.g.categoryId] || "",
    });
}

module.exports = { getRaidDetail };
