const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const { loadEventGroups, eventLookbackSince } = require("../raidEventGroups");
const { loadRecentEvents, annotateUpcomingExtras } = require("../dashboardData");
const { getConfig, saveConfig } = require("../settingsStore");
const { listLogs, deleteLog } = require("../logStore");
const {
    addImport: addLootImport, listByEvent: listLootByEvent, eventsWithLoot, clearEvent: clearLootEvent,
} = require("../lootStore");
const { rememberFromLoot: rememberClassesFromLoot } = require("../characterInfo");
const { parseLoot, detectImportDate, LootParseError } = require("../../utils/lootImport");
const { bestDayMatch, formatDayDisplay, dayKey } = require("../lootEventMatch");
const discord = require("../discord");

// A manually-labelled loot bucket's synthetic event id: "manual-<slug>".
const slugify = (label) => String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

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
        logs: listLogs(),
        categories: guildId ? discord.listCategories(guildId) : [],
        categoryLootTool: cfg.categoryLootTool || {},
        activeGuildId: guildId,
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
 * POST /api/history/import — body: { data, tool, event, manualLabel }.
 * `event` is a real event id, "__auto__" (match by the export's own date) or
 * "__manual__" (a hand-typed label, no Raid-Helper event involved).
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

    const { added, skipped } = addLootImport(eventId, items, { categoryId, eventLabel });
    // RCLootcouncil exports carry the raider's class — keep it right away, so the
    // character list only has to fall back to the logs for what is still missing.
    rememberClassesFromLoot(items);
    if (categoryId && (tool === "gargul" || tool === "rclc")) {
        saveConfig({ categoryLootTool: { [categoryId]: tool } });
    }
    ok(res, { eventId, eventLabel, added, skipped }, 201);
}

/** POST /api/history/category-tool — body: { categoryId, tool }. */
async function saveCategoryLootTool(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const categoryId = String(body.categoryId || "").trim();
    const tool = String(body.tool || "").trim();
    if (!categoryId) return error(res, 400, "no_category", "Keine Kategorie angegeben.");
    saveConfig({ categoryLootTool: { [categoryId]: (tool === "gargul" || tool === "rclc") ? tool : "" } });
    ok(res, { categoryId, tool });
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
function getHistoryEvent(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const eventId = url.searchParams.get("event") || "";
    const items = listLootByEvent(eventId);
    const label = (items[0] && items[0].eventLabel) || eventId;
    ok(res, { eventId, label, items });
}

module.exports = {
    getHistoryData, deleteHistoryLog, importLoot, saveCategoryLootTool, clearHistoryEvent, getHistoryEvent,
};
