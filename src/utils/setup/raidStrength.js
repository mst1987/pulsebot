// How strong a raider is, for "Raids gleich stark" in the setup proposal (#1038).
//
// Pure: setupLoot.js stores the mean item level per character (the job behind
// "Loot-Daten laden"), setupInput.js the attendance in the category - this turns
// both into one number 0…1 per option (character):
//
//   gear        ½ + (item level − centre) / span, clamped to 0…1. The span is fixed per
//               version (rules.balanceItemLevelSpan, else ITEM_LEVEL_SPAN): 20 raiders
//               between 115.0 and 115.9 stay within a few hundredths, they are not
//               stretched over 0…1. The centre is the mean of the known levels near the
//               median (within one span), so a twink far below does not shift the mains.
//               Unknown ½ - the centre of the known.
//   attendance  the raider's attendance in the category, 0–100 % → 0…1 (absolute), unknown ½
//
//   strength = GEAR_SHARE × gear + ATTENDANCE_SHARE × attendance
//
// Without any data everybody is ½: the raids are "even" and balance moves nobody.
// The cost (score.js) compares the raids per class - tanks, healers, damage - so a
// strong tank is balanced against tanks, never against three damage dealers - and a
// raid within TOLERANCE of a class's mean costs nothing: noise moves nobody.

const { characterKeyOf } = require("../loot/lootImport");

// shares of the two parts - a proposal, the orga decides (#1038)
const GEAR_SHARE = 0.6;
const ATTENDANCE_SHARE = 0.4;
const NEUTRAL = 0.5;
// item levels from the centre to 0 or 1 when the version names none - a proposal, the orga decides
const ITEM_LEVEL_SPAN = 25;
// a raid this close (per raider, 0…1) to a class's mean counts as even - 3 points of 100, a proposal
const TOLERANCE = 0.03;

// ROLES ("tank", "healer", "melee", "ranged") → balance class: tanks, healers, damage
const CLASS_OF_ROLE = [0, 1, 2, 2];
// tanks and healers weigh more: one of them carries a raid more than one damage dealer
const CLASS_FACTOR = [1, 1, 0.5];
const CLASSES = CLASS_FACTOR.length;

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/** The stored mean item level of a character, or null. */
function itemLevelOf(gear, userId, character) {
    const byChar = gear && gear[userId];
    if (!byChar || typeof byChar !== "object") return null;
    const n = Number(byChar[characterKeyOf(character)]);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** The item level span of a version: its own, else ITEM_LEVEL_SPAN. */
function spanOf(rules) {
    const n = Number(rules && rules.balanceItemLevelSpan);
    return Number.isFinite(n) && n > 0 ? n : ITEM_LEVEL_SPAN;
}

/** The centre of the known levels: their mean, leaving out those more than `span` from the median. */
function centreOf(levels, span) {
    if (!levels.length) return null;
    const sorted = levels.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const near = sorted.filter((l) => Math.abs(l - median) <= span);
    return near.reduce((a, b) => a + b, 0) / near.length;
}

/**
 * Put `option.strength` (0…1) onto every option and return how many raiders have
 * any data (item level or attendance). `gear` = `{ [userId]: { [charKey]: ilvl } }` or null;
 * `span` = the version's item level span (spanOf).
 */
function attachStrength(cands, gear, { span = ITEM_LEVEL_SPAN } = {}) {
    // one level per character - a character has an option per raid and spec
    const byChar = new Map();
    for (const c of cands) {
        for (const o of c.options) {
            const lvl = itemLevelOf(gear, c.userId, o.character);
            if (lvl !== null) byChar.set(`${c.userId}|${characterKeyOf(o.character)}`, lvl);
        }
    }
    const centre = centreOf([...byChar.values()], span);
    let known = 0;
    for (const c of cands) {
        const att = c.attendance === null || c.attendance === undefined ? null : clamp01((Number(c.attendance) || 0) / 100);
        let any = att !== null;
        for (const o of c.options) {
            const lvl = itemLevelOf(gear, c.userId, o.character);
            const gearPart = lvl === null ? NEUTRAL : clamp01(NEUTRAL + (lvl - centre) / span);
            if (lvl !== null) any = true;
            o.strength = GEAR_SHARE * gearPart + ATTENDANCE_SHARE * (att === null ? NEUTRAL : att);
        }
        if (any) known++;
    }
    return known;
}

/** Per class the mean strength over all raids (null without anybody). */
function classMeans(sum, count, events) {
    const means = [];
    for (let k = 0; k < CLASSES; k++) {
        let s = 0;
        let n = 0;
        for (let e = 0; e < events; e++) {
            s += sum[e * CLASSES + k];
            n += count[e * CLASSES + k];
        }
        means.push(n ? s / n : null);
    }
    return means;
}

/**
 * The balance cost of per-raid sums (≥ 0, at most 1 per placed raider): per class
 * the mean strength over all raids, and per raid how far its sum is from "its count
 * times that mean" - less TOLERANCE per raider, so a raid that close costs nothing.
 * `sum`/`count` are flat, `[event * CLASSES + class]`.
 */
function balanceCost(sum, count, events) {
    const means = classMeans(sum, count, events);
    let cost = 0;
    for (let k = 0; k < CLASSES; k++) {
        const mean = means[k];
        if (mean === null) continue;
        let dev = 0;
        for (let e = 0; e < events; e++) {
            const n = count[e * CLASSES + k];
            dev += Math.max(0, Math.abs(sum[e * CLASSES + k] - n * mean) - TOLERANCE * n);
        }
        cost += CLASS_FACTOR[k] * dev;
    }
    return cost;
}

/**
 * The strength of every raid (0–100, null for an empty raid) and the spread between the
 * strongest and the weakest - for `checks.balance`, measured like the cost: per class how
 * far the raid's placed raiders are from that class's mean, weighted with CLASS_FACTOR,
 * added to the weighted mean of everybody. Raids even for the cost (each class at its mean)
 * show the same number; empty places do not count.
 * `sum`/`count` as in balanceCost.
 */
function raidStrengths(sum, count, events) {
    const means = classMeans(sum, count, events);
    let all = 0;
    let weight = 0;
    for (let k = 0; k < CLASSES; k++) {
        if (means[k] === null) continue;
        for (let e = 0; e < events; e++) {
            all += CLASS_FACTOR[k] * sum[e * CLASSES + k];
            weight += CLASS_FACTOR[k] * count[e * CLASSES + k];
        }
    }
    const base = weight ? all / weight : NEUTRAL;
    const values = [];
    for (let e = 0; e < events; e++) {
        let dev = 0;
        let w = 0;
        for (let k = 0; k < CLASSES; k++) {
            const n = count[e * CLASSES + k];
            if (!n) continue;
            dev += CLASS_FACTOR[k] * (sum[e * CLASSES + k] - n * means[k]);
            w += CLASS_FACTOR[k] * n;
        }
        values.push(w ? clamp01(base + dev / w) : null);
    }
    const known = values.filter((m) => m !== null);
    const spread = known.length > 1 ? Math.round((Math.max(...known) - Math.min(...known)) * 100) : 0;
    return { spread, strengths: values.map((m) => (m === null ? null : Math.round(m * 100))) };
}

module.exports = {
    attachStrength, balanceCost, raidStrengths, itemLevelOf, spanOf,
    CLASS_OF_ROLE, CLASS_FACTOR, CLASSES, GEAR_SHARE, ATTENDANCE_SHARE, NEUTRAL, ITEM_LEVEL_SPAN, TOLERANCE,
};
