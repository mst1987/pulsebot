// The WoWSims-TBC reference data the loot council runs on: which items a caster
// can be handed (with their stats), what the BiS list for a spec looks like, and
// the ground-truth rotation to sim them with.
//
// The three tables next to this file are GENERATED — `node scripts/fetch-wowsims-data.js`
// pulls them from wowsims/tbc-new (MIT). Everything here is the read side: pure
// lookups, no I/O beyond the one require of the JSON at startup.

const fs = require("fs");
const path = require("path");

const itemData = require("./items.json");
const bisData = require("./bisSets.json");

const APL_DIR = path.join(__dirname, "apls");

/** Item id (as a number) -> the generated entry, or null. */
function item(itemId) {
    const id = Number(itemId);
    if (!Number.isFinite(id) || id <= 0) return null;
    return itemData.items[String(id)] || null;
}

/** Every equip slot an item fits, as WCL numbers them. [] for an unknown id. */
function slotsFor(itemId) {
    const it = item(itemId);
    return it ? it.slots : [];
}

/**
 * The BiS list of a spec for one tier, as `[{ id, enchant?, gems? }]` without
 * the empty slots. Falls back to the newest *earlier* tier the spec has a list
 * for — a T6 raider whose spec only has sets up to T5 is better served by the
 * T5 list than by nothing — and returns `{ items: [], tier: "" }` when the spec
 * has no list at all (every healing spec, see the script's BIS_FILES note).
 *
 * @returns {{ items: Array<{id:number, enchant?:number, gems?:number[]}>, tier: string, exact: boolean }}
 */
function bisFor(specKey, tierId) {
    const sets = bisData.sets[specKey];
    if (!sets) return { items: [], tier: "", exact: false };
    const order = ["t4", "t5", "t6", "t65"];
    const wanted = order.indexOf(String(tierId || ""));
    // An unknown tier asks for "the best there is", which is the newest set.
    const candidates = wanted < 0 ? order.slice().reverse() : order.slice(0, wanted + 1).reverse();
    for (const tier of candidates) {
        const list = sets[tier];
        if (list && list.some(Boolean)) {
            return { items: list.filter(Boolean), tier, exact: tier === tierId };
        }
    }
    return { items: [], tier: "", exact: false };
}

/** The tiers a spec actually has a BiS list for, oldest first. */
function bisTiers(specKey) {
    const sets = bisData.sets[specKey];
    return sets ? Object.keys(sets) : [];
}

/** Every spec key with a BiS list. */
function specsWithBis() {
    return Object.keys(bisData.sets);
}

/**
 * Caster items whose name matches `query`, best match first.
 *
 * Searched locally in the generated table rather than through Wowhead, for
 * three reasons: it is instant, it only ever offers items a caster can actually
 * be handed, and every hit is guaranteed to resolve to a slot and a stat block
 * — which is exactly what the "who should get this drop" question needs. An
 * item Wowhead knows and this table does not is one the council could not
 * evaluate anyway.
 *
 * Ranking: a name starting with the query beats one merely containing it, then
 * the higher item level wins, so "Zhar" finds the T6 staff and not a level-60
 * leftover of the same word.
 */
function searchItems(query, { limit = 15 } = {}) {
    const q = String(query || "").trim().toLowerCase();
    if (q.length < 2) return [];
    const hits = [];
    for (const [id, item] of Object.entries(itemData.items)) {
        const name = item.name.toLowerCase();
        const at = name.indexOf(q);
        if (at < 0) continue;
        hits.push({ id: Number(id), item, starts: at === 0 });
        // Bounded: a two-letter query matches hundreds of items, and the picker
        // shows a dozen. Collecting them all only to throw them away is work
        // nobody sees.
        if (hits.length > 400) break;
    }
    hits.sort((a, b) => (b.starts - a.starts) || (b.item.ilvl - a.item.ilvl) || a.item.name.localeCompare(b.item.name));
    return hits.slice(0, limit).map(({ id, item }) => ({
        id,
        name: item.name,
        iconUrl: item.icon ? `https://wow.zamimg.com/images/wow/icons/large/${item.icon}.jpg` : "",
        quality: item.quality,
        ilvl: item.ilvl,
    }));
}

// The rotations are read from disk on first use and kept — they are a few KB
// each and every sim of that spec needs the same one.
const aplCache = new Map();

/** The ground-truth APL of a spec as protojson, or null when none is vendored. */
function aplFor(specKey) {
    if (aplCache.has(specKey)) return aplCache.get(specKey);
    let apl = null;
    try {
        apl = JSON.parse(fs.readFileSync(path.join(APL_DIR, `${specKey}.apl.json`), "utf8"));
    } catch {
        apl = null; // spec without a vendored rotation — the caller falls back
    }
    aplCache.set(specKey, apl);
    return apl;
}

module.exports = {
    ITEM_DB_VERSION: itemData.version,
    BIS_VERSION: bisData.version,
    item, slotsFor, bisFor, bisTiers, specsWithBis, aplFor, searchItems,
};
