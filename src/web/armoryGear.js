// Live gear from the armory, for the slots a log cannot answer honestly.
//
// The loot council reads gear out of the stored evaluations, which is *last
// seen in a raid*. For almost everything that is the better source: it carries
// gems and enchants, and it is the gear the raider actually fought in. For one
// case it is the worse source — a piece that goes on for a single boss (Mark of
// the Champion and its like, config/situationalItems.js). The log may well have
// caught exactly that fight, and the armory knows what is on the character now.
//
// Deliberately only those slots, and deliberately only trinkets-and-the-like:
// the armory's enchant ids are Blizzard's, not the ones WoWSims expects, so
// taking a whole set from here would need that mapping verified first. A
// trinket carries no enchant at all, which is why this narrow use is safe today
// and the wide one is not.
//
// Best-effort throughout: no credentials, an offline API, an unknown character
// — all of them simply mean no answer, and the caller falls back to what the
// logs know. Nothing here is ever the only source of a raider's gear.

const Blizzard = require("../classes/blizzard");
const { getConfig } = require("./settingsStore");
const { situationalItem } = require("../config/situationalItems");
const wowsims = require("../config/wowsims");
const { characterKey, splitPlayer } = require("../utils/lootImport");

// Blizzard names the equip slots, Warcraft Logs numbers them. Only the slots
// both sides agree on are listed; a slot missing here simply has no armory
// answer.
const SLOT_BY_TYPE = {
    HEAD: 0, NECK: 1, SHOULDER: 2, SHIRT: 3, CHEST: 4, WAIST: 5, LEGS: 6, FEET: 7,
    WRIST: 8, HANDS: 9, FINGER_1: 10, FINGER_2: 11, TRINKET_1: 12, TRINKET_2: 13,
    BACK: 14, MAIN_HAND: 15, OFF_HAND: 16, RANGED: 17,
};

// How long an armory answer is kept. Long enough that a council clicking around
// the page does not re-fetch per view, short enough that a raider who just
// swapped shows up in the same session.
const TTL_MS = 10 * 60 * 1000;

const cache = new Map();

function keyOf(character) {
    return characterKey(splitPlayer(character).character);
}

/** The armory rows of one character, in the shape charGear reads. */
function toArmoryRows(gear) {
    const out = [];
    for (const item of gear || []) {
        const slot = SLOT_BY_TYPE[String(item.slot || "").toUpperCase()];
        if (slot === undefined || !item.itemId) continue;
        const known = wowsims.item(item.itemId) || null;
        out.push({
            slot,
            itemId: String(item.itemId),
            itemName: item.name || (known ? known.name : ""),
            // Blizzard's payload carries no icon; the caster table has one for
            // anything a council would argue about, and a missing icon renders
            // as an empty square rather than a wrong one.
            icon: known && known.icon ? `${known.icon}.jpg` : null,
            quality: known ? known.quality : null,
            itemLevel: item.level || (known ? known.ilvl : 0) || 0,
            gems: (item.sockets || []).filter((s) => s && s.gemId).map((s) => ({ id: String(s.gemId) })),
            emptySockets: 0,
            // Never claimed: Blizzard's enchant ids are not WoWSims' ids, so
            // saying anything here would be a guess (see the file header).
            enchant: { status: "na", enchantId: null, reason: "" },
        });
    }
    return out;
}

/**
 * Fetch the armory for these characters and keep it for a while.
 *
 * @param {string[]} characters names, as the reports spell them
 * @returns {Promise<{asked: number, answered: number, configured: boolean}>}
 */
async function primeArmoryGear(characters) {
    const config = getConfig();
    const client = new Blizzard(config.blizzard || {});
    if (!client.isConfigured()) return { asked: 0, answered: 0, configured: false };

    const now = Date.now();
    const wanted = [...new Set((characters || []).map((c) => String(c || "").trim()).filter(Boolean))]
        .filter((name) => {
            const hit = cache.get(keyOf(name));
            return !hit || now - hit.at > TTL_MS;
        });

    let answered = 0;
    for (const name of wanted) {
        let rows = null;
        try {
            const gear = await client.getEquipment(name);
            rows = gear ? toArmoryRows(gear) : null;
        } catch {
            rows = null;
        }
        // A failed lookup is cached too, as "no answer": otherwise every page
        // view retries a character the API does not know, and the council waits
        // for it every time.
        cache.set(keyOf(name), { at: Date.now(), rows });
        if (rows && rows.length) answered += 1;
    }
    return { asked: wanted.length, answered, configured: true };
}

/**
 * What the armory says sits in one slot — null when unknown, and null for a
 * piece that is itself boss-specific (the armory may have caught the same
 * moment the log did).
 */
function armoryItemInSlot(character, slot) {
    const hit = cache.get(keyOf(character));
    if (!hit || !hit.rows) return null;
    const item = hit.rows.find((it) => it.slot === Number(slot));
    if (!item || situationalItem(item.itemId)) return null;
    return item;
}

/** Whether an armory answer exists for this character at all. */
function hasArmoryGear(character) {
    const hit = cache.get(keyOf(character));
    return !!(hit && hit.rows && hit.rows.length);
}

/** Test seam, and the way a settings change drops stale answers. */
function clearArmoryCache() {
    cache.clear();
}

module.exports = {
    primeArmoryGear, armoryItemInSlot, hasArmoryGear, clearArmoryCache,
    toArmoryRows, SLOT_BY_TYPE, TTL_MS,
};
