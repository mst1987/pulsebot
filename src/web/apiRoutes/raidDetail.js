// JSON API for the Raid-Event-Detail page. Part A (below) is the read-only
// overview — meta header, Setup tab, Anwesenheit tab, Loot tab. Part B (this
// file's second half) is the mutating/external-integration actions: Anmelde-
// Aufruf, Fehlende-Raider-pingen, Raidsheet füllen, Sheet/Softres posten,
// Softres-Liste erstellen/verlinken. Both are faithful JSON ports of the SSR
// routes in server.js, minus the HTML rendering/redirects.
const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const { loadEventGroups, eventLookbackSince } = require("../raidEventGroups");
const {
    getConfig, listNotify, listRaidsheets, getNotify, getRaidsheet, resolveEventSheetLink,
} = require("../settingsStore");
const { matchRaidsheet } = require("../../utils/raidsheets");
const { buildSetupView, tankCandidates } = require("../../utils/setupView");
const {
    computeAttendance, buildSpecHistory, withSpecProfiles, withCharacterAssignments,
    hasStarted, isRosterKnown,
} = require("../../utils/attendance");
const { resolveAssignmentProfiles } = require("../raiderCharactersStore");
const { getEventSheet, markEventSheetFilled, markEventSheetPosted } = require("../eventSheetStore");
const { getRaidEvent } = require("../raidEventStore");
const {
    getEventSoftres, saveEventSoftres, setEventSoftresLink, markEventSoftresPosted,
} = require("../eventSoftresStore");
const softres = require("../../utils/softres");
const wowhead = require("../../utils/wowhead");
const { listByEvent: listLootByEvent } = require("../lootStore");
const { listLogs, listLogsForEvent, evaluatedSections } = require("../logStore");
const { backfillLogTitles } = require("../logChannel");
const { createRaidhelperClient } = require("../../utils/raidhelperClient");
const Drive = require("../../classes/drive");
const SheetsClient = require("../../classes/sheets");
const { fillSetupSheet } = require("../../utils/fillSetup");
const { formatTimestampToDateString } = require("../../utils/date");
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
    // A Raid-Helper hiccup no longer blocks the whole page — loadEventGroups()
    // still finds the event via its cached/persisted fallback in that case, so
    // only bail here when the event genuinely can't be resolved at all.
    const { groups, error: groupsError, stale } = await loadEventGroups(guildId, { sinceSeconds: eventLookbackSince() });
    const found = groups.flatMap((g) => g.events.map((e) => ({ e, g }))).find((x) => x.e.id === eventId);
    if (!found) return error(res, groupsError ? 400 : 404, groupsError ? "events_unavailable" : "not_found", groupsError || "Event nicht gefunden.");

    const raidsheets = listRaidsheets();
    const matched = matchRaidsheet(raidsheets, found.e.title);

    // Pull the Raid-Helper raidplan setup so it can be shown inline (best-effort).
    // Once a raid is over, Raid-Helper eventually answers with an empty raidplan;
    // the snapshot raidEventScan.js froze while it was still there then stands in,
    // so a past raid keeps showing the setup it actually ran with.
    let setup = null;
    let setupError = null;
    let tankCands = [];
    let setupFromSnapshot = false;
    const snapshot = getRaidEvent(eventId);
    const snapshotSetup = (snapshot && snapshot.setup) || [];
    try {
        const rh = createRaidhelperClient();
        const result = await rh.getSetup(eventId);
        let slots = result && result.setup ? result.setup : [];
        if (!slots.length && snapshotSetup.length) {
            slots = snapshotSetup;
            setupFromSnapshot = true;
        }
        setup = buildSetupView(slots);
        tankCands = tankCandidates(slots);
    } catch (e) {
        if (snapshotSetup.length) {
            setup = buildSetupView(snapshotSetup);
            tankCands = tankCandidates(snapshotSetup);
            setupFromSnapshot = true;
        } else {
            console.error("event setup load failed:", e.message);
            setupError = e.message || "Setup konnte nicht geladen werden.";
        }
    }

    // A raid that is over and whose signups Raid-Helper no longer returns (and
    // that was never snapshotted) has an UNKNOWN roster — not an empty one.
    // Reporting it as "0 Anmeldungen, alle fehlen" is what made past raids look
    // like nobody had ever reacted.
    const isPast = hasStarted(found.e);
    const signUps = found.e.signUps || [];
    const signupsKnown = isRosterKnown(found.e);

    // Attendance: who (holding a role assigned to this event's category) has not
    // reacted to the signup yet. Empty roleIds → feature simply stays inactive.
    // Skipped entirely when the roster is unknown: every expected raider would
    // land in "missing" and the page would invite a pointless mass ping.
    const categoryRoleIds = (getConfig().categoryRoles || {})[found.g.categoryId] || [];
    let attendance = { responded: [], missing: [] };
    let membersError = null;
    if (categoryRoleIds.length && signupsKnown) {
        const membersResult = await discord.listMembersWithRoles(guildId, categoryRoleIds);
        membersError = membersResult.error;
        attendance = computeAttendance(membersResult.members, signUps);
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

    // Logs: already assigned to this event, plus the still-unassigned ones from
    // this guild (candidates for the "Log zuordnen" picker).
    const eventLogs = listLogsForEvent(eventId);
    const unlinkedLogs = listLogs().filter((l) => (!l.guildId || l.guildId === guildId) && !l.eventId);
    await backfillLogTitles([...eventLogs, ...unlinkedLogs]);
    // Normalise which analyses already ran, so the UI can offer the CLA and RPB
    // buttons independently without having to know about legacy log entries.
    for (const l of [...eventLogs, ...unlinkedLogs]) l.sections = evaluatedSections(l);

    ok(res, {
        event: {
            id: found.e.id,
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
        },
        setupFromSnapshot,
        categoryName: found.g.categoryName,
        guildId,
        eventsWarning: stale ? (groupsError || "Raid-Helper aktuell nicht erreichbar — zeige zwischengespeicherte Event-Daten.") : null,
        notifyTemplates: listNotify(),
        roles: discord.listRoles(guildId),
        raidsheets,
        matchedSheetId: matched ? matched.id : "",
        setup,
        setupError,
        tankCandidates: tankCands,
        eventSheet: getEventSheet(eventId),
        // Which sheet this raid actually links: its own filled copy, else the
        // fixed sheet assigned to its category in the settings, else null.
        sheetLink: resolveEventSheetLink(getEventSheet(eventId), found.g.categoryId),
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
        eventLogs,
        unlinkedLogs,
    });
}

/**
 * Resolve an event's channel + title server-side (never trust client-sent
 * ids), the same "re-derive from Raid-Helper" pattern used by ping-missing and
 * both post-* actions below.
 * @returns {Promise<{ found: object|null, errorMessage: string|null }>}
 */
async function resolveEventForPost(req, eventId) {
    const guildId = activeGuildFor(req);
    const { groups, error: groupsError } = await loadEventGroups(guildId, { sinceSeconds: eventLookbackSince() });
    if (groupsError) return { found: null, errorMessage: groupsError, code: "events_unavailable" };
    const hit = groups.flatMap((g) => g.events.map((e) => ({ e, g }))).find((x) => x.e.id === eventId);
    if (!hit) return { found: null, errorMessage: "Event nicht gefunden.", code: "not_found" };
    // categoryId comes along because the sheet a raid links may be the fixed one
    // assigned to its category (settingsStore's categorySheets).
    return { found: hit.e, categoryId: hit.g.categoryId, errorMessage: null, code: null };
}

/** POST /api/raids/notify — post an Anmelde-Aufruf into the event channel, pinging the chosen roles. Body: { event, templateId, channelId, roleIds }. */
async function postNotify(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const template = getNotify(String(body.templateId || "").trim());
    const channelId = String(body.channelId || "").trim();
    if (!template || !channelId) return error(res, 400, "missing_fields", "Vorlage oder Channel fehlt.");
    try {
        await discord.postAnnouncement(channelId, template, body.roleIds || []);
        ok(res, { message: "Anmelde-Aufruf gepostet." });
    } catch (e) {
        console.error("notify post failed:", e.message);
        error(res, 500, "post_failed", e.message || "Posten fehlgeschlagen.");
    }
}

/**
 * POST /api/raids/ping-missing — ping the raiders who have a role assigned to
 * this event's category but have not reacted to the signup yet. Body: { event, text }.
 * Missing raiders are re-derived server-side; the client never gets to supply
 * the list of who to ping.
 */
async function postPingMissing(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const eventId = String(body.event || "").trim();
    const guildId = activeGuildFor(req);
    const { groups, error: groupsError } = await loadEventGroups(guildId, { sinceSeconds: eventLookbackSince() });
    if (groupsError) return error(res, 400, "events_unavailable", groupsError);
    const found = groups.flatMap((g) => g.events.map((e) => ({ e, g }))).find((x) => x.e.id === eventId);
    if (!found) return error(res, 404, "not_found", "Event nicht gefunden.");
    const categoryRoleIds = (getConfig().categoryRoles || {})[found.g.categoryId] || [];
    if (!categoryRoleIds.length) {
        return error(res, 400, "no_roles", "Dieser Kategorie sind keine Rollen zugeordnet (Einstellungen → Events).");
    }
    // A raid that already started expects no further signups — and once
    // Raid-Helper drops its roster, everyone would count as "missing" and get
    // pinged. Refuse instead of firing a pointless mass ping.
    if (hasStarted(found.e)) {
        return error(res, 400, "event_past", "Der Raid hat bereits begonnen — fehlende Raider zu pingen ergibt hier keinen Sinn mehr.");
    }
    const { members, error: membersError } = await discord.listMembersWithRoles(guildId, categoryRoleIds);
    if (membersError) return error(res, 400, "members_unavailable", membersError);
    const { missing } = computeAttendance(members, found.e.signUps || []);
    if (!missing.length) {
        return ok(res, { message: "Niemand fehlt — es haben schon alle reagiert." });
    }
    try {
        await discord.postMissingPing(found.e.channelId, missing.map((m) => m.id), body.text);
        ok(res, { message: `${missing.length} fehlende Raider gepingt.` });
    } catch (e) {
        console.error("ping-missing failed:", e.message);
        error(res, 500, "post_failed", e.message || "Posten fehlgeschlagen.");
    }
}

/**
 * POST /api/raids/fill — fill a raidsheet from the event's Raid-Helper setup.
 * Each raid gets its OWN copy of the source raidsheet: copy it, share it by
 * link, fill the copy, link it on the event page, and schedule its deletion 3
 * days after the raid. The source raidsheet is never written to or deleted.
 * Body: { event, sheetId, tank3, eventTitle, eventStartTime }.
 */
async function postFill(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const eventId = String(body.event || "").trim();
    const sheet = getRaidsheet(String(body.sheetId || "").trim());
    if (!sheet) return error(res, 400, "sheet_not_found", "Raidsheet nicht gefunden.");
    if (!sheet.spreadsheetId) return error(res, 400, "no_spreadsheet_id", "Raidsheet hat keine Spreadsheet-ID (in den Einstellungen ergänzen).");
    try {
        // Event meta (title + start) is only needed for the copy name and the
        // deletion schedule — take it from the request body (the detail page's
        // already-loaded event) instead of a full getAllEvents round-trip. Both
        // are cosmetic, so trusting the client here is fine; fall back to the
        // sheet name / "now".
        const startMs = (Number(body.eventStartTime) || 0) * 1000;
        const raidDate = startMs ? formatTimestampToDateString(startMs).split(" - ")[0].trim() : "";
        const copyName = `${String(body.eventTitle || "").trim() || sheet.name || "Raidsheet"}${raidDate ? ` — ${raidDate}` : ""}`;
        // Delete 3 days after the raid (fallback: 3 days from now if start unknown).
        const deleteAfter = (startMs || Date.now()) + 3 * 24 * 60 * 60 * 1000;

        const rh = createRaidhelperClient();
        const drive = new Drive();
        const prev = getEventSheet(eventId);

        // The Raid-Helper setup fetch and the Drive copy don't depend on each
        // other — run them concurrently so the two biggest latencies overlap
        // instead of summing. Don't touch the previous copy yet: if the setup
        // turns out empty we keep it and only discard the fresh (orphan) copy.
        const [result, copy] = await Promise.all([
            rh.getSetup(eventId),
            drive.copyFile(sheet.spreadsheetId, copyName),
        ]);

        if (!result || !result.setup || !result.setup.length) {
            drive.deleteFile(copy.id).catch((e) => console.error("orphan copy cleanup failed:", e.message));
            return error(res, 400, "empty_setup", "Setup nicht gefunden oder leer.");
        }

        // Commit to the new copy: record it (so a later failure still leaves a
        // sweepable copy), share it so the service account can write, and delete
        // the previous copy off the critical path (background, best-effort).
        markEventSheetFilled(eventId, {
            spreadsheetId: copy.id, url: copy.url,
            sourceSheetId: sheet.spreadsheetId, deleteAfter,
        });
        if (prev && prev.spreadsheetId && prev.spreadsheetId !== copy.id) {
            drive.deleteFile(prev.spreadsheetId).catch((e) => console.error("previous copy delete failed:", e.message));
        }
        await drive.shareAnyoneWriter(copy.id);
        const client = new SheetsClient({ spreadsheetId: copy.id, sheetName: sheet.sheetName, gid: sheet.gid });
        const summary = await fillSetupSheet(client, result.setup, { tab: sheet.sheetName || "Setup", tank3: String(body.tank3 || "").trim() });
        markEventSheetFilled(eventId, { sheetId: sheet.id, sheetName: sheet.name, playerCount: summary.playerCount });
        const delDate = formatTimestampToDateString(deleteAfter).split(" - ")[0].trim();
        ok(res, {
            message: `Neues Sheet erstellt & gefüllt: ${summary.playerCount} Spieler. Wird am ${delDate} automatisch gelöscht.`,
            playerCount: summary.playerCount,
        });
    } catch (e) {
        console.error("raidsheet fill failed:", e.message);
        error(res, 500, "fill_failed", e.message || "Füllen fehlgeschlagen.");
    }
}

/** POST /api/raids/post-sheet — post the filled raidsheet link into the event channel, with an optional message. Body: { event, message }. */
async function postPostSheet(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const eventId = String(body.event || "").trim();
    const es = getEventSheet(eventId);
    // Resolve the event's channel + title server-side; never trust posted ids.
    // Past raids included — the detail page is reachable for them too.
    const { found, categoryId, errorMessage, code } = await resolveEventForPost(req, eventId);
    if (errorMessage) return error(res, code === "not_found" ? 404 : 400, code, errorMessage);
    // The app-made copy wins; without one the category's fixed sheet is posted.
    const link = resolveEventSheetLink(es, categoryId);
    if (!link) {
        return error(res, 400, "no_sheet", "Für dieses Event gibt es weder ein gefülltes Sheet noch ein der Kategorie zugewiesenes.");
    }
    // "message" present (even "") means the caller set it explicitly; otherwise
    // (quick re-post with no edit) keep whatever text was posted last time.
    const message = body.message !== undefined ? body.message : ((es && es.postedMessage) || "");
    const linkOpts = {
        url: link.url,
        title: found.title ? `Raidsheet – ${found.title}` : "Raidsheet",
        message,
        label: "Raidsheet öffnen",
        emoji: "📄",
    };
    const alreadyPosted = Boolean(es && es.postedChannelId && es.postedMessageId);
    try {
        let posted;
        if (alreadyPosted) {
            try {
                posted = await discord.editLink(es.postedChannelId, es.postedMessageId, linkOpts);
            } catch {
                posted = await discord.postLink(found.channelId, linkOpts);
            }
        } else {
            posted = await discord.postLink(found.channelId, linkOpts);
        }
        markEventSheetPosted(eventId, {
            channelId: posted.channelId, messageId: posted.messageId, message, createIfMissing: true,
        });
        ok(res, { message: alreadyPosted ? "Raidsheet-Nachricht aktualisiert." : "Raidsheet in den Channel gepostet." });
    } catch (e) {
        console.error("post-sheet failed:", e.message);
        error(res, 500, "post_failed", e.message || "Posten fehlgeschlagen.");
    }
}

/** POST /api/raids/post-softres — post the softres list link into the event channel, with an optional message. Body: { event, message }. */
async function postPostSoftres(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const eventId = String(body.event || "").trim();
    const sr = getEventSoftres(eventId);
    if (!sr || !sr.url) return error(res, 400, "no_softres", "Für dieses Event gibt es noch keine Softres-Liste.");
    // Resolve the event's channel + title server-side; never trust posted ids.
    // Past raids included — the detail page is reachable for them too.
    const { found, errorMessage, code } = await resolveEventForPost(req, eventId);
    if (errorMessage) return error(res, code === "not_found" ? 404 : 400, code, errorMessage);
    const message = body.message !== undefined ? body.message : (sr.postedMessage || "");
    const linkOpts = {
        url: sr.url,
        title: found.title ? `Softres – ${found.title}` : "Softres",
        message,
        label: "Softres öffnen",
        emoji: "🎁",
    };
    const alreadyPosted = Boolean(sr.postedChannelId && sr.postedMessageId);
    try {
        let posted;
        if (alreadyPosted) {
            try {
                posted = await discord.editLink(sr.postedChannelId, sr.postedMessageId, linkOpts);
            } catch {
                posted = await discord.postLink(found.channelId, linkOpts);
            }
        } else {
            posted = await discord.postLink(found.channelId, linkOpts);
        }
        markEventSoftresPosted(eventId, { channelId: posted.channelId, messageId: posted.messageId, message });
        ok(res, { message: alreadyPosted ? "Softres-Nachricht aktualisiert." : "Softres-Link in den Channel gepostet." });
    } catch (e) {
        console.error("post-softres failed:", e.message);
        error(res, 500, "post_failed", e.message || "Posten fehlgeschlagen.");
    }
}

/** GET /api/raids/softres/item-search?q=&edition= — Wowhead item search for the softres hard-reserve picker. */
async function getItemSearch(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const q = url.searchParams.get("q") || "";
    const edition = url.searchParams.get("edition") || "tbc";
    const items = await wowhead.searchItems(q, { edition });
    ok(res, { items });
}

/**
 * POST /api/raids/softres — create a softres.it soft-reserve list for this
 * event (instances derived from the title, but editable), with the chosen
 * number of reserves and hard reserves.
 * Body: { event, instanceCodes, amount, faction, hardReserves, hideReserves, protection }.
 * `protection` (softres.it's "User Protection": reserving needs a login and each
 * raider may only edit their own reserves) is on unless explicitly false.
 */
async function postSoftresCreate(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const eventId = String(body.event || "").trim();
    const codes = Array.isArray(body.instanceCodes) ? body.instanceCodes : [];
    if (!codes.length) return error(res, 400, "no_instances", "Mindestens eine Instanz wählen.");
    // All chosen instances must belong to one edition (a softres list is single-edition).
    const editions = [...new Set(codes.map((c) => softres.editionOf(c)).filter(Boolean))];
    if (editions.length !== 1) {
        return error(res, 400, "mixed_edition", "Alle gewählten Instanzen müssen zur selben Erweiterung gehören.");
    }
    const hardReserves = Array.isArray(body.hardReserves) ? body.hardReserves : [];
    try {
        const created = await softres.createRaid({
            instances: codes,
            edition: editions[0],
            amount: body.amount,
            faction: String(body.faction || "").trim(),
            hardReserves,
            hideReserves: body.hideReserves === true,
            protection: body.protection !== false,
        });
        saveEventSoftres(eventId, {
            raidId: created.raidId,
            token: created.token,
            url: created.url,
            editUrl: created.editUrl,
            edition: editions[0],
            instances: codes,
            amount: Number(body.amount) || 1,
            hardReserveCount: hardReserves.length,
        });
        // The list itself is created either way; hard reserves are a follow-up
        // write on softres.it and can fail on their own. Say so instead of
        // reporting a clean success the raidlead would not verify.
        const message = created.hardReserveError
            ? `Softres-Liste erstellt, aber die Hardreserves konnten nicht gesetzt werden: ${created.hardReserveError}`
            : "Softres-Liste erstellt.";
        ok(res, { message }, 201);
    } catch (e) {
        console.error("softres create failed:", e.message);
        error(res, 500, "softres_failed", e.message || "Softres-Erstellung fehlgeschlagen.");
    }
}

/**
 * POST /api/raids/softres/link — point the event at a manually chosen
 * softres.it link (e.g. one already set up directly on softres.it) instead of
 * one created via the API above. Body: { event, softresUrl, softresEditUrl }.
 */
async function postSoftresLink(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const eventId = String(body.event || "").trim();
    const softresUrl = String(body.softresUrl || "").trim();
    if (!/^https:\/\/(www\.)?softres\.it\/raid\/[a-zA-Z0-9]+/i.test(softresUrl)) {
        return error(res, 400, "invalid_url", "Das muss ein softres.it-Raid-Link sein (https://softres.it/raid/...).");
    }
    setEventSoftresLink(eventId, { url: softresUrl, editUrl: String(body.softresEditUrl || "").trim() });
    ok(res, { message: "Softres-Link aktualisiert." });
}

module.exports = {
    getRaidDetail,
    postNotify,
    postPingMissing,
    postFill,
    postPostSheet,
    postPostSoftres,
    getItemSearch,
    postSoftresCreate,
    postSoftresLink,
};
