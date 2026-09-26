// JSON API for the Raid-Event-Detail page. Part A (below) is the read-only
// overview — meta header, Setup tab, Anwesenheit tab, Loot tab — whose payload
// raidDetailView.js builds (#424). Part B (this file's second half) is the
// mutating/external-integration actions: Anmelde-Aufruf, Fehlende-Raider-pingen,
// Raidsheet füllen, Sheet/Softres posten, Softres-Liste erstellen/verlinken.
// Both are faithful JSON ports of the SSR routes in server.js, minus the HTML
// rendering/redirects.
const { ok, error } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { AppError, sendResult } = require("../http/apiResult");
const { q } = require("../http/apiParams");
const { activeGuildFor } = require("../http/activeGuild");
const { loadEventGroups, eventLookbackSince } = require("../../services/events/raidEventGroups");
const { getNotify, getRaidsheet, resolveEventSheetLink } = require("../../stores/settingsStore");
const { getEventSheet, markEventSheetFilled, markEventSheetPosted } = require("../../stores/eventSheetStore");
const { sourceOfEventId } = require("../../services/events/eventSources");
const {
    getEventSoftres, saveEventSoftres, setEventSoftresLink, markEventSoftresPosted,
} = require("../../stores/eventSoftresStore");
const softres = require("../../utils/loot/softres");
const { setEventLootSystem, lootSystemOf } = require("../../stores/eventLootSystemStore");
const { normalizeLootSystem } = require("../../services/loot/lootSystem");
const wowhead = require("../../utils/loot/wowhead");
const { createRaidhelperClient } = require("../../utils/raidhelper/client");
const Drive = require("../../classes/drive");
const SheetsClient = require("../../classes/sheets");
const { fillSetupSheet } = require("../../utils/setup/fillSetup");
const { formatTimestampToDateString } = require("../../utils/time");
const discord = require("../../services/discord/discord");
const { getEvent } = require("../../stores/eventStore");
const { raidHelperSlots } = require("../../services/setup/setupEditor");
const { invitePlan, callInvite } = require("../../services/setup/inviteCall");
const {
    normalizePingTarget, deliverAnnouncement, dmSummary, TARGET_LABELS,
} = require("../../services/discord/pingDelivery");
const { pingMissingRaiders } = require("../../services/events/missingPing");
const { buildRaidDetail } = require("../events/raidDetailView");

/**
 * GET /api/raids/detail?event=<id> — everything the event-detail page needs in
 * one read; built by raidDetailView.js, this is only the HTTP side.
 */
const getRaidDetail = withUser({}, async ({ req, res, url }) => {
    const eventId = (url.searchParams.get("event") || "").trim();
    return sendResult(res, await buildRaidDetail({ guildId: activeGuildFor(req), eventId }));
});

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
const postNotify = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const template = getNotify(q.str(body, "templateId"));
    const channelId = q.str(body, "channelId");
    const target = normalizePingTarget(body.target);
    if (!template || (target !== "talk" && !channelId)) return error(res, 400, "missing_fields", "Vorlage oder Channel fehlt.");
    try {
        if (target === "event") {
            await discord.postAnnouncement(channelId, template, body.roleIds || []);
            return ok(res, { message: "Anmelde-Aufruf gepostet." });
        }
        // The DM fallback names the raid, so the event is resolved server-side;
        // a failed lookup only costs the DM its title.
        const eventId = q.str(body, "event");
        const { found } = eventId ? await resolveEventForPost(req, eventId) : { found: null };
        const result = await deliverAnnouncement({
            target, event: found, channelId, template, roleIds: body.roleIds || [], guildId: activeGuildFor(req),
        });
        ok(res, { message: `Anmelde-Aufruf gepostet (${TARGET_LABELS[target]})${dmSummary(result.dm)}.`, delivery: result });
    } catch (e) {
        throw new AppError("post_failed", 500, e.message || "Posten fehlgeschlagen.");
    }
});

/**
 * POST /api/raids/ping-missing — ping the raiders who have a role assigned to
 * this event's category but have not reacted to the signup yet. Body: { event, text }.
 * Missing raiders are re-derived server-side; the client never gets to supply
 * the list of who to ping.
 */
const postPingMissing = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const eventId = q.str(body, "event");
    const guildId = activeGuildFor(req);
    const result = await pingMissingRaiders({ guildId, eventId, target: body.target, text: body.text });
    if (result.error) return sendResult(res, result);
    ok(res, result.delivery ? { message: result.message, delivery: result.delivery } : { message: result.message });
});

/**
 * POST /api/raids/invite-call — "Invite callen": ping groups 1–5 of the
 * approved setup in the event channel with "/w <Charakter> inv", the character
 * being the caller's own (inviteCall.js). Body: `{ event, dryRun }`; `dryRun`
 * answers who and what without posting (the dialog's preview).
 */
const postInviteCall = withUser({ csrf: true, body: true }, async ({ user, body, req, res }) => {
    const eventId = q.str(body, "event");
    const guildId = activeGuildFor(req);
    if (body.dryRun) {
        const event = getEvent(eventId);
        const plan = event && (!guildId || event.guildId === guildId)
            ? invitePlan(event, user.id)
            : { error: { status: 404, code: "not_found", message: "Event nicht gefunden." } };
        if (plan.error) return sendResult(res, plan);
        return ok(res, { count: plan.userIds.length, text: plan.text, groups: plan.groups });
    }
    const result = await callInvite({ guildId, eventId, userId: user.id, byName: user.name || "" });
    if (result.error) return sendResult(res, result);
    ok(res, { message: result.message, count: result.count, text: result.text });
});

/**
 * POST /api/raids/fill — fill a raidsheet from the event's Raid-Helper setup.
 * Each raid gets its OWN copy of the source raidsheet: copy it, share it by
 * link, fill the copy, link it on the event page, and schedule its deletion 3
 * days after the raid. The source raidsheet is never written to or deleted.
 * Body: { event, sheetId, tank3, eventTitle, eventStartTime }.
 */
const postFill = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const eventId = q.str(body, "event");
    const sheet = getRaidsheet(q.str(body, "sheetId"));
    if (!sheet) return error(res, 400, "sheet_not_found", "Raidsheet nicht gefunden.");
    // An own event fills the sheet from its approved setup (#263) — never from a draft.
    const own = sourceOfEventId(eventId) === "eventhelper";
    const ownSlots = own ? raidHelperSlots(getEvent(eventId)) : null;
    if (own && !ownSlots.length) {
        return error(res, 400, "no_approved_setup", "Dieses Event hat noch kein freigegebenes Setup – erst im Tab „Setup“ freigeben, dann das Sheet füllen.");
    }
    if (!sheet.spreadsheetId) return error(res, 400, "no_spreadsheet_id", "Raidsheet hat keine Spreadsheet-ID (in den Einstellungen ergänzen).");
    try {
        // Event meta (title + start) is only needed for the copy name and the
        // deletion schedule — take it from the request body (the detail page's
        // already-loaded event) instead of a full getAllEvents round-trip. Both
        // are cosmetic, so trusting the client here is fine; fall back to the
        // sheet name / "now".
        const startMs = (Number(body.eventStartTime) || 0) * 1000;
        const raidDate = startMs ? formatTimestampToDateString(startMs).split(" - ")[0].trim() : "";
        const copyName = `${q.str(body, "eventTitle") || sheet.name || "Raidsheet"}${raidDate ? ` — ${raidDate}` : ""}`;
        // Delete 3 days after the raid (fallback: 3 days from now if start unknown).
        const deleteAfter = (startMs || Date.now()) + 3 * 24 * 60 * 60 * 1000;

        const drive = new Drive();
        const prev = getEventSheet(eventId);

        // The Raid-Helper setup fetch and the Drive copy don't depend on each
        // other — run them concurrently so the two biggest latencies overlap
        // instead of summing. Don't touch the previous copy yet: if the setup
        // turns out empty we keep it and only discard the fresh (orphan) copy.
        const [result, copy] = await Promise.all([
            own ? { setup: ownSlots } : createRaidhelperClient().getSetup(eventId),
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
        const summary = await fillSetupSheet(client, result.setup, { tab: sheet.sheetName || "Setup", tank3: q.str(body, "tank3") });
        markEventSheetFilled(eventId, { sheetId: sheet.id, sheetName: sheet.name, playerCount: summary.playerCount });
        const delDate = formatTimestampToDateString(deleteAfter).split(" - ")[0].trim();
        ok(res, {
            message: `Neues Sheet erstellt & gefüllt: ${summary.playerCount} Spieler. Wird am ${delDate} automatisch gelöscht.`,
            playerCount: summary.playerCount,
        });
    } catch (e) {
        throw new AppError("fill_failed", 500, e.message || "Füllen fehlgeschlagen.");
    }
});

/** POST /api/raids/post-sheet — post the filled raidsheet link into the event channel, with an optional message. Body: { event, message }. */
const postPostSheet = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const eventId = q.str(body, "event");
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
        throw new AppError("post_failed", 500, e.message || "Posten fehlgeschlagen.");
    }
});

/** POST /api/raids/post-softres — post the softres list link into the event channel, with an optional message. Body: { event, message }. */
const postPostSoftres = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const eventId = q.str(body, "event");
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
        throw new AppError("post_failed", 500, e.message || "Posten fehlgeschlagen.");
    }
});

/** GET /api/raids/softres/item-search?q=&edition= — Wowhead item search for the softres hard-reserve picker. */
const getItemSearch = withUser({}, async ({ res, url }) => {
    const term = url.searchParams.get("q") || "";
    const edition = url.searchParams.get("edition") || "tbc";
    const items = await wowhead.searchItems(term, { edition });
    ok(res, { items });
});

/**
 * POST /api/raids/softres — create a softres.it soft-reserve list for this
 * event (instances derived from the title, but editable), with the chosen
 * number of reserves and hard reserves.
 * Body: { event, instanceCodes, amount, faction, hardReserves, hideReserves, protection }.
 * `protection` (softres.it's "User Protection": reserving needs a login and each
 * raider may only edit their own reserves) is on unless explicitly false.
 */
const postSoftresCreate = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const eventId = q.str(body, "event");
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
            faction: q.str(body, "faction"),
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
        throw new AppError("softres_failed", 500, e.message || "Softres-Erstellung fehlgeschlagen.");
    }
});

/**
 * POST /api/raids/softres/link — point the event at a manually chosen
 * softres.it link (e.g. one already set up directly on softres.it) instead of
 * one created via the API above. Body: { event, softresUrl, softresEditUrl }.
 */
const postSoftresLink = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const eventId = q.str(body, "event");
    const softresUrl = q.str(body, "softresUrl");
    if (!/^https:\/\/(www\.)?softres\.it\/raid\/[a-zA-Z0-9]+/i.test(softresUrl)) {
        return error(res, 400, "invalid_url", "Das muss ein softres.it-Raid-Link sein (https://softres.it/raid/...).");
    }
    setEventSoftresLink(eventId, { url: softresUrl, editUrl: q.str(body, "softresEditUrl") });
    ok(res, { message: "Softres-Link aktualisiert." });
});

/**
 * POST /api/raids/loot-system — this raid's loot system where it differs from
 * its category's, plus "Softres zusätzlich". Body: { event, system, softres }
 * (`system` "" = like the category). Answers the resolved loot system.
 */
const postLootSystem = withUser({ csrf: true, body: true }, async ({ user, body, req, res }) => {
    const eventId = q.str(body, "event");
    const system = q.str(body, "system");
    if (system && !normalizeLootSystem(system)) return error(res, 400, "invalid_system", "Unbekanntes Lootsystem.");
    const { groups, error: groupsError } = await loadEventGroups(activeGuildFor(req), { sinceSeconds: eventLookbackSince() });
    const found = groups.flatMap((g) => g.events.map((e) => ({ e, g }))).find((x) => x.e.id === eventId);
    if (!found) return error(res, groupsError ? 400 : 404, groupsError ? "events_unavailable" : "not_found", groupsError || "Event nicht gefunden.");
    setEventLootSystem(eventId, { system, softres: body.softres === true, by: user.id, byName: user.name });
    const lootSystem = lootSystemOf(eventId, found.g.categoryId);
    ok(res, { lootSystem, message: `Lootsystem: ${lootSystem.label}${lootSystem.softresExtra ? " + Softres" : ""}.` });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/raids/detail", handler: getRaidDetail, area: "raids" },
    { method: "POST", path: "/api/raids/notify", handler: postNotify, area: "raids" },
    { method: "POST", path: "/api/raids/ping-missing", handler: postPingMissing, area: "raids" },
    { method: "POST", path: "/api/raids/invite-call", handler: postInviteCall, area: "raids" },
    { method: "POST", path: "/api/raids/fill", handler: postFill, area: "raids" },
    { method: "POST", path: "/api/raids/post-sheet", handler: postPostSheet, area: "raids" },
    { method: "POST", path: "/api/raids/post-softres", handler: postPostSoftres, area: "raids" },
    { method: "GET", path: "/api/raids/softres/item-search", handler: getItemSearch, area: "raids" },
    { method: "POST", path: "/api/raids/softres", handler: postSoftresCreate, area: "raids" },
    { method: "POST", path: "/api/raids/softres/link", handler: postSoftresLink, area: "raids" },
    { method: "POST", path: "/api/raids/loot-system", handler: postLootSystem, area: "raids" },
];

module.exports = {
    getRaidDetail,
    postNotify,
    postPingMissing,
    postInviteCall,
    postFill,
    postPostSheet,
    postPostSoftres,
    getItemSearch,
    postSoftresCreate,
    postSoftresLink,
    postLootSystem,
    routes,
};
