// Combat potions per player.
//
// The three columns the report shows (Destruction / Haste / Mana) are aggregates;
// underneath, every consumable is counted by its own type so the report can show
// *which* mana source a raider actually drank. The types themselves (spell ids,
// items, icons) are TBC data in config/data/logcheckTables.js (#747).
const { POTION_TYPES } = require("../../../config/data/logcheckTables");

/** spell id -> type, built once. */
const TYPE_BY_ID = new Map();
for (const t of POTION_TYPES) {
    for (const id of t.ids) TYPE_BY_ID.set(id, t);
}

const POTION_FILTER = `ability.id IN (${POTION_TYPES.flatMap((t) => t.ids).join(",")})`;

const GROUPS = ["destruction", "haste", "mana"];

/**
 * Per-player potion usage. One filtered casts API call for the whole raid.
 *
 * @returns {Promise<null | { players: Array, icons: object, types: Array }>}
 *   players carry the three group totals plus a `byType` map; `types` lists only
 *   the types that actually occurred, in POTION_TYPES order, for the table head.
 */
async function analyzePotions(wcl, reportId, fights) {
    const end = fights.end || 999999999999;
    let table;
    try {
        table = await wcl.getCasts(reportId, 0, end, { filter: POTION_FILTER });
    } catch {
        return null;
    }
    const icons = {};
    const usedKeys = new Set();
    const players = [];
    for (const e of (table && table.entries) || []) {
        const counts = { destruction: 0, haste: 0, mana: 0 };
        const byType = {};
        for (const ab of e.abilities || []) {
            const type = TYPE_BY_ID.get(String(ab.guid));
            if (!type) continue;
            const n = ab.total || 0;
            if (n <= 0) continue;
            counts[type.group] += n;
            byType[type.key] = (byType[type.key] || 0) + n;
            usedKeys.add(type.key);
            // keep the legacy per-group icon map the roster/player pages rely on
            if (ab.icon && !icons[type.group]) icons[type.group] = ab.icon;
        }
        const total = counts.destruction + counts.haste + counts.mana;
        if (total > 0) players.push({ name: e.name, type: e.type, ...counts, byType, total });
    }
    players.sort((a, b) => b.total - a.total);
    if (players.length === 0) return null;

    // A group with no icon yet (nothing of that group was drunk, or the log carried
    // no icon) still needs one for the column head.
    for (const g of GROUPS) {
        if (icons[g]) continue;
        const fallback = POTION_TYPES.find((t) => t.group === g && usedKeys.has(t.key))
            || POTION_TYPES.find((t) => t.group === g);
        if (fallback) icons[g] = fallback.icon;
    }

    const types = POTION_TYPES.filter((t) => usedKeys.has(t.key)).map((t) => ({
        key: t.key,
        group: t.group,
        label: t.label,
        icon: t.icon,
        itemId: t.itemId || null,
        spellId: t.spellId || null,
    }));

    return { players, icons, types };
}

/** Build a quick lookup { playerName -> {destruction,haste,mana,byType} } for detail pages. */
function potionsByName(potions) {
    const map = {};
    for (const p of (potions && potions.players) || []) {
        map[p.name] = {
            destruction: p.destruction,
            haste: p.haste,
            mana: p.mana,
            byType: p.byType || {},
        };
    }
    return map;
}

module.exports = { analyzePotions, potionsByName, POTION_TYPES, POTION_FILTER };
