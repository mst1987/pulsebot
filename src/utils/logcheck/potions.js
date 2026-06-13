// Damage/utility potion spell GUIDs grouped by category.
const POTION_TYPE = {
    28508: "destruction", // Destruction Potion
    28507: "haste",       // Haste Potion
    28499: "mana",        // Super Mana Potion
    38929: "mana",        // Fel Mana Potion
    11903: "mana",        // Major Mana Potion
    43186: "mana",        // Runic Mana Potion (fresh)
};
const POTION_FILTER = "ability.id IN (28508,28507,28499,38929,11903,43186)";

/**
 * Per-player potion usage (Destruction / Haste / Mana counts).
 * One filtered casts API call for the whole raid.
 *
 * @returns {Promise<null | { players: Array, icons: object }>}
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
    const players = [];
    for (const e of (table && table.entries) || []) {
        const counts = { destruction: 0, haste: 0, mana: 0 };
        for (const ab of e.abilities || []) {
            const cat = POTION_TYPE[String(ab.guid)];
            if (!cat) continue;
            counts[cat] += ab.total || 0;
            if (ab.icon && !icons[cat]) icons[cat] = ab.icon;
        }
        const total = counts.destruction + counts.haste + counts.mana;
        if (total > 0) players.push({ name: e.name, type: e.type, ...counts, total });
    }
    players.sort((a, b) => b.total - a.total);
    return players.length ? { players, icons } : null;
}

/** Build a quick lookup { playerName -> {destruction,haste,mana} } for detail pages. */
function potionsByName(potions) {
    const map = {};
    for (const p of (potions && potions.players) || []) {
        map[p.name] = { destruction: p.destruction, haste: p.haste, mana: p.mana };
    }
    return map;
}

module.exports = { analyzePotions, potionsByName };
