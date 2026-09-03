// Why a raider got an item, normalized across the two loot addons.
//
// RCLootcouncil lets every guild write its own response buttons ("BiS",
// "Upgrade", "Minor Upgrade", "Off-Spec", "Entzaubern", …) and only ships the
// chosen label as free text; Gargul knows a single offspec flag and nothing
// else. Both are useless for grouping as they stand — "Off-Spec", "OS" and
// "Zweitspec" are the same reason spelled three ways.
//
// So every loot row is mapped onto one of the REASONS below, which is what the
// overview groups and colours by. The raw response text is never thrown away:
// it travels alongside as `response` and is shown on hover, so a guild-specific
// label stays visible even though it was bucketed.

// Ordered from "this was the raider's main gain" to "nobody really wanted it".
// `tone` is the colour bucket the client renders (see .rbadge-* in index.css) —
// green for a mainspec gain, fading through yellow/orange for the weaker
// reasons, red for PvP, grey for the leftovers.
const REASONS = [
    { id: "bis", label: "BiS", tone: "bis" },
    { id: "mainspec", label: "Mainspec", tone: "mainspec" },
    { id: "upgrade", label: "Upgrade", tone: "upgrade" },
    { id: "minor", label: "Kleines Upgrade", tone: "minor" },
    { id: "offspec", label: "Offspec", tone: "offspec" },
    { id: "pvp", label: "PvP", tone: "pvp" },
    { id: "greed", label: "Greed", tone: "greed" },
    { id: "disenchant", label: "Entzaubert", tone: "disenchant" },
    { id: "bank", label: "Bank", tone: "bank" },
    { id: "other", label: "Sonstiges", tone: "other" },
];

const REASON_BY_ID = new Map(REASONS.map((r, i) => [r.id, { ...r, order: i }]));

/**
 * The reasons that count as "this raider was actually given something".
 *
 * A loot council weighs who is owed a drop, and for that only real gear counts:
 * an item taken for the off-spec, sharded or put in the bank did nothing for the
 * raider's main set. Counting those would make somebody who politely took three
 * shards look better served than a raider who got one real upgrade — precisely
 * backwards, and it is the fairness half of the ranking that would be wrong.
 *
 * `other` is deliberately in: an unrecognised response is far more often a
 * guild's own wording for a mainspec roll than it is a shard, and treating a
 * real award as nothing is the worse of the two mistakes.
 */
const COUNTING_REASONS = new Set(["bis", "mainspec", "upgrade", "minor", "other"]);

/** Whether an award counts towards what a raider has already been given. */
function countsAsLoot(reason) {
    return COUNTING_REASONS.has(String(reason || "other"));
}

// Matched in order — the first hit wins, so the more specific pattern has to
// come first: "Minor Upgrade" is a minor upgrade and not an upgrade, and an
// "Off-Spec Upgrade" is an offspec roll, not an upgrade.
//
// German and English spellings are both listed because RCLootcouncil forwards
// whatever the guild typed into its response buttons, and this guild's raiders
// run German clients.
const PATTERNS = [
    { id: "disenchant", re: /disenchant|entzauber|\bshard(ing)?\b|\bde\b/i },
    { id: "bank", re: /bank|gildenbank/i },
    { id: "pvp", re: /\bpvp\b|arena|resil/i },
    { id: "offspec", re: /off.?spec|\bos\b|zweit.?spec|neben.?spec|second.?spec|dual.?spec/i },
    { id: "bis", re: /\bbis\b|best.?in.?slot/i },
    { id: "minor", re: /minor|klein|side.?grade|leichte/i },
    { id: "upgrade", re: /upgrade|major|verbesserung|aufwert/i },
    { id: "mainspec", re: /main.?spec|haupt.?spec|\bms\b|\bneed\b|bedarf/i },
    { id: "greed", re: /greed|gier|free|kostenlos|\bfun\b|transmog|\bmog\b|twink|\balt\b|\brest/i },
    // Handed out anyway despite a pass/autopass response — rare, but it happens
    // when the master looter awards by hand. Not a reason of its own.
    { id: "other", re: /auto.?pass|^\s*pass\s*$|verzicht/i },
];

/**
 * The reason id for one normalized loot item (see utils/lootImport).
 * The response text decides; when it says nothing this file recognises, the
 * offspec flag still separates main from off spec. A row carrying neither is
 * reported as "other" rather than assumed to be a mainspec win — the breakdown
 * is only useful if it doesn't invent reasons.
 * @param {object} item
 * @returns {string} one of REASONS' ids
 */
function reasonIdFor(item) {
    const it = item || {};
    const text = String(it.response || "").trim();
    if (text) {
        const hit = PATTERNS.find((p) => p.re.test(text));
        if (hit) return hit.id;
    }
    return it.offspec ? "offspec" : "other";
}

/** Catalog entry for a reason id ({ id, label, tone, order }), never null. */
function reasonMeta(reasonId) {
    return REASON_BY_ID.get(String(reasonId || "")) || REASON_BY_ID.get("other");
}

/**
 * The reason fields every loot row carries once it leaves the store, so no
 * consumer has to re-derive them: `reason` (grouping key), `reasonLabel` and
 * `reasonTone` (display), while the untouched `response` stays on the item.
 */
function describeReason(item) {
    const meta = reasonMeta(reasonIdFor(item));
    return { reason: meta.id, reasonLabel: meta.label, reasonTone: meta.tone };
}

/** REASONS in display order, as plain catalog objects for the client. */
function reasonCatalog() {
    return REASONS.map((r, i) => ({ ...r, order: i }));
}

module.exports = {
    REASONS, reasonIdFor, reasonMeta, describeReason, reasonCatalog,
    COUNTING_REASONS, countsAsLoot,
};
