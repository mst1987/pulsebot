// What a raider wants to loot, for "Loot verteilen" in the setup proposal (#1037).
//
// Pure: the collection (setupLoot.js) hands in what is stored - the matched
// Softres reserves, the BiS list of the spec filtered to the raid's instances,
// the gear already worn - and this decides, first source wins:
//
//   softres  the character's Softres reserves                       weight 1 each
//   bis      BiS of the spec minus what the character already wears  weight ½ each
//            (only with known gear: an unknown character is not "missing everything")
//   spec     neither: the spec itself as one pseudo-item            weight ¼
//            (two Fury warriors want the same plate - a guess, so it weighs least)
//
// `attachLoot` puts the wants onto the model's options. A raider's wants add up
// to at most 1 (scaled down beyond), so loot is worth at most one weight per raider
// and can never outweigh a minimum rule (score.js).

const { characterKeyOf } = require("../loot/lootImport");

const SOURCE_WEIGHT = { softres: 1, bis: 0.5, spec: 0.25 };
// the pseudo-item of the spec fallback - never a real item id
const SPEC_PREFIX = "spec:";

const ids = (list) => [...new Set((list || []).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))];

/**
 * The wants of one character.
 * @param {string} userId
 * @param {string} character
 * @param {{ reserves?: number[], bis?: number[], worn?: number[]|null, spec?: string }} data
 * @returns {{ items: { itemId: number|string, weight: number }[], source: "softres"|"bis"|"spec" } | null}
 */
function lootWants(userId, character, data = {}) {
    if (!userId || !character) return null;
    const reserves = ids(data.reserves);
    if (reserves.length) return { items: reserves.map((itemId) => ({ itemId, weight: SOURCE_WEIGHT.softres })), source: "softres" };
    if (Array.isArray(data.worn)) {
        const worn = new Set(ids(data.worn));
        const missing = ids(data.bis).filter((id) => !worn.has(id));
        if (missing.length) return { items: missing.map((itemId) => ({ itemId, weight: SOURCE_WEIGHT.bis })), source: "bis" };
    }
    if (data.spec) return { items: [{ itemId: SPEC_PREFIX + data.spec, weight: SOURCE_WEIGHT.spec }], source: "spec" };
    return null;
}

const isSpecItem = (itemId) => typeof itemId === "string" && itemId.startsWith(SPEC_PREFIX);

/** The stored wants of one option's character, or null. */
function wantsOf(loot, userId, character) {
    const byChar = loot.wants && loot.wants[userId];
    if (!byChar) return null;
    return byChar[characterKeyOf(character)] || null;
}

/**
 * Put the loot wants onto the options (`option.loot = [{ i, w }]`, item index and
 * weight) and return the item table, or null when nothing applies. A spec want
 * follows the option's spec - a raider who may also heal wants healer loot there.
 */
function attachLoot(cands, loot) {
    if (!loot || !loot.wants) return null;
    const items = [];
    const index = new Map();
    const indexOf = (itemId) => {
        if (!index.has(itemId)) {
            index.set(itemId, items.length);
            const meta = (loot.items && loot.items[itemId]) || {};
            items.push({ itemId, name: meta.name || "", icon: meta.icon || "", quality: Number(meta.quality) || null, spec: isSpecItem(itemId) });
        }
        return index.get(itemId);
    };
    let any = false;
    for (const c of cands) {
        for (const o of c.options) {
            const entry = wantsOf(loot, c.userId, o.character);
            if (!entry || !Array.isArray(entry.items)) continue;
            let list = entry.items.filter((x) => x && x.itemId !== undefined && x.weight > 0);
            if (entry.source === "spec") list = o.spec ? [{ itemId: SPEC_PREFIX + o.spec, weight: SOURCE_WEIGHT.spec }] : [];
            if (!list.length) continue;
            const sum = list.reduce((s, x) => s + x.weight, 0);
            const scale = sum > 1 ? 1 / sum : 1;
            o.loot = list.map((x) => ({ i: indexOf(x.itemId), w: x.weight * scale }));
            o.lootSource = entry.source;
            any = true;
        }
    }
    return any ? { items } : null;
}

module.exports = { lootWants, attachLoot, isSpecItem, SOURCE_WEIGHT, SPEC_PREFIX };
