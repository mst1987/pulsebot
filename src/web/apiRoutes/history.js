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
    setEventCategory: setLootEventCategory, repairItemNames: repairLootItemNames,
} = require("../lootStore");
const { lootStats } = require("../lootStats");
const { rememberFromLoot: rememberClassesFromLoot, annotatedCharacters, resolveMissing } = require("../characterInfo");
const { getCharacter } = require("../characterStore");
const { issuesForCharacter } = require("../charGearIssues");
const { parseLoot, detectImportDate, enrichItemNames, LootParseError } = require("../../utils/lootImport");
const { bestDayMatch, formatDayDisplay, dayKey } = require("../lootEventMatch");
const { CLASS_COLORS, classSpecIconUrl } = require("../../utils/setupView");
const { applyArmoryUrlTemplate, applyWclUrlTemplate } = require("../../config/variables");
const Blizzard = require("../../classes/blizzard");
const discord = require("../discord");

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
        categories: guildId ? discord.listCategories(guildId) : [],
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

    let eventId = String(body.event || "").trim();
    const manualTitle = String(body.manualLabel || "").trim();
    let eventLabel = "";
    let categoryId = "";
    if (eventId === "__manual__") {
        if (!manualTitle) return error(res, 400, "no_label", "Bitte ein Event wählen oder eine Bezeichnung eingeben.");
        eventLabel = manualTitle;
        eventId = `manual-${slugify(manualTitle)}`;
    } else if (eventId === "__auto__" || !eventId) {
        const detected = detectImportDate(items);
        const { groups } = await loadEventGroups(activeGuildFor(req), { sinceSeconds: eventLookbackSince() });
        const allEvents = groups.flatMap((g) => g.events);
        const { match, ambiguous } = detected ? bestDayMatch(detected, allEvents) : { match: null, ambiguous: false };
        if (ambiguous) {
            return error(res, 409, "ambiguous", `Mehrere Events am ${formatDayDisplay(detected)} gefunden — bitte unten das passende Event auswählen.`);
        }
        if (match) {
            eventId = match.id;
            eventLabel = manualTitle || match.title || eventId;
            const g = groups.find((gr) => gr.events.includes(match));
            categoryId = g ? (g.categoryId || "") : "";
        } else {
            const label = manualTitle || (detected ? `Raid vom ${formatDayDisplay(detected)}` : "");
            if (!label) {
                return error(res, 400, "no_match", "Kein Event am erkannten Datum gefunden und kein Datum im Export erkannt — bitte Event wählen oder einen Titel eingeben.");
            }
            eventLabel = label;
            eventId = `manual-${slugify(label)}${detected ? `-${dayKey(detected)}` : ""}`;
        }
    } else {
        const { groups } = await loadEventGroups(activeGuildFor(req), { sinceSeconds: eventLookbackSince() });
        const found = groups.flatMap((g) => g.events.map((ev) => ({ ev, g }))).find((x) => x.ev.id === eventId);
        eventLabel = found ? (found.ev.title || eventId) : eventId;
        categoryId = found ? (found.g.categoryId || "") : "";
    }

    // Only where the event left a gap — see the header comment.
    if (!categoryId) categoryId = picked.id;

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

/** POST /api/history/clear — body: { event }. Deletes all loot stored for one event. */
async function clearHistoryEvent(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const removed = clearLootEvent(String(body.event || "").trim());
    ok(res, { removed });
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
    getHistoryData, getLootStats, deleteHistoryLog, importLoot, setLootCategory, clearHistoryEvent, getHistoryEvent,
    resolveCharacters, getHistoryChar,
};
