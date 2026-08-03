const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { characterKey, enrichItemNames, needsLookup } = require("../utils/lootImport");
const { describeReason } = require("../utils/lootReasons");
const { contentForLoot, tokenTier } = require("../config/tbcContent");

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

/**
 * What is derived from a stored row rather than stored on it, added on every
 * read so no consumer has to redo it:
 *   - the award reason bucket (see utils/lootReasons) — the raw `response` text
 *     stays untouched next to it,
 *   - the raid the item comes from, resolved by item id and therefore also
 *     available for Gargul rows, which carry no instance at all
 *     (see config/tbcContent),
 *   - `boss`, filled in from the same table when the export didn't name one,
 *   - `tokenTier`, set on the tier-set tokens ("t4"/"t5"/"t6"), else "".
 * Derived on read and not at import time on purpose: the content table grows
 * with every patch, and old imports have to profit from that without a
 * re-import.
 */
function decorate(it) {
    const { contentId, boss } = contentForLoot(it);
    return { ...it, ...describeReason(it), contentId, boss, tokenTier: tokenTier(it.itemName) };
}

const byAwardedDesc = (a, b) => (b.awardedAt || 0) - (a.awardedAt || 0);

/** Every stored loot row, newest award first. */
function listAll() {
    return readAll().map(decorate).sort(byAwardedDesc);
}

/** All loot for one event, newest award first. */
function listByEvent(eventId) {
    const id = String(eventId || "").trim();
    return readAll()
        .filter((it) => it.eventId === id)
        .map(decorate)
        .sort(byAwardedDesc);
}

/** All loot a character received (matched case-insensitively, realm-independent). */
function listByCharacter(character) {
    const key = characterKey(character);
    if (!key) return [];
    return readAll()
        .filter((it) => it.characterKey === key)
        .map(decorate)
        .sort(byAwardedDesc);
}

/**
 * Distinct events that have loot, with a count and the latest import time.
 * `categoryId` is the raid category the bucket is filed under — the first
 * non-empty one of its rows, same rule as `label`. It is "" for loot imported
 * without a Raid-Helper event, which is what setEventCategory() fixes.
 */
function eventsWithLoot() {
    const byEvent = new Map();
    for (const it of readAll()) {
        if (!byEvent.has(it.eventId)) {
            byEvent.set(it.eventId, { eventId: it.eventId, label: "", categoryId: "", count: 0, importedAt: 0, awardedAt: 0, sources: new Set() });
        }
        const e = byEvent.get(it.eventId);
        e.count += 1;
        e.importedAt = Math.max(e.importedAt, it.importedAt || 0);
        e.awardedAt = Math.max(e.awardedAt, it.awardedAt || 0);
        if (it.eventLabel && !e.label) e.label = it.eventLabel;
        if (it.categoryId && !e.categoryId) e.categoryId = it.categoryId;
        if (it.source) e.sources.add(it.source);
    }
    return [...byEvent.values()]
        .map((e) => ({ ...e, sources: [...e.sources] }))
        .sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0));
}

// The per-item fields the "Charaktere" tab's hover preview needs: enough to
// render icon + name + the award reason ("BiS", "Mainspec", …) without pulling
// the whole stored row (raw export payload, importer bookkeeping, …) into the
// /api/history response for every character.
function charLootPreview(it) {
    return {
        itemId: it.itemId || 0,
        itemName: it.itemName || "",
        itemIconUrl: it.itemIconUrl || "",
        // null (not 0) when Wowhead never resolved it — 0 is "poor" quality.
        itemQuality: typeof it.itemQuality === "number" ? it.itemQuality : null,
        itemLink: it.itemLink || "",
        response: it.response || "",
        offspec: !!it.offspec,
        reason: it.reason || "",
        reasonLabel: it.reasonLabel || "",
        reasonTone: it.reasonTone || "",
        contentId: it.contentId || "",
        categoryId: it.categoryId || "",
        eventId: it.eventId || "",
        eventLabel: it.eventLabel || "",
        awardedAt: it.awardedAt || 0,
    };
}

/**
 * Distinct characters that received loot, with a count, most loot first, plus
 * the distinct raid categories (Discord category id, e.g. "Montagsraid",
 * "Pug") each got loot in — the join key for grouping/filtering the
 * "Charaktere" tab by raid type. Category names are resolved from live
 * Discord state by the caller (see apiRoutes/history.js), same as
 * discord.listCategories() elsewhere — this store only ever sees ids.
 *
 * `items` carries each character's loot (newest award first) in the trimmed
 * shape above, so the tab can show what someone actually won on hover instead
 * of only how many pieces — no extra round trip per row.
 */
function characters() {
    const byChar = new Map();
    for (const it of listAll()) {
        const key = it.characterKey;
        if (!key) continue;
        if (!byChar.has(key)) byChar.set(key, { key, character: it.character, realm: it.realm || "", count: 0, categoryIds: new Set(), items: [] });
        const c = byChar.get(key);
        c.count += 1;
        c.items.push(charLootPreview(it));
        if (it.categoryId) c.categoryIds.add(it.categoryId);
    }
    return [...byChar.values()]
        .map((c) => ({
            ...c,
            categoryIds: [...c.categoryIds],
            items: c.items.sort((a, b) => (b.awardedAt || 0) - (a.awardedAt || 0)),
        }))
        .sort((a, b) => b.count - a.count || a.character.localeCompare(b.character));
}

/**
 * File every row of one loot bucket under a raid category (Discord category id),
 * or clear it again with an empty id. Returns how many rows changed.
 *
 * At import time the category comes from the Raid-Helper event's Discord
 * category — loot imported *without* an event (a manual bucket, see
 * apiRoutes/history.js) has none and is therefore absent from every
 * category-grouped overview ("Charaktere", "Loot-Gründe"). This is how such a
 * bucket gets assigned afterwards. Stored on the rows rather than derived,
 * because there is no event to derive it from.
 */
function setEventCategory(eventId, categoryId) {
    const id = String(eventId || "").trim();
    if (!id) return 0;
    const category = String(categoryId || "").trim();
    const all = readAll();
    let updated = 0;
    for (const it of all) {
        if (it.eventId !== id || (it.categoryId || "") === category) continue;
        it.categoryId = category;
        updated += 1;
    }
    if (updated) writeAll(all);
    return updated;
}

/**
 * Remove single loot rows by their stored id. Returns how many were removed.
 *
 * The counterpart to clearEvent() for the everyday case of one wrong row — an
 * item the addon logged twice, one awarded to the wrong raider, a test entry —
 * where dropping the whole import and redoing it is far too coarse. A deletion
 * only holds until the *same* export is imported again: addImport() dedupes
 * against what is stored, and a removed row is no longer there to dedupe
 * against, so it comes back.
 */
function removeItems(ids) {
    const wanted = new Set(
        (Array.isArray(ids) ? ids : [ids]).map((id) => String(id || "").trim()).filter(Boolean),
    );
    if (!wanted.size) return 0;
    const all = readAll();
    const next = all.filter((it) => !wanted.has(it.id));
    const removed = all.length - next.length;
    if (removed) writeAll(next);
    return removed;
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

// What repairItemNames() can fill in, as one comparable string — a row counts
// as repaired when any of the three changed.
const itemMetaKey = (it) => `${it.itemName}|${it.itemIconUrl}|${it.itemQuality}`;

/**
 * Backfill itemName/itemIconUrl/itemQuality on stored rows that never got them —
 * records imported before icon (or quality) enrichment existed still show as
 * "Item <id>", or in the plain text colour instead of the item's own. Runs the
 * same Wowhead lookup as import-time enrichment and persists what it resolves,
 * so each missing id is fixed once instead of on every page view. Best-effort:
 * ids Wowhead doesn't know simply stay as they are. Returns how many rows gained
 * a name, an icon or a quality.
 */
async function repairItemNames() {
    const all = readAll();
    const missing = all.filter(needsLookup);
    if (!missing.length) return 0;
    const before = missing.map(itemMetaKey);
    await enrichItemNames(missing); // mutates the rows in place
    const repaired = missing.filter((it, i) => itemMetaKey(it) !== before[i]).length;
    if (repaired) writeAll(all);
    return repaired;
}

module.exports = {
    addImport, listAll, listByEvent, listByCharacter, eventsWithLoot, characters, setEventCategory, removeItems, clearEvent, repairItemNames,
    // Exported for the addon inbox, which shows loot that is not stored yet:
    // running it through the same decoration makes the preview look exactly like
    // the history it is about to become (reason badge, raid, tier).
    charLootPreview, decorate, LOOT_FILE,
};
