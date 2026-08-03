const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const { loadEventGroups, eventLookbackSince } = require("../raidEventGroups");
const { loadRecentEvents, annotateUpcomingExtras } = require("../dashboardData");
const { getConfig, saveConfig } = require("../settingsStore");
const { listLogs, deleteLog } = require("../logStore");
const { logPostedAt } = require("../reportList");
const {
    addImport: addLootImport, listByEvent: listLootByEvent, listByCharacter: listLootByCharacter, eventsWithLoot, clearEvent: clearLootEvent,
    setEventCategory: setLootEventCategory, removeItems: removeLootItems, repairItemNames: repairLootItemNames,
    decorate: decorateLootItem,
} = require("../lootStore");
const { lootStats } = require("../lootStats");
const { listAwards } = require("../lootAwards");
const { rememberFromLoot: rememberClassesFromLoot, annotatedCharacters, resolveMissing } = require("../characterInfo");
const { getCharacter } = require("../characterStore");
const { issuesForCharacter } = require("../charGearIssues");
const { parseLoot, detectImportDate, enrichItemNames, LootParseError } = require("../../utils/lootImport");
const { bestDayMatch, formatDayDisplay, dayKey } = require("../lootEventMatch");
const {
    listPending: listPendingSessions, getPending: getPendingSession, resolvePending: resolvePendingSession,
} = require("../lootInboxStore");
const { sessionContentLabel } = require("../lootSessionContent");
const { CLASS_COLORS, classSpecIconUrl } = require("../../utils/setupView");
const { applyArmoryUrlTemplate, applyWclUrlTemplate } = require("../../config/variables");
const Blizzard = require("../../classes/blizzard");
const discord = require("../discord");
const { listKnownCategories } = require("../categoryNames");

// A manually-labelled loot bucket's synthetic event id: "manual-<slug>".
const slugify = (label) => String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Fill a {char} URL template (armory / WCL) for a character name.
const fillCharTemplate = (tpl, character) => String(tpl || "").replace("{char}", encodeURIComponent(String(character || "").trim()));

// Class colour + spec icon for anything that renders a raider's name. Computed
// server-side like every other class colour in the app (see ClassSpec.tsx's
// header comment), so the client never owns a second copy of the palette.
const withClassLook = (c) => ({
    ...c,
    classColor: CLASS_COLORS[c.className] || "",
    iconUrl: c.className ? classSpecIconUrl(c.className, c.spec) : "",
});

/** GET /api/history — everything the "Alle Raids/Import/Loot/Logs/Loot-Tools" tabs need. */
async function getHistoryData(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    const { groups, error: upcomingError } = await loadEventGroups(guildId);
    const allUpcoming = groups.flatMap((g) => g.events);
    const events = allUpcoming.map((ev) => ({ id: ev.id, title: ev.title, startTime: ev.startTime, categoryId: ev.categoryId }));
    const upcomingRaids = { events: annotateUpcomingExtras(allUpcoming, guildId), error: upcomingError };
    const pastRaids = await loadRecentEvents(guildId, Infinity);
    const cfg = getConfig();

    ok(res, {
        events,
        upcomingRaids,
        pastRaids,
        lootEvents: eventsWithLoot(),
        // postedAt: when the WCL link was actually posted in the channel (falls
        // back through the message-id snowflake to detectedAt) — same field the
        // legacy SSR page and the dashboard's "Latest Events" card show.
        logs: listLogs().map((l) => ({ ...l, postedAt: logPostedAt(l) })),
        // For labelling the loot rows' category ids, so one that Discord no
        // longer lists keeps its name (categoryNames.js). The import form's
        // validation stays on the live list — see pickedCategory().
        categories: listKnownCategories(guildId),
        categoryLootTool: cfg.categoryLootTool || {},
        activeGuildId: guildId,
        chars: annotatedCharacters().map(withClassLook),
    });
}

/**
 * GET /api/history/loot-stats — the two cross-raid overviews: loot per raider
 * broken down by award reason, and every looted item with its recipients.
 * Own endpoint rather than part of /api/history: it carries every loot row that
 * was ever imported, which the five older tabs have no use for.
 */
async function getLootStats(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    // Same one-time backfill the event/character pages do — an item without a
    // name is unusable in a table that is sorted and filtered by name.
    await repairLootItemNames();
    const stats = lootStats();
    ok(res, {
        ...stats,
        characters: stats.characters.map(withClassLook),
        items: stats.items.map((it) => ({ ...it, awards: it.awards.map(withClassLook) })),
    });
}

/**
 * GET /api/history/loot-awards — one page of the "Latest Loot" tab: awards
 * newest first, filtered and cut into pages of 25 (see lootAwards.js).
 *
 * Query: page, top ("0" widens the list from the configured top items to all
 * loot), q (item name/id or character), category, content, reason.
 *
 * Paged on the server rather than in the browser: the loot store holds every row
 * ever imported, and the tab only ever shows one page of it.
 */
async function getLootAwards(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    // Same one-time backfill as the other loot views — a row without a name is
    // unusable in a list that is searched by name.
    await repairLootItemNames();
    const q = url.searchParams;
    ok(res, listAwards({
        topOnly: q.get("top") !== "0",
        search: q.get("q") || "",
        categoryId: q.get("category") || "",
        contentId: q.get("content") || "",
        reason: q.get("reason") || "",
        page: Number(q.get("page")) || 1,
    }));
}

/** POST /api/history/log-delete — body: { logId }. */
async function deleteHistoryLog(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    deleteLog(String(body.logId || "").trim());
    ok(res, { id: body.logId });
}

/**
 * A raid category picked by hand (import form / loot list), checked against the
 * guild's live Discord categories so a stale or typo'd id can't file loot under
 * a category that does not exist. Only checked when that list is actually
 * available: with the Discord gateway offline it comes back empty, and a local
 * instance must stay able to assign one. "" (= no category) is always allowed.
 * @returns {{id: string}|{error: string}}
 */
function pickedCategory(req, requested) {
    const id = String(requested || "").trim();
    if (!id) return { id: "" };
    const guildId = activeGuildFor(req);
    const known = guildId ? discord.listCategories(guildId) : [];
    if (known.length && !known.some((c) => c.id === id)) return { error: "Unbekannte Kategorie." };
    return { id };
}

/**
 * Which event a batch of loot items should be filed under. Shared by the paste
 * import and the addon inbox, so both understand the same three answers for
 * `event`: a real event id, "__auto__" (match by the loot's own date) or
 * "__manual__" (a hand-typed label, no Raid-Helper event involved).
 *
 * @returns {{ eventId, eventLabel, categoryId } | { error, status, code }}
 */
async function resolveImportTarget(req, { event, manualLabel, items }) {
    let eventId = String(event || "").trim();
    const manualTitle = String(manualLabel || "").trim();

    if (eventId === "__manual__") {
        if (!manualTitle) {
            return { error: "Bitte ein Event wählen oder eine Bezeichnung eingeben.", status: 400, code: "no_label" };
        }
        return { eventId: `manual-${slugify(manualTitle)}`, eventLabel: manualTitle, categoryId: "" };
    }

    if (eventId === "__auto__" || !eventId) {
        const detected = detectImportDate(items);
        const { groups } = await loadEventGroups(activeGuildFor(req), { sinceSeconds: eventLookbackSince() });
        const allEvents = groups.flatMap((g) => g.events);
        const { match, ambiguous } = detected ? bestDayMatch(detected, allEvents) : { match: null, ambiguous: false };
        if (ambiguous) {
            return {
                error: `Mehrere Events am ${formatDayDisplay(detected)} gefunden — bitte unten das passende Event auswählen.`,
                status: 409,
                code: "ambiguous",
            };
        }
        if (match) {
            const g = groups.find((gr) => gr.events.includes(match));
            return {
                eventId: match.id,
                eventLabel: manualTitle || match.title || match.id,
                categoryId: g ? (g.categoryId || "") : "",
            };
        }
        const label = manualTitle || (detected ? `Raid vom ${formatDayDisplay(detected)}` : "");
        if (!label) {
            return {
                error: "Kein Event am erkannten Datum gefunden und kein Datum im Export erkannt — bitte Event wählen oder einen Titel eingeben.",
                status: 400,
                code: "no_match",
            };
        }
        return {
            eventId: `manual-${slugify(label)}${detected ? `-${dayKey(detected)}` : ""}`,
            eventLabel: label,
            categoryId: "",
        };
    }

    const { groups } = await loadEventGroups(activeGuildFor(req), { sinceSeconds: eventLookbackSince() });
    const found = groups.flatMap((g) => g.events.map((ev) => ({ ev, g }))).find((x) => x.ev.id === eventId);
    return {
        eventId,
        eventLabel: found ? (found.ev.title || eventId) : eventId,
        categoryId: found ? (found.g.categoryId || "") : "",
    };
}

/**
 * POST /api/history/import — body: { data, tool, event, manualLabel, categoryId }.
 * `event` is a real event id, "__auto__" (match by the export's own date) or
 * "__manual__" (a hand-typed label, no Raid-Helper event involved).
 * `categoryId` is the raid category to file the loot under; it only applies when
 * no event supplied one (manual import / no match) — an event's own Discord
 * category always wins over a hand-picked one.
 */
async function importLoot(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);

    const data = String(body.data || "").trim();
    if (!data) return error(res, 400, "no_data", "Kein Loot-Text eingefügt.");
    const tool = (body.tool || "auto").trim();
    let items;
    try {
        items = parseLoot(data, tool);
    } catch (e) {
        return error(res, 400, "parse_failed", e instanceof LootParseError ? e.message : "Import fehlgeschlagen.");
    }
    if (!items.length) return error(res, 400, "empty", "Keine Loot-Einträge im Export gefunden.");
    const picked = pickedCategory(req, body.categoryId);
    if (picked.error) return error(res, 400, "bad_category", picked.error);
    await enrichItemNames(items);

    const target = await resolveImportTarget(req, {
        event: body.event,
        manualLabel: body.manualLabel,
        items,
    });
    if (target.error) return error(res, target.status, target.code, target.error);
    const { eventId, eventLabel } = target;

    // Only where the event left a gap — see the header comment.
    const categoryId = target.categoryId || picked.id;

    const { added, skipped } = addLootImport(eventId, items, { categoryId, eventLabel });
    // RCLootcouncil exports carry the raider's class — keep it right away, so the
    // character list only has to fall back to the logs for what is still missing.
    rememberClassesFromLoot(items);
    if (categoryId && (tool === "gargul" || tool === "rclc")) {
        saveConfig({ categoryLootTool: { [categoryId]: tool } });
    }
    ok(res, { eventId, eventLabel, categoryId, added, skipped }, 201);
}

/**
 * POST /api/history/loot-category — body: { event, categoryId }.
 * Files an already-imported loot bucket under a raid category, or clears it with
 * an empty id. The point of it: loot imported without a Raid-Helper event has no
 * category at all and is therefore missing from every category-grouped overview
 * ("Charaktere", "Loot-Gründe") — this assigns one after the fact.
 */
async function setLootCategory(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const eventId = String(body.event || "").trim();
    if (!eventId) return error(res, 400, "no_event", "Kein Event angegeben.");
    const picked = pickedCategory(req, body.categoryId);
    if (picked.error) return error(res, 400, "bad_category", picked.error);
    const updated = setLootEventCategory(eventId, picked.id);
    ok(res, { eventId, categoryId: picked.id, updated });
}

/**
 * POST /api/history/loot-delete — body: { id } or { ids: [...] }.
 * Deletes single loot rows by their stored id, wherever they are shown (raid
 * detail, event history, character history) — the fine-grained counterpart to
 * /api/history/clear, which throws away a whole import.
 */
async function deleteLootItems(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [body.id];
    const wanted = ids.map((id) => String(id || "").trim()).filter(Boolean);
    if (!wanted.length) return error(res, 400, "no_id", "Kein Loot-Eintrag angegeben.");
    const removed = removeLootItems(wanted);
    // An id that matched nothing is a stale view (someone else deleted it, or
    // the import was cleared) — say so instead of reporting a silent success.
    if (!removed) return error(res, 404, "not_found", "Loot-Eintrag nicht gefunden — die Ansicht ist veraltet.");
    ok(res, { removed });
}

/** POST /api/history/clear — body: { event }. Deletes all loot stored for one event. */
async function clearHistoryEvent(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const removed = clearLootEvent(String(body.event || "").trim());
    ok(res, { removed });
}

// ---- addon inbox: sessions uploaded by the loot-sync tool, awaiting a decision ----

/**
 * GET /api/history/inbox — the raid sessions the WoW addon uploaded but nobody
 * has filed yet, each with the event it was matched to (a suggestion only) and
 * its loot, so the admin can see what they are accepting before they accept it.
 */
async function getLootInbox(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    // Decorated like stored loot (reason badge, raid, tier) even though it isn't
    // stored yet — the preview should look like the history it is about to be.
    const sessions = listPendingSessions().map((s) => {
        // Welcher Raid das war, notfalls aus den Item-IDs — das Addon kann es
        // nicht immer wissen (siehe lootSessionContent.js).
        const content = sessionContentLabel(s);
        return {
            ...s,
            items: (s.items || []).map(decorateLootItem),
            contentLabel: content.label,
            contentSource: content.source,
            contentMatched: content.derived.matched,
        };
    });
    ok(res, { sessions });
}

/**
 * POST /api/history/inbox-accept — body: { id, event, manualLabel, categoryId }.
 * Files a pending session's loot under an event and takes it out of the inbox.
 * `event` defaults to the suggested match; the admin can override it with any
 * event id, "__auto__" or "__manual__" (same vocabulary as the paste import).
 */
async function acceptLootInbox(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const entry = getPendingSession(String(body.id || "").trim());
    if (!entry) return error(res, 404, "not_found", "Diese Session liegt nicht mehr in der Inbox.");

    const picked = pickedCategory(req, body.categoryId);
    if (picked.error) return error(res, 400, "bad_category", picked.error);

    // No explicit choice → take the match the upload already suggested, and only
    // fall back to re-matching by date when there was none.
    const suggested = entry.match && entry.match.suggested ? entry.match.suggested.eventId : "";
    const target = await resolveImportTarget(req, {
        event: String(body.event || "").trim() || suggested || "__auto__",
        manualLabel: body.manualLabel,
        items: entry.items,
    });
    if (target.error) return error(res, target.status, target.code, target.error);

    const categoryId = target.categoryId || picked.id;
    const { added, skipped } = addLootImport(target.eventId, entry.items, {
        categoryId,
        eventLabel: target.eventLabel,
    });
    rememberClassesFromLoot(entry.items);
    // Remembered on the session, so the rest of the raid night appends here by
    // itself on the next upload instead of asking again.
    resolvePendingSession(entry.id, "accepted", {
        eventId: target.eventId,
        eventLabel: target.eventLabel,
        categoryId,
    });
    ok(res, { eventId: target.eventId, eventLabel: target.eventLabel, categoryId, added, skipped }, 201);
}

/**
 * POST /api/history/inbox-dismiss — body: { id }. Throws a session away without
 * importing it. The decision sticks: the sync tool re-uploads the same session
 * as long as it is in the addon's SavedVariables, and it must not come back.
 */
async function dismissLootInbox(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const removed = resolvePendingSession(String(body.id || "").trim(), "dismissed");
    if (!removed) return error(res, 404, "not_found", "Diese Session liegt nicht mehr in der Inbox.");
    ok(res, { id: removed.id, sessionId: removed.sessionId });
}

/** GET /api/history/event?event=<id> — the loot imported for one event. */
async function getHistoryEvent(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const eventId = url.searchParams.get("event") || "";
    // Backfill names/icons on rows imported before enrichment existed, so old
    // records stop showing as "Item <id>" (persisted — a one-time repair).
    await repairLootItemNames();
    const items = listLootByEvent(eventId);
    const label = (items[0] && items[0].eventLabel) || eventId;
    ok(res, { eventId, label, items });
}

/**
 * POST /api/history/characters-resolve — fill in the class/spec that is still
 * missing for the loot characters: from the export, from an already evaluated
 * CLA report, else from the Warcraft-Logs report of the raid.
 */
async function resolveCharacters(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const r = await resolveMissing();
    if (r.error) return error(res, 502, "wcl_unavailable", r.error);
    const filled = r.fromExport + r.fromReports + r.fromWcl;
    const parts = [`${filled} Charakter(e) ergänzt`];
    if (r.checkedReports) parts.push(`${r.checkedReports} Log(s) ausgewertet`);
    // Say what was NOT covered, so an empty result is never mistaken for "done".
    if (r.pendingReports) parts.push(`${r.pendingReports} weitere(s) Log(s) offen — nochmal ausführen`);
    if (r.unlinked.length) parts.push(`${r.unlinked.length} ohne zugeordnetes Log (Log im CLA-Menü dem Event zuordnen)`);
    if (r.missing.length) parts.push(`${r.missing.length} weiterhin ohne Klasse`);
    ok(res, { ...r, message: `${parts.join(", ")}.` });
}

/**
 * GET /api/history/char?name=<name> — loot history plus live Blizzard gear
 * (paperdoll) and diagnostics for one character.
 */
async function getHistoryChar(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const name = url.searchParams.get("name") || "";
    await repairLootItemNames(); // see getHistoryEvent
    const items = listLootByCharacter(name);
    const cfg = getConfig();
    const bzCfg = cfg.blizzard || {};
    const realm = (items[0] && items[0].realm) || bzCfg.realmSlug || "";
    const armoryUrl = fillCharTemplate(applyArmoryUrlTemplate, name);
    const wclUrl = fillCharTemplate(applyWclUrlTemplate, name);
    const client = new Blizzard(bzCfg);
    const gearConfigured = client.isConfigured();
    const gearNamespace = client._resolve().namespace;
    let gear = null;
    let gearError = "";
    let charSummary = null;
    if (gearConfigured && name) {
        // Summary first — its level/last-login reveal whether the profile is
        // the right character (a level 60/80 hit on a level-70 TBC char means
        // a wrong-namespace match → wrong-era gear).
        charSummary = await client.getCharacterSummary(name);
        gear = await client.getEquipment(name);
        if (gear === null) {
            const e = client.lastError || {};
            if (e.status === 404) gearError = `Charakter „${name}" nicht in der Blizzard-API gefunden (404, Namespace ${gearNamespace}). Realm-Slug „${bzCfg.realmSlug || "thunderstrike"}"/Schreibweise prüfen oder den Namespace in den Einstellungen ändern (z.B. profile-classicann-${bzCfg.region || "eu"}).`;
            else if (e.status === 403) gearError = "Zugriff verweigert (403) — die Profile-API ist für diesen Realm evtl. nicht freigegeben.";
            else if (e.status === 401) gearError = "Authentifizierung fehlgeschlagen (401) — Battle.net Client-ID/Secret prüfen.";
            else if (e.status) gearError = `Blizzard-API-Fehler (${e.status}).`;
            else gearError = `Blizzard-API nicht erreichbar (${e.message || "Netzwerkfehler"}).`;
        }
    }
    ok(res, {
        character: name,
        realm,
        items,
        armoryUrl,
        wclUrl,
        gear,
        gearConfigured,
        gearError,
        charSummary,
        gearNamespace,
        info: enrichCharInfo(getCharacter(name)),
        // What the last CLA evaluation found on this character's gear — the
        // detail behind the roster overview's issue count.
        gearIssues: issuesForCharacter(name),
    });
}

// Add the same color/icon fields the "Charaktere" tab gets, so the char-detail
// header can render the class/spec suffix without duplicating CLASS_COLORS.
function enrichCharInfo(info) {
    if (!info) return null;
    return {
        ...info,
        classColor: CLASS_COLORS[info.className] || "",
        iconUrl: info.className ? classSpecIconUrl(info.className, info.spec) : "",
    };
}

module.exports = {
    getLootInbox, acceptLootInbox, dismissLootInbox,
    getHistoryData, getLootStats, getLootAwards, deleteHistoryLog, importLoot, setLootCategory, deleteLootItems, clearHistoryEvent, getHistoryEvent,
    resolveCharacters, getHistoryChar,
};
