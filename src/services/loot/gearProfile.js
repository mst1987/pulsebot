// Is this gear set a caster's damage kit, a healing set, a tank set or a
// physical damage set?
//
// It has to be asked, because the loot council reads gear out of whatever raid
// log is newest — and shamans, druids and priests routinely heal a night. A
// resto set judged as DPS gear ruins three things at once: the simulated DPS
// (healing gear does not do damage), the upgrade comparison (the drop would
// "replace" a healing piece it has nothing to do with), and the BiS count.
//
// The signal is in the stats, and it is not subtle. WoWSims models spell power
// as contributing to both damage and healing, so on a DPS item `healingPower`
// and `spellPower` are equal; a dedicated healing item carries far more healing
// than spell power. On top of that, healers have no hit cap to chase, so a
// damage set always carries spell hit and a healing set carries none:
//
//   Shadow-priest T6 BiS   healing 866 = spell power 866, hit 123
//   Healing set            healing 7605 vs spell power 2537, hit 0
//
// Neither number alone is enough — a fresh raider may be far below the hit cap,
// and a few hybrid pieces skew the ratio — so both are weighed together and a
// set that is genuinely ambiguous is reported as such rather than guessed at.
//
// Since tanks, melee and hunters sit on the council too (#669), two more kinds
// of set have to be told apart, and they are asked *first*: a tank set carries
// defense, dodge, parry or block — stats no other set has (every WoWSims tank
// BiS list sums to 60+, every damage and healing list to 0) — and a physical
// set carries attack power, strength, agility and physical hit instead of spell
// power. The order matters: a protection paladin's set carries spell power and
// spell hit (T6 BiS: 668 / 125) and would otherwise read as a caster's.

const wowsims = require("../../config/wowsims");
const { gearFamilyFor } = require("../../config/councilSpecs");

// Tank ratings (defense + dodge + parry + block rating) from which a set is a
// tank set, and from which that is beyond doubt. The WoWSims tank lists sit at
// 63-561, every other list at 0; a damage set with one dodge trinket stays
// below the first.
const TANK_MIN = 40;
const TANK_SURE = 80;
// A set is physical when its physical stats outweigh its spell power by this
// factor — and certainly so when spell power is at most a quarter of them.
const PHYSICAL_RATIO = 2;

/** The physical damage stats of one item, strength and agility counted double (2 AP each). */
function physicalScore(stats) {
    return (stats.attackPower || 0) + (stats.rangedAttackPower || 0) + (stats.feralAttackPower || 0)
        + 2 * (stats.strength || 0) + 2 * (stats.agility || 0)
        + (stats.meleeHit || 0) + (stats.meleeCrit || 0) + (stats.meleeHaste || 0)
        + (stats.expertise || 0) + (stats.armorPen || 0);
}

/** The avoidance stats only a tank set carries. */
function tankScore(stats) {
    return (stats.defense || 0) + (stats.dodge || 0) + (stats.parry || 0) + (stats.blockRating || 0);
}

// Above this, healing outweighs spell power so far that the set can only be a
// healing one. A pure damage set sits at 1.0; hybrid pieces push it to ~1.3.
const HEAL_RATIO = 1.6;
// A damage set essentially always carries some hit; a healing set carries none
// on purpose. Below this the set is not chasing the hit cap.
const MIN_DPS_HIT = 40;

/**
 * What a gear set looks like, statistically.
 *
 * @param {object} gear a charGear snapshot ({ items: [{ itemId }] })
 * @returns {{ healRatio, spellHit, spellPower, healingPower, physical, tank, known, role, confident }}
 *   role      "caster" | "healer" | "tank" | "physical" | "" (too little known to say)
 *   confident whether the signals agree — the page shows a hedge when they do not
 */
function gearProfile(gear) {
    const items = (gear && gear.items) || [];
    let spellPower = 0;
    let healingPower = 0;
    let spellHit = 0;
    let physical = 0;
    let tank = 0;
    let known = 0;
    for (const it of items) {
        const item = wowsims.item(it.itemId);
        if (!item) continue;
        known += 1;
        spellPower += item.stats.spellPower || 0;
        healingPower += item.stats.healingPower || 0;
        spellHit += item.stats.spellHit || 0;
        physical += physicalScore(item.stats);
        tank += tankScore(item.stats);
    }
    const sums = { spellHit, spellPower, healingPower, physical, tank, known };
    // Too few resolvable pieces to judge — a raider in mostly unknown gear gets
    // no verdict rather than a coin flip.
    if (known < 5) return { healRatio: 0, ...sums, role: "", confident: false };
    // Tank first: its stats are unique to it, whatever else the set carries.
    if (tank >= TANK_MIN) return { healRatio: 0, ...sums, role: "tank", confident: tank >= TANK_SURE };
    if (physical > 0 && physical >= PHYSICAL_RATIO * spellPower) {
        return { healRatio: 0, ...sums, role: "physical", confident: spellPower * 4 <= physical };
    }
    if (spellPower <= 0) return { healRatio: 0, ...sums, role: "", confident: false };

    const healRatio = healingPower / spellPower;
    const looksHealing = healRatio >= HEAL_RATIO;
    const looksDamage = spellHit >= MIN_DPS_HIT;

    // Both signals agree: a clear verdict either way.
    if (looksHealing && !looksDamage) return { healRatio, ...sums, role: "healer", confident: true };
    if (!looksHealing && looksDamage) return { healRatio, ...sums, role: "caster", confident: true };

    // They disagree — a healing set with hit gear left on, or a damage set of a
    // raider nowhere near the cap. The ratio is the stronger of the two (it is
    // a property of the items, not of how far along the raider is), so it
    // decides, but the answer is flagged as uncertain.
    return { healRatio, ...sums, role: looksHealing ? "healer" : "caster", confident: false };
}

/**
 * Whether this set is usable for judging a raider of `role` — a council role
 * (caster, healer, tank, melee, ranged), compared by the family of gear it
 * wears (melee and hunters both wear "physical" sets).
 *
 * Deliberately permissive in one direction: an *uncertain* verdict does not
 * disqualify a set, because rejecting it would leave the raider with no gear at
 * all — and last night's slightly odd set still says more than nothing. Only a
 * confident mismatch (a healing set for a DPS caster, a tank set for a fury
 * warrior) is refused.
 */
function fitsRole(profile, role) {
    if (!role || !profile.role) return true;
    if (profile.role === (gearFamilyFor(role) || role)) return true;
    return !profile.confident;
}

// From this share of resilience pieces on, a set is an arena set and not a
// raid set with the odd Gladiator weapon in it. A PvE raider carries one to
// three PvP pieces (a weapon, an off-hand, the trinket); a full arena set is
// five pieces plus accessories.
const PVP_SHARE = 0.5;

/** Whether one item is PvP gear — resilience is the stat only PvP gear has. */
function isPvpItem(itemId) {
    const item = wowsims.item(itemId);
    return !!(item && item.stats && item.stats.resilience);
}

/**
 * Is this a PvP set?
 *
 * Asked because the armory shows what a raider has on *now* — and between two
 * raid nights that is regularly their arena gear. Judging a raid drop against
 * it makes no sense at all: resilience is worth nothing to a boss, and every
 * drop would "replace" a Gladiator piece it has nothing to do with. Such a set
 * is refused in favour of the last raid's (see charGear.js).
 *
 * @returns {{ known: number, pvpPieces: number, isPvp: boolean }}
 */
function pvpProfile(gear) {
    const items = (gear && gear.items) || [];
    let known = 0;
    let pvpPieces = 0;
    for (const it of items) {
        if (!wowsims.item(it.itemId)) continue;
        known += 1;
        if (isPvpItem(it.itemId)) pvpPieces += 1;
    }
    // Too few known pieces to call it either way.
    const isPvp = known >= 5 && pvpPieces / known >= PVP_SHARE;
    return { known, pvpPieces, isPvp };
}

/** The yes/no half of pvpProfile. */
function isPvpSet(gear) {
    return pvpProfile(gear).isPvp;
}

module.exports = { gearProfile, fitsRole, pvpProfile, isPvpSet, isPvpItem, HEAL_RATIO, MIN_DPS_HIT, PVP_SHARE, TANK_MIN, TANK_SURE };
