// How strong a raider is, for "Raids gleich stark" in the setup proposal (#1038).
//
// Pure: setupLoot.js stores the mean item level per character (the job behind
// "Loot-Daten laden"), setupInput.js the attendance in the category - this turns
// both into one number 0…1 per option (character):
//
//   gear        the character's mean item level, scaled over the run: the lowest
//               known level is 0, the highest 1. Unknown (or everybody alike) ½
//   attendance  the raider's attendance in the category, 0–100 % → 0…1, unknown ½
//
//   strength = GEAR_SHARE × gear + ATTENDANCE_SHARE × attendance
//
// Without any data everybody is ½: the raids are "even" and balance moves nobody.
// The cost (score.js) compares the raids per class - tanks, healers, damage - so a
// strong tank is balanced against tanks, never against three damage dealers.

const { characterKeyOf } = require("../loot/lootImport");

// shares of the two parts - a proposal, the orga decides (#1038)
const GEAR_SHARE = 0.6;
const ATTENDANCE_SHARE = 0.4;
const NEUTRAL = 0.5;

// ROLES ("tank", "healer", "melee", "ranged") → balance class: tanks, healers, damage
const CLASS_OF_ROLE = [0, 1, 2, 2];
// tanks and healers weigh more: one of them carries a raid more than one damage dealer
const CLASS_FACTOR = [1, 1, 0.5];
const CLASSES = CLASS_FACTOR.length;

/** The stored mean item level of a character, or null. */
function itemLevelOf(gear, userId, character) {
    const byChar = gear && gear[userId];
    if (!byChar || typeof byChar !== "object") return null;
    const n = Number(byChar[characterKeyOf(character)]);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Put `option.strength` (0…1) onto every option and return how many raiders have
 * any data (item level or attendance). `gear` = `{ [userId]: { [charKey]: ilvl } }` or null.
 */
function attachStrength(cands, gear) {
    let low = Infinity;
    let high = -Infinity;
    for (const c of cands) {
        for (const o of c.options) {
            const lvl = itemLevelOf(gear, c.userId, o.character);
            o.itemLevel = lvl;
            if (lvl === null) continue;
            if (lvl < low) low = lvl;
            if (lvl > high) high = lvl;
        }
    }
    const span = high - low;
    let known = 0;
    for (const c of cands) {
        const att = c.attendance === null || c.attendance === undefined ? null : Math.max(0, Math.min(100, Number(c.attendance) || 0)) / 100;
        let any = att !== null;
        for (const o of c.options) {
            const gearPart = o.itemLevel !== null && span > 0 ? (o.itemLevel - low) / span : NEUTRAL;
            if (o.itemLevel !== null) any = true;
            o.strength = GEAR_SHARE * gearPart + ATTENDANCE_SHARE * (att === null ? NEUTRAL : att);
            delete o.itemLevel;
        }
        if (any) known++;
    }
    return known;
}

/**
 * The balance cost of per-raid sums (≥ 0, at most 1 per placed raider): per class
 * the mean strength over all raids, and per raid how far its sum is from "its count
 * times that mean". `sum`/`count` are flat, `[event * CLASSES + class]`.
 */
function balanceCost(sum, count, events) {
    let cost = 0;
    for (let k = 0; k < CLASSES; k++) {
        let s = 0;
        let n = 0;
        for (let e = 0; e < events; e++) {
            s += sum[e * CLASSES + k];
            n += count[e * CLASSES + k];
        }
        if (n === 0) continue;
        const mean = s / n;
        let dev = 0;
        for (let e = 0; e < events; e++) dev += Math.abs(sum[e * CLASSES + k] - count[e * CLASSES + k] * mean);
        cost += CLASS_FACTOR[k] * dev;
    }
    return cost;
}

/**
 * The mean strength of every raid (0–100, null for an empty raid) and the spread
 * between the strongest and the weakest - for `checks.balance`.
 * `placed` = per event the strengths of its placed raiders.
 */
function raidStrengths(placed) {
    const means = placed.map((list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null));
    const known = means.filter((m) => m !== null);
    const spread = known.length > 1 ? Math.round((Math.max(...known) - Math.min(...known)) * 100) : 0;
    return { spread, strengths: means.map((m) => (m === null ? null : Math.round(m * 100))) };
}

module.exports = {
    attachStrength, balanceCost, raidStrengths, itemLevelOf,
    CLASS_OF_ROLE, CLASS_FACTOR, CLASSES, GEAR_SHARE, ATTENDANCE_SHARE, NEUTRAL,
};
