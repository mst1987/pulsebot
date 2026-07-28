const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { characterKey, enrichItemNames } = require("../utils/lootImport");

// Imported loot lives as a single JSON file next to the other editable settings.
// Each entry is a normalized loot item (see utils/lootImport) tagged with the
// event it was awarded in, so the event-history and per-character pages can query
// it. Imports dedupe on (eventId, source, rawId) so re-importing the same log is
// idempotent.
const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const LOOT_FILE = path.join(SETTINGS_DIR, "loot.json");

function ensureDir() {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
}

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(LOOT_FILE, "utf8"));
        return Array.isArray(data.items) ? data.items : [];
    } catch {
        return [];
    }
}

function writeAll(items) {
    ensureDir();
    fs.writeFileSync(LOOT_FILE, JSON.stringify({ items }, null, 2));
}

function newId() {
    return crypto.randomBytes(6).toString("hex");
}

function dedupKey(item) {
    return `${item.eventId}::${item.source}::${item.rawId}`;
}

/**
 * Add a batch of normalized loot items to an event. Deduplicates against loot
 * already stored for that event (same source + rawId), so a re-import only adds
 * genuinely new rows. Returns { added, skipped }.
 */
function addImport(eventId, items, meta = {}) {
    const id = String(eventId || "").trim();
    if (!id || !Array.isArray(items) || !items.length) return { added: 0, skipped: 0 };
    const all = readAll();
    const seen = new Set(all.filter((it) => it.eventId === id).map(dedupKey));
    const now = Date.now();
    let added = 0;
    let skipped = 0;
    for (const item of items) {
        const enriched = {
            ...item,
            id: newId(),
            eventId: id,
            eventLabel: meta.eventLabel || "",
            categoryId: meta.categoryId || "",
            importedAt: now,
        };
        const key = dedupKey(enriched);
        if (seen.has(key)) { skipped += 1; continue; }
        seen.add(key);
        all.push(enriched);
        added += 1;
    }
    if (added) writeAll(all);
    return { added, skipped };
}

/** All loot for one event, newest award first. */
function listByEvent(eventId) {
    const id = String(eventId || "").trim();
    return readAll()
        .filter((it) => it.eventId === id)
        .sort((a, b) => (b.awardedAt || 0) - (a.awardedAt || 0));
}

/** All loot a character received (matched case-insensitively, realm-independent). */
function listByCharacter(character) {
    const key = characterKey(character);
    if (!key) return [];
    return readAll()
        .filter((it) => it.characterKey === key)
        .sort((a, b) => (b.awardedAt || 0) - (a.awardedAt || 0));
}

/** Distinct events that have loot, with a count and the latest import time. */
function eventsWithLoot() {
    const byEvent = new Map();
    for (const it of readAll()) {
        if (!byEvent.has(it.eventId)) {
            byEvent.set(it.eventId, { eventId: it.eventId, label: "", count: 0, importedAt: 0, awardedAt: 0, sources: new Set() });
        }
        const e = byEvent.get(it.eventId);
        e.count += 1;
        e.importedAt = Math.max(e.importedAt, it.importedAt || 0);
        e.awardedAt = Math.max(e.awardedAt, it.awardedAt || 0);
        if (it.eventLabel && !e.label) e.label = it.eventLabel;
        if (it.source) e.sources.add(it.source);
    }
    return [...byEvent.values()]
        .map((e) => ({ ...e, sources: [...e.sources] }))
        .sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0));
}

/**
 * Distinct characters that received loot, with a count, most loot first, plus
 * the distinct raid categories (Discord category id, e.g. "Montagsraid",
 * "Pug") each got loot in — the join key for grouping/filtering the
 * "Charaktere" tab by raid type. Category names are resolved from live
 * Discord state by the caller (see apiRoutes/history.js), same as
 * discord.listCategories() elsewhere — this store only ever sees ids.
 */
function characters() {
    const byChar = new Map();
    for (const it of readAll()) {
        const key = it.characterKey;
        if (!key) continue;
        if (!byChar.has(key)) byChar.set(key, { key, character: it.character, realm: it.realm || "", count: 0, categoryIds: new Set() });
        const c = byChar.get(key);
        c.count += 1;
        if (it.categoryId) c.categoryIds.add(it.categoryId);
    }
    return [...byChar.values()]
        .map((c) => ({ ...c, categoryIds: [...c.categoryIds] }))
        .sort((a, b) => b.count - a.count || a.character.localeCompare(b.character));
}

/** Remove all loot stored for an event. Returns how many rows were removed. */
function clearEvent(eventId) {
    const id = String(eventId || "").trim();
    const all = readAll();
    const next = all.filter((it) => it.eventId !== id);
    const removed = all.length - next.length;
    if (removed) writeAll(next);
    return removed;
}

/**
 * Backfill itemName/itemIconUrl on stored rows that never got them — records
 * imported before icon enrichment existed still show as "Item <id>". Runs the
 * same Wowhead lookup as import-time enrichment and persists what it resolves,
 * so each missing id is fixed once instead of on every page view. Best-effort:
 * ids Wowhead doesn't know simply stay as they are. Returns how many rows
 * gained a name or icon.
 */
async function repairItemNames() {
    const all = readAll();
    const missing = all.filter((it) => it.itemId && (!it.itemName || !it.itemIconUrl));
    if (!missing.length) return 0;
    await enrichItemNames(missing); // mutates the rows in place
    const repaired = missing.filter((it) => it.itemName && it.itemIconUrl).length;
    if (repaired) writeAll(all);
    return repaired;
}

module.exports = {
    addImport, listByEvent, listByCharacter, eventsWithLoot, characters, clearEvent, repairItemNames, LOOT_FILE,
};
