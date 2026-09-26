// What every raid drop of tbcContent.js's RAID_LOOT table is called.
//
// The loot *imports* never need this — an export either carries the name or
// enrichItemNames() looks up the handful of ids it is missing. This table
// exists for the question asked the other way round: "which items can drop in
// this raid", which the manual "Item nachtragen" picker asks for a whole raid
// at once (see web/loot/lootCatalog.js). Resolving 800 ids through Wowhead per pick
// would be slow and rude, so they are resolved once by
// `node scripts/fetch-tbc-loot-names.js` and shipped in
// config/generated/tbcLootNames.json.
//
// Entries are `[name, icon, quality]` — the same three fields Wowhead's tooltip
// endpoint returns, and exactly what the picker renders (the icon URL is built
// from `icon` by utils/loot/wowhead.js's iconUrl(), never stored twice). Names are
// English, like the exports and the loot tables. Regenerate the JSON instead
// of hand-editing it.

const RAID_ITEMS = require("./generated/tbcLootNames.json");

/** `[name, icon, quality]` for an item id, or null when the table doesn't know it. */
function itemMeta(itemId) {
    const id = Number(itemId) || 0;
    return (id && RAID_ITEMS[id]) || null;
}

/** The item's English name, or "" for an id outside the raid loot table. */
function itemName(itemId) {
    const meta = itemMeta(itemId);
    return meta ? meta[0] : "";
}

module.exports = { RAID_ITEMS, itemMeta, itemName };
