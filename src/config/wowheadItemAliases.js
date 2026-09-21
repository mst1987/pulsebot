// TBC Anniversary re-issued the Brewfest loot (item level 141) under new ids
// that Wowhead's database does not know yet: their tooltips answer 404 and the
// item page redirects to "not found". Links and lookups go to the original
// item instead — same name, icon and slot; only the item level differs.
// Source: wowsims/tbc-new#530, which paired each id by name, slot and icon.
// The client keeps a copy (src/web-client/src/lib/wowheadItems.ts), held equal
// by test/config/wowheadItemAliases.test.js. Drop an entry once Wowhead knows
// the new id.
const WOWHEAD_ITEM_ALIASES = Object.freeze({
    281893: 37128, // Balebrew Charm
    281895: 37127, // Brightbrew Charm
    281903: 37597, // Direbrew's Shanker
    281739: 38287, // Empty Mug of Direbrew
    281748: 38288, // Direbrew Hops
    281743: 38289, // Coren's Lucky Coin
    281735: 38290, // Dark Iron Smoking Pipe
});

/** The id Wowhead knows an item by — the original for an Anniversary re-issue. */
function wowheadItemId(itemId) {
    return WOWHEAD_ITEM_ALIASES[Number(itemId)] || itemId;
}

/**
 * Point a stored Wowhead item link at the id Wowhead knows. Loot rows keep the
 * link they were imported with, so rows from before an alias existed still
 * carry the re-issue's id; any other link passes through untouched.
 */
function wowheadLink(link) {
    return String(link || "").replace(/(\/item=)(\d+)/, (m, pre, id) => pre + wowheadItemId(id));
}

module.exports = { WOWHEAD_ITEM_ALIASES, wowheadItemId, wowheadLink };
