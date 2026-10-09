// What one awarded item counts as on the loot council ("Loot-Punkte", #668).
//
// Not every item is worth the same to a council: a strong trinket or a BiS
// weapon should weigh more than a set piece, and an item that drops all the
// time less than one that drops once a lockout. Every award therefore counts
// with a weight instead of 1 — in the loot share and in the drought alike
// (web/loot/lootCouncil.js). The weight comes from the item's *class*, each with
// a default the council can change (stores/councilWeightsStore.js), or from a
// per-item exception.
//
// Which class an item is in — the first rule that applies wins:
//   1. an exception for exactly this item id (the council's word beats every rule)
//   2. "frequent"  — drops from two or more bosses, from trash or from Zul'Aman's
//                    timed chest (config/generated/tbcRaidLoot.json). First on
//                    purpose: an item that drops all the time is cheap whatever
//                    slot it goes in — a trash weapon is no BiS weapon from a
//                    boss. A trash item that is worth more gets an exception.
//   3. "trinket"   — goes in a trinket slot (WCL slots 12/13 in the item table;
//                    in-game numbering 13/14)
//   4. "bisWeapon" — a weapon (the item carries a damage block: one-hand, two-
//                    hand, off-hand weapon, wand, bow, gun) on the BiS list of
//                    the raider it went to
//   5. "weapon"    — any other weapon. Shields, held-in-off-hand items and
//                    relics carry no damage and are not weapons.
//   6. "set"       — a tier token ("Helm of the Forgotten Conqueror", matched by
//                    name with config/tbcContent.js's tokenTier(), English and
//                    German) or a piece of an item set (`setName` in the
//                    generated WoWSims table)
//   7. "normal"    — everything else, including every item no table knows.
//
// Whether a weapon is BiS depends on who received it, so the class is resolved
// per award with that raider's BiS ids. Everything else about an item is fixed
// and computed once per id (itemFacts).
const wowsims = require("../../config/wowsims");
const { RAID_LOOT, NON_BOSSES, tokenTier } = require("../../config/tbcContent");
const { itemName: lootTableName } = require("../../config/tbcLootNames");

const TRINKET_SLOTS = new Set([12, 13]);

// item id -> in how many loot buckets (bosses, trash, the timed chest) it is
// listed, and whether one of them is not a boss. Built once.
const DROP_SOURCES = new Map();
for (const byBoss of Object.values(RAID_LOOT)) {
    for (const [boss, ids] of Object.entries(byBoss)) {
        const notBoss = NON_BOSSES.includes(boss);
        for (const id of ids) {
            const entry = DROP_SOURCES.get(id) || { count: 0, notBoss: false };
            entry.count += 1;
            entry.notBoss = entry.notBoss || notBoss;
            DROP_SOURCES.set(id, entry);
        }
    }
}

const factsCache = new Map();

/**
 * What is fixed about an item, whoever receives it: { trinket, weapon, set,
 * frequent, name }. `name` is a fallback for items the tables do not know
 * (a loot row's own name), used for the tier-token match only.
 */
function itemFacts(itemId, name = "") {
    const id = Number(itemId) || 0;
    const cacheKey = `${id}|${id ? "" : name}`;
    if (factsCache.has(cacheKey)) return factsCache.get(cacheKey);
    const item = id ? wowsims.item(id) : null;
    const knownName = (item && item.name) || lootTableName(id) || String(name || "");
    const drops = DROP_SOURCES.get(id);
    const facts = {
        trinket: !!(item && (item.slots || []).some((s) => TRINKET_SLOTS.has(Number(s)))),
        weapon: !!(item && item.weapon),
        set: !!((item && item.setName) || tokenTier(knownName) || tokenTier(name)),
        frequent: !!(drops && (drops.count >= 2 || drops.notBoss)),
        name: knownName,
    };
    factsCache.set(cacheKey, facts);
    return facts;
}

/**
 * The class of one award: "override" | "frequent" | "trinket" | "bisWeapon" |
 * "weapon" | "set" | "normal" (see the head comment for the order).
 *
 * @param {number} itemId
 * @param {object} settings  councilWeightsStore settings ({ classes, items })
 * @param {{ bisIds?: Set<number>, itemName?: string }} [ctx]  the recipient's BiS ids
 */
function itemClass(itemId, settings, ctx = {}) {
    const id = Number(itemId) || 0;
    if (id && settings && settings.items && settings.items[String(id)]) return "override";
    const f = itemFacts(id, ctx.itemName);
    if (f.frequent) return "frequent";
    if (f.trinket) return "trinket";
    if (f.weapon) return ctx.bisIds && ctx.bisIds.has(id) ? "bisWeapon" : "weapon";
    if (f.set) return "set";
    return "normal";
}

/**
 * The weight one award counts with, and why: { weight, cls }. An exception's
 * weight is its own; every other class takes the council's weight for it.
 */
function itemWeight(itemId, settings, ctx = {}) {
    const cls = itemClass(itemId, settings, ctx);
    const classes = (settings && settings.classes) || {};
    if (cls === "override") return { weight: settings.items[String(Number(itemId))].weight, cls };
    const w = Number(classes[cls]);
    return { weight: Number.isFinite(w) ? w : 1, cls };
}

/** The loot points of a list of awards: the sum of their weights, on a 0.1 grid. */
function lootPoints(items, settings, ctx = {}) {
    const sum = (items || []).reduce((n, it) => n + itemWeight(it.itemId, settings, { ...ctx, itemName: it.itemName }).weight, 0);
    return Math.round(sum * 10) / 10;
}

module.exports = { itemFacts, itemClass, itemWeight, lootPoints, TRINKET_SLOTS };
