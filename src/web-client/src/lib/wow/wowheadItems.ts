// Wowhead item links for the SPA. TBC Anniversary re-issued the Brewfest loot
// (item level 141) under new ids that Wowhead's database does not know yet —
// the tooltip widget (power.js) logs a 404 for each and shows nothing. Links go
// to the original item instead: same name, icon and slot, only the item level
// differs. A copy of the server's table (src/config/wowheadItemAliases.js),
// held equal by test/config/wowheadItemAliases.test.js.
const WOWHEAD_ITEM_ALIASES: Record<number, number> = {
    281893: 37128, // Balebrew Charm
    281895: 37127, // Brightbrew Charm
    281903: 37597, // Direbrew's Shanker
    281739: 38287, // Empty Mug of Direbrew
    281748: 38288, // Direbrew Hops
    281743: 38289, // Coren's Lucky Coin
    281735: 38290, // Dark Iron Smoking Pipe
};

/** The id Wowhead knows an item by — the original for an Anniversary re-issue. */
export function wowheadItemId(itemId: number): number {
    return WOWHEAD_ITEM_ALIASES[itemId] || itemId;
}

/**
 * The Wowhead path of what was stored before game versions had settings (#542):
 * TBC. A page that knows its version passes that version's path instead (the
 * server sends it as `wowheadPath`, lib/settings/versionLinks.ts).
 */
export const LEGACY_WOWHEAD_PATH = "tbc";

/**
 * The Wowhead page of an item in a version's Wowhead path, with optional query
 * parameters (ench, gems). "" without a path (a version without Wowhead
 * settings) or without an item — the caller leaves the link out.
 */
export function wowheadItemUrl(itemId: number, params: string[] = [], path: string = LEGACY_WOWHEAD_PATH): string {
    if (!path || !itemId) return "";
    return `https://www.wowhead.com/${path}/item=${wowheadItemId(itemId)}${params.length ? `?${params.join("&")}` : ""}`;
}
