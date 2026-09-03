// Where a BiS list comes from — the one place that answers it.
//
// Two sources, because neither covers the raid alone:
//
//   - WoWSims-TBC (config/wowsims) for everyone it simulates. Those lists are
//     sim results and carry the whole loadout: item, enchant and gems.
//   - Wowhead's written BiS guides (config/wowhead) for the five healing specs,
//     which WoWSims ships as empty placeholders. Those carry items only.
//
// WoWSims wins wherever it has something, so a spec never silently swaps from a
// simulated list to a written one. The difference is not hidden either: every
// answer says which source it came from, and the page labels a Wowhead list as
// what it is — a recommendation without gems or enchants.

const wowsims = require("./wowsims");
const wowhead = require("./wowhead/bisSets.json");

const TIER_ORDER = ["t4", "t5", "t6", "t65"];

const SOURCE_LABEL = {
    wowsims: "WoWSims",
    wowhead: "Wowhead",
};

/**
 * One set out of a `{ tier: [items] }` block, with the same fallback rule the
 * WoWSims reader uses: the newest *earlier* tier, never a later one. A T6
 * raider is better served by the T5 list than by nothing, but showing them a
 * Sunwell list would make them look far from BiS for gear that does not drop.
 */
function pick(sets, tierId) {
    if (!sets) return { items: [], tier: "", exact: false };
    const wanted = TIER_ORDER.indexOf(String(tierId || ""));
    const candidates = wanted < 0 ? TIER_ORDER.slice().reverse() : TIER_ORDER.slice(0, wanted + 1).reverse();
    for (const tier of candidates) {
        const list = sets[tier];
        if (list && list.some(Boolean)) {
            return { items: list.filter(Boolean), tier, exact: tier === tierId };
        }
    }
    return { items: [], tier: "", exact: false };
}

/**
 * The BiS list of a spec for one tier.
 *
 * @returns {{ items: Array<{id:number, enchant?:number, gems?:number[]}>,
 *            tier: string, exact: boolean, source: string, sourceLabel: string }}
 *          `source` is "" exactly when there is no list at all.
 */
function bisFor(specKey, tierId) {
    const own = wowsims.bisFor(specKey, tierId);
    if (own.items.length) return { ...own, source: "wowsims", sourceLabel: SOURCE_LABEL.wowsims };
    const written = pick((wowhead.sets || {})[specKey], tierId);
    if (written.items.length) return { ...written, source: "wowhead", sourceLabel: SOURCE_LABEL.wowhead };
    return { items: [], tier: "", exact: false, source: "", sourceLabel: "" };
}

/** The tiers a spec has a list for, whichever source it comes from. */
function bisTiers(specKey) {
    const own = wowsims.bisTiers(specKey);
    if (own.length) return own;
    return Object.keys((wowhead.sets || {})[specKey] || {});
}

/** Every spec key with a list, WoWSims' first. */
function specsWithBis() {
    return [...new Set([...wowsims.specsWithBis(), ...Object.keys(wowhead.sets || {})])];
}

/** Which source a spec's lists come from, without resolving a tier. */
function sourceFor(specKey) {
    if (wowsims.bisTiers(specKey).length) return "wowsims";
    return (wowhead.sets || {})[specKey] ? "wowhead" : "";
}

module.exports = {
    bisFor, bisTiers, specsWithBis, sourceFor,
    WOWHEAD_FETCHED_AT: wowhead.fetchedAt || "",
    SOURCE_LABEL,
};
