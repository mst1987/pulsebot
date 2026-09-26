// What a pasted loot export would become, before anything is stored.
//
// The import dialog shows this under the text field while the admin is still
// deciding: how many items were recognised, which format, which raid the items
// come from, which Raid-Helper event the export's own date points at and how
// many of the rows are already in that event. The same pieces the import itself
// uses (parseLoot, deriveContent, bestDayMatch, the store's dedup key), so the
// preview can never promise something the import then does differently.
//
// Pure apart from reading the loot store; the route loads the events.
const { parseLoot, detectImportDate, LootParseError, EH_FORMAT } = require("../../utils/loot/lootImport");
const { deriveContent } = require("./lootSessionContent");
const { bestDayMatch } = require("./lootEventMatch");
const { eventStartMs } = require("../logEventMatch");
const { listAll } = require("../../stores/lootStore");

const FORMAT_LABELS = { rclc: "RCLootcouncil", gargul: "Gargul", eventhelper: "EventHelper-Addon" };

/** Which parser parseLoot() picks for this text — mirrors its auto-detection. */
function detectFormat(text, tool = "auto") {
    const t = String(tool || "auto").toLowerCase();
    if (FORMAT_LABELS[t]) return t;
    const trimmed = String(text || "").trim();
    if (trimmed.startsWith("{")) return trimmed.includes(`"${EH_FORMAT}"`) ? "eventhelper" : "rclc";
    if (trimmed.startsWith("[")) return "rclc";
    return "gargul";
}

const slimEvent = (ev) => ({
    id: String(ev.id || ""),
    title: ev.title || "",
    startTime: eventStartMs(ev),
});

/**
 * @param {{ data: string, tool?: string, event?: string, events?: object[] }} input
 *   `event` is what the dialog currently has selected (an event id, "__auto__"
 *   or "__manual__"); `events` the Raid-Helper events the date is matched against.
 * @returns {{ ok: true, count, format, formatLabel, detectedAt, content, match, targetEventId, duplicates }
 *          | { ok: false, error: string }}
 */
function previewImport({ data, tool = "auto", event = "__auto__", events = [] } = {}) {
    const text = String(data || "").trim();
    if (!text) return { ok: false, error: "Kein Loot-Text eingefügt." };
    let items;
    try {
        items = parseLoot(text, tool);
    } catch (e) {
        return { ok: false, error: e instanceof LootParseError ? e.message : "Export konnte nicht gelesen werden." };
    }
    if (!items.length) return { ok: false, error: "Keine Loot-Einträge im Export gefunden." };

    const format = detectFormat(text, tool);
    const detectedAt = detectImportDate(items);
    const derived = deriveContent(items);
    const { match, candidates, ambiguous } = detectedAt
        ? bestDayMatch(detectedAt, events)
        : { match: null, candidates: [], ambiguous: false };

    // The event the rows would land in, as far as it is known before importing:
    // an explicit pick, else the date match. A hand-typed title has no stored
    // rows to collide with yet.
    const picked = String(event || "").trim();
    const targetEventId = picked && picked !== "__auto__" && picked !== "__manual__"
        ? picked
        : (picked === "__manual__" ? "" : (match ? String(match.id) : ""));

    // Same key as lootStore.addImport: event + source + the addon's own row id.
    // Rows repeated inside the export itself count too — the import skips them.
    let duplicates = 0;
    if (targetEventId) {
        const seen = new Set(listAll()
            .filter((it) => it.eventId === targetEventId)
            .map((it) => `${it.source}::${it.rawId}`));
        for (const it of items) {
            const key = `${it.source}::${it.rawId}`;
            if (seen.has(key)) duplicates += 1;
            else seen.add(key);
        }
    }

    return {
        ok: true,
        count: items.length,
        format,
        formatLabel: FORMAT_LABELS[format],
        detectedAt: detectedAt || 0,
        content: { contentIds: derived.contentIds, label: derived.label, matched: derived.matched },
        match: {
            ambiguous,
            suggested: match ? slimEvent(match) : null,
            candidates: candidates.map(slimEvent),
        },
        targetEventId,
        duplicates,
    };
}

module.exports = { previewImport, detectFormat, FORMAT_LABELS };
