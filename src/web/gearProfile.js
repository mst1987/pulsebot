// Is this gear set a caster's damage kit, or their healing one?
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

const wowsims = require("../config/wowsims");

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
 * @returns {{ healRatio, spellHit, spellPower, healingPower, known, role, confident }}
 *   role      "caster" | "healer" | "" (too little known to say)
 *   confident whether both signals agree — the page shows a hedge when they do not
 */
function gearProfile(gear) {
    const items = (gear && gear.items) || [];
    let spellPower = 0;
    let healingPower = 0;
    let spellHit = 0;
    let known = 0;
    for (const it of items) {
        const item = wowsims.item(it.itemId);
        if (!item) continue;
        known += 1;
        spellPower += item.stats.spellPower || 0;
        healingPower += item.stats.healingPower || 0;
        spellHit += item.stats.spellHit || 0;
    }
    // Too few resolvable pieces to judge — a raider in mostly unknown gear gets
    // no verdict rather than a coin flip.
    if (known < 5 || spellPower <= 0) {
        return { healRatio: 0, spellHit, spellPower, healingPower, known, role: "", confident: false };
    }

    const healRatio = healingPower / spellPower;
    const looksHealing = healRatio >= HEAL_RATIO;
    const looksDamage = spellHit >= MIN_DPS_HIT;

    // Both signals agree: a clear verdict either way.
    if (looksHealing && !looksDamage) return { healRatio, spellHit, spellPower, healingPower, known, role: "healer", confident: true };
    if (!looksHealing && looksDamage) return { healRatio, spellHit, spellPower, healingPower, known, role: "caster", confident: true };

    // They disagree — a healing set with hit gear left on, or a damage set of a
    // raider nowhere near the cap. The ratio is the stronger of the two (it is
    // a property of the items, not of how far along the raider is), so it
    // decides, but the answer is flagged as uncertain.
    return {
        healRatio,
        spellHit,
        spellPower,
        healingPower,
        known,
        role: looksHealing ? "healer" : "caster",
        confident: false,
    };
}

/**
 * Whether this set is usable for judging a raider of `role`.
 *
 * Deliberately permissive in one direction: an *uncertain* verdict does not
 * disqualify a set, because rejecting it would leave the raider with no gear at
 * all — and last night's slightly odd set still says more than nothing. Only a
 * confident mismatch (a healing set for a DPS caster) is refused.
 */
function fitsRole(profile, role) {
    if (!role || !profile.role) return true;
    if (profile.role === role) return true;
    return !profile.confident;
}

module.exports = { gearProfile, fitsRole, HEAL_RATIO, MIN_DPS_HIT };
