// Which specs the loot council covers, and what each of them values: casters,
// healers, tanks, melee and hunters. Until #669 the council knew casters and
// healers only, under the name config/casterSpecs.js (the forwarding alias
// is gone since #668; require this module).
//
// The key is `"<Class>-<Spec>"` in Warcraft Logs' own spelling, because that is
// where class and spec come from (see services/characters/characterInfo.js — the loot exports
// carry a class at best, never a spec). It is the same key the rule sets use
// (config/gameVersions/classes.js). Everything else hangs off that key:
// the BiS list, the rotation to sim with, and the stat weights the fallback
// scoring uses when no sim result is available.

const { aplFor } = require("./wowsims");
const { bisFor } = require("./bisSets");

// Roles the page can filter by. "caster" was the council's original scope;
// "healer" joined because the two argue over the same spell-power drops, and
// tank, melee and ranged (#669) because a council that only sees half the raid
// cannot weigh a drop the other half wants too (a trinket, a ring, a cloak).
//
// ⚠️ These are the *council's* roles, not the setup's (gameVersions/classes.js:
// tank/healer/melee/ranged). The council splits ranged damage by what it scales
// with: a shadow priest is a "caster" here (spell power), a hunter is "ranged"
// (agility and attack power) — they never want the same item.
const ROLES = [
    { id: "caster", label: "Caster-DPS" },
    { id: "healer", label: "Heiler" },
    { id: "tank", label: "Tank" },
    { id: "melee", label: "Nahkampf" },
    { id: "ranged", label: "Fernkampf" },
];

/** The role ids alone, in the page's order. */
const ROLE_IDS = ROLES.map((r) => r.id);

// Which family of gear a role wears — the vocabulary of
// services/loot/gearProfile.js, which tells a healing set from a damage set and
// a tank set from a physical one. Melee and hunters both wear "physical" gear.
const GEAR_FAMILY = { caster: "caster", healer: "healer", tank: "tank", melee: "physical", ranged: "physical" };

/** The gear family a council role wears, "" for an unknown role. */
function gearFamilyFor(role) {
    return GEAR_FAMILY[String(role || "")] || "";
}

/**
 * Stat weights, spell power = 1.0 — the classic TBC EP scale. They drive the
 * *fallback* upgrade score, the one used when the simulation cannot answer
 * (no binary, a healing spec, an unsupported build). A sim result always wins
 * over these; they are a reasonable ordering, not a claim of DPS.
 *
 * Hit is weighted at or above spell power for every DPS caster, which is the
 * whole point of the TBC hit cap: below it a miss costs the entire cast. Once a
 * raider is capped the number overstates hit — see lootCouncil.js, which stops
 * counting hit past the cap instead of pretending the weight itself changes.
 */
const CASTER_WEIGHTS = {
    spellPower: 1.0, spellHit: 1.0, spellCrit: 0.6, spellHaste: 0.55,
    intellect: 0.15, spirit: 0.1, mp5: 0.2, stamina: 0.02,
};
const HEALER_WEIGHTS = {
    healingPower: 1.0, spellPower: 1.0, mp5: 0.85, intellect: 0.35,
    spellCrit: 0.4, spellHaste: 0.45, spirit: 0.3, stamina: 0.05,
};

// ── Physical damage (#669) ───────────────────────────────────────────────────
//
// Attack power = 1.0, the scale TBC's physical EP lists use. Starting values,
// meant to *order* items sensibly — not a claim of DPS, and no simulation backs
// them yet (see isSimSupported). The reasoning per stat:
//
//   strength   2 attack power for warriors, paladins and shamans, ×1.1 with
//              Blessing of Kings → 2.2. A rogue gets 1 AP per point (1.1).
//   agility    1 AP for rogues, hunters and cats plus 1 % crit per ~33-40
//              points — worth about 2 AP to them, ~1.2 to a strength class,
//              for whom it is crit only.
//   hit        the most valuable rating below the 9 % cap (special attacks
//              stop missing), worth nothing past it — upgradeValue() in
//              lootCouncil.js stops counting it at the cap, like spell hit.
//   expertise  removes the boss's dodge — about as valuable as hit, a little
//              more for rogues, whose every finisher hangs on landing.
//   crit/haste ~1.4-1.8 per rating; haste highest for Windfury/Flurry
//              shamans and rogues, lowest for cats (energy, not swing speed).
//   armor pen  1 rating = 1 boss armor ignored; a few tenths of an AP.
//   stamina    a tie-breaker, as for casters.
const STRENGTH_MELEE_WEIGHTS = {
    attackPower: 1.0, strength: 2.2, agility: 1.2,
    meleeHit: 2.0, meleeCrit: 1.8, expertise: 2.0, meleeHaste: 1.4,
    armorPen: 0.25, stamina: 0.02,
};
// A Retribution paladin's seals and judgements scale a little with spell power,
// and mana matters to them in a way it never does to a warrior.
const RETRIBUTION_WEIGHTS = {
    ...STRENGTH_MELEE_WEIGHTS,
    agility: 1.1, meleeHit: 1.8, meleeCrit: 1.5, expertise: 1.6, meleeHaste: 1.2, armorPen: 0.2,
    spellPower: 0.3, intellect: 0.15, mp5: 0.2,
};
// Enhancement: haste feeds Windfury and Flurry, the shocks scale with spell power.
const ENHANCEMENT_WEIGHTS = {
    ...STRENGTH_MELEE_WEIGHTS,
    meleeHit: 1.8, meleeCrit: 1.5, expertise: 1.8, meleeHaste: 1.6,
    spellPower: 0.2, intellect: 0.15,
};
const ROGUE_WEIGHTS = {
    attackPower: 1.0, agility: 2.0, strength: 1.1,
    meleeHit: 2.2, meleeCrit: 1.7, expertise: 2.2, meleeHaste: 1.7,
    armorPen: 0.3, stamina: 0.02,
};
// A cat's strength is 2 AP × Heart of the Wild, its agility AP *and* crit, and
// "feral attack power" on a weapon is plain attack power in cat form.
const FERAL_CAT_WEIGHTS = {
    attackPower: 1.0, feralAttackPower: 1.0, strength: 2.4, agility: 2.2,
    meleeHit: 1.8, meleeCrit: 1.6, expertise: 1.8, meleeHaste: 0.6,
    armorPen: 0.35, stamina: 0.02,
};
// Hunters: attack power on an item counts for ranged attacks too, so it is
// worth as much as ranged attack power; strength only feeds melee swings and is
// worth nothing. Hit rating on items is one physical hit for melee and ranged
// alike (`meleeHit` in the generated table). Intellect and mp5 keep the mana up.
const HUNTER_WEIGHTS = {
    rangedAttackPower: 1.0, attackPower: 1.0, agility: 2.0, intellect: 0.5,
    meleeHit: 1.8, meleeCrit: 1.4, meleeHaste: 1.0, armorPen: 0.25,
    mp5: 0.5, stamina: 0.02,
};
// Survival's Lightning Reflexes (+15 % agility) and Expose Weakness make
// agility worth more to them than to a beast master.
const SURVIVAL_WEIGHTS = { ...HUNTER_WEIGHTS, agility: 2.5 };

// ── Tanks (#669) ─────────────────────────────────────────────────────────────
//
// Stamina = 1.0 here: a tank's currency is surviving, and stamina is its plain
// unit. Starting values again, in the order a TBC tank gears:
//
//   defense     first — 490 defense makes them uncrittable, the one cap a tank
//               must reach before anything else counts (1.5).
//   dodge/parry the avoidance after it; dodge a little ahead (diminishing
//               returns bite parry harder, and parry needs a weapon).
//   block       rating and value for shield tanks only: they shave hits rather
//               than avoid them, and block value is Holy Shield damage to a
//               paladin. A bear can neither block nor parry (0).
//   armor       small per point, because every plate piece of a tier carries
//               about the same — but Dire Bear Form multiplies a bear's item
//               armor by five, so to them base armor is worth five times as
//               much (bonus armor on rings and trinkets is not multiplied).
//   hit/expertise threat — a missed or dodged Sunder or taunt costs aggro.
//   strength    a little threat and block value; agility is dodge plus armor.
const TANK_WEIGHTS = {
    stamina: 1.0, defense: 1.5, dodge: 1.2, parry: 1.1,
    blockRating: 0.6, blockValue: 0.35, armor: 0.03, bonusArmor: 0.03,
    agility: 1.0, strength: 0.4, meleeHit: 0.6, expertise: 0.7,
    attackPower: 0.1, meleeCrit: 0.15,
};
// A protection paladin's threat is holy damage (Consecration, Holy Shield,
// Seal of Righteousness), so spell power is a threat stat to them, mana keeps
// it rolling, and spell hit lands it.
const PALADIN_TANK_WEIGHTS = {
    ...TANK_WEIGHTS,
    blockValue: 0.5, spellPower: 0.35, spellHit: 0.3, intellect: 0.15, mp5: 0.2,
};
const BEAR_WEIGHTS = {
    stamina: 1.0, armor: 0.15, bonusArmor: 0.03, agility: 1.3,
    defense: 1.2, dodge: 1.3, parry: 0, blockRating: 0, blockValue: 0,
    strength: 0.4, attackPower: 0.1, feralAttackPower: 0.1,
    meleeHit: 0.6, expertise: 0.7, meleeCrit: 0.15,
};

// The weights a role falls back to when its spec carries none of its own.
const ROLE_WEIGHTS = {
    caster: CASTER_WEIGHTS,
    healer: HEALER_WEIGHTS,
    tank: TANK_WEIGHTS,
    melee: STRENGTH_MELEE_WEIGHTS,
    ranged: HUNTER_WEIGHTS,
};

/**
 * Every spec the page knows, grouped by role in the order of ROLES — which is
 * also the order rolesForClass() reports a hybrid's choices in.
 *
 * `bisSpec` is which spec's BiS list stands in when there is none for this
 * one: a Fire Mage's gear priorities are close enough to Arcane's that the
 * Arcane list is a far better answer than an empty one, and the page marks such
 * a list as borrowed. `simSpec` works the same way for the rotation.
 *
 * `talents` is the WoWSims talent string the sim runs with — the reference
 * build for the spec, not the raider's own (a Warcraft-Logs report does not
 * carry a talent string). That is deliberate: the council compares *items*, and
 * holding the build fixed is what makes two raiders' numbers comparable.
 * `specField` is the field of WoWSims' player message the spec's options go in.
 * Both exist only on specs the bot can simulate (see isSimSupported).
 *
 * `weights` overrides the role's stat weights (ROLE_WEIGHTS) for a spec that
 * values something its role-mates do not.
 */
const SPECS = [
    {
        key: "Priest-Shadow", className: "Priest", spec: "Shadow", role: "caster",
        label: "Schattenpriester", wowClass: "ClassPriest", specField: "priest",
        talents: "500230013--503250510240103051451",
        // A shadow priest's shadow-school damage is its spell power.
        school: "shadowPower",
    },
    {
        key: "Mage-Arcane", className: "Mage", spec: "Arcane", role: "caster",
        label: "Arkan-Magier", wowClass: "ClassMage", specField: "mage",
        talents: "2500052300030150330125--053500031003001",
        school: "arcanePower",
    },
    // WoWSims-TBC sims one mage build (Arcane) and ships one mage BiS line, so
    // Fire and Frost borrow both. Their gear wants the same four stats in the
    // same order; only the school bonus differs, and that is carried per spec.
    {
        key: "Mage-Fire", className: "Mage", spec: "Fire", role: "caster",
        label: "Feuer-Magier", wowClass: "ClassMage", specField: "mage",
        talents: "2500052300030150330125--053500031003001",
        bisSpec: "Mage-Arcane", simSpec: "Mage-Arcane", school: "firePower",
    },
    {
        key: "Mage-Frost", className: "Mage", spec: "Frost", role: "caster",
        label: "Frost-Magier", wowClass: "ClassMage", specField: "mage",
        talents: "2500052300030150330125--053500031003001",
        bisSpec: "Mage-Arcane", simSpec: "Mage-Arcane", school: "frostPower",
    },
    {
        key: "Warlock-Destruction", className: "Warlock", spec: "Destruction", role: "caster",
        label: "Zerstörungs-Hexer", wowClass: "ClassWarlock", specField: "warlock",
        talents: "-20500301332101-50500051220051053105",
        school: "firePower",
    },
    {
        key: "Warlock-Affliction", className: "Warlock", spec: "Affliction", role: "caster",
        label: "Gebrechen-Hexer", wowClass: "ClassWarlock", specField: "warlock",
        talents: "05022221112351055003--50500051220001",
        bisSpec: "Warlock-Destruction", school: "shadowPower",
    },
    {
        key: "Warlock-Demonology", className: "Warlock", spec: "Demonology", role: "caster",
        label: "Dämonologie-Hexer", wowClass: "ClassWarlock", specField: "warlock",
        talents: "01-2050030133250101501351-5050005112",
        bisSpec: "Warlock-Destruction", school: "shadowPower",
    },
    {
        key: "Druid-Balance", className: "Druid", spec: "Balance", role: "caster",
        label: "Gleichgewichts-Druide", wowClass: "ClassDruid", specField: "balanceDruid",
        talents: "510022312503135231351--520033",
        school: "naturePower",
    },
    {
        key: "Shaman-Elemental", className: "Shaman", spec: "Elemental", role: "caster",
        label: "Elementar-Schamane", wowClass: "ClassShaman", specField: "elementalShaman",
        talents: "55003105100213351051--05105301005",
        school: "naturePower",
    },
    // ── Healers ───────────────────────────────────────────────────────────────
    // WoWSims-TBC has no healing sims and ships its healer gear sets as empty
    // placeholders (see scripts/fetch-wowsims-data.js). The BiS lists therefore
    // come from Wowhead's written guides instead (scripts/fetch-wowhead-bis.js),
    // which name items but no gems or enchants — enough for the loot history,
    // the stat-weight scoring and the BiS gap, not enough to simulate against.
    {
        key: "Priest-Holy", className: "Priest", spec: "Holy", role: "healer",
        label: "Heilig-Priester", wowClass: "ClassPriest", specField: "priest",
    },
    {
        key: "Priest-Discipline", className: "Priest", spec: "Discipline", role: "healer",
        label: "Disziplin-Priester", wowClass: "ClassPriest", specField: "priest",
        // Wowhead writes one priest healing list, not one per spec — the two
        // heal out of the same gear.
        bisSpec: "Priest-Holy",
    },
    {
        key: "Druid-Restoration", className: "Druid", spec: "Restoration", role: "healer",
        label: "Wiederherstellungs-Druide", wowClass: "ClassDruid", specField: "restorationDruid",
    },
    {
        key: "Shaman-Restoration", className: "Shaman", spec: "Restoration", role: "healer",
        label: "Wiederherstellungs-Schamane", wowClass: "ClassShaman", specField: "restorationShaman",
    },
    {
        key: "Paladin-Holy", className: "Paladin", spec: "Holy", role: "healer",
        label: "Heilig-Paladin", wowClass: "ClassPaladin", specField: "holyPaladin",
    },
    // ── Tanks (#669) ──────────────────────────────────────────────────────────
    // The BiS lists are WoWSims' own (config/generated/wowsims/bisSets.json);
    // none of these specs is simulated yet — no rotation is vendored for them —
    // so they are judged by stat weights, like the healers.
    {
        key: "Warrior-Protection", className: "Warrior", spec: "Protection", role: "tank",
        label: "Schutz-Krieger", wowClass: "ClassWarrior",
    },
    {
        key: "Paladin-Protection", className: "Paladin", spec: "Protection", role: "tank",
        label: "Schutz-Paladin", wowClass: "ClassPaladin", weights: PALADIN_TANK_WEIGHTS,
    },
    {
        // Warcraft Logs and Raid-Helper call the bear "Guardian"; in TBC it is
        // the same Feral tree as the cat, worn with a different set.
        key: "Druid-Guardian", className: "Druid", spec: "Guardian", role: "tank",
        label: "Bären-Druide", wowClass: "ClassDruid", weights: BEAR_WEIGHTS,
    },
    // ── Melee (#669) ──────────────────────────────────────────────────────────
    // Fury before Arms: specForRole() takes the first melee spec of a class,
    // and Fury is the raid build.
    {
        key: "Warrior-Fury", className: "Warrior", spec: "Fury", role: "melee",
        label: "Furor-Krieger", wowClass: "ClassWarrior",
    },
    {
        key: "Warrior-Arms", className: "Warrior", spec: "Arms", role: "melee",
        label: "Waffen-Krieger", wowClass: "ClassWarrior",
    },
    {
        key: "Rogue-Combat", className: "Rogue", spec: "Combat", role: "melee",
        label: "Kampf-Schurke", wowClass: "ClassRogue", weights: ROGUE_WEIGHTS,
    },
    // WoWSims ships one rogue line (Combat). Assassination and Subtlety want
    // the same agility, hit and expertise from their gear and borrow it.
    {
        key: "Rogue-Assassination", className: "Rogue", spec: "Assassination", role: "melee",
        label: "Meucheln-Schurke", wowClass: "ClassRogue", weights: ROGUE_WEIGHTS,
        bisSpec: "Rogue-Combat",
    },
    {
        key: "Rogue-Subtlety", className: "Rogue", spec: "Subtlety", role: "melee",
        label: "Täuschungs-Schurke", wowClass: "ClassRogue", weights: ROGUE_WEIGHTS,
        bisSpec: "Rogue-Combat",
    },
    {
        key: "Druid-Feral", className: "Druid", spec: "Feral", role: "melee",
        label: "Katzen-Druide", wowClass: "ClassDruid", weights: FERAL_CAT_WEIGHTS,
    },
    {
        key: "Shaman-Enhancement", className: "Shaman", spec: "Enhancement", role: "melee",
        label: "Verstärkungs-Schamane", wowClass: "ClassShaman", weights: ENHANCEMENT_WEIGHTS,
    },
    {
        key: "Paladin-Retribution", className: "Paladin", spec: "Retribution", role: "melee",
        label: "Vergeltungs-Paladin", wowClass: "ClassPaladin", weights: RETRIBUTION_WEIGHTS,
    },
    // ── Ranged physical: hunters (#669) ───────────────────────────────────────
    {
        key: "Hunter-BeastMastery", className: "Hunter", spec: "BeastMastery", role: "ranged",
        label: "Tierherrschafts-Jäger", wowClass: "ClassHunter",
    },
    {
        // WoWSims has no Marksmanship line; its gear is Beast Mastery's
        // (agility, attack power, hit), so it borrows that one.
        key: "Hunter-Marksmanship", className: "Hunter", spec: "Marksmanship", role: "ranged",
        label: "Treffsicherheits-Jäger", wowClass: "ClassHunter",
        bisSpec: "Hunter-BeastMastery",
    },
    {
        key: "Hunter-Survival", className: "Hunter", spec: "Survival", role: "ranged",
        label: "Überlebens-Jäger", wowClass: "ClassHunter", weights: SURVIVAL_WEIGHTS,
    },
];

const BY_KEY = new Map(SPECS.map((s) => [s.key, s]));

// A class whose every spec shares one role: knowing the class alone is enough
// to place the raider, which matters because a loot export carries a class at
// best. The value is the spec to assume — for a mage that is only about which
// school bonus counts, for a warlock which rotation, for a rogue and a hunter
// which BiS list — and in each case it is the common raid build.
const CLASS_FALLBACK = {
    Mage: "Mage-Arcane",
    Warlock: "Warlock-Destruction",
    Rogue: "Rogue-Combat",
    Hunter: "Hunter-BeastMastery",
};

/**
 * The spec entry for a character, or null when the council has no spec for
 * them.
 *
 * Falls back to the class when the spec is unknown, but only where the class
 * settles it: a Priest without a spec could be shadow or holy, a Warrior fury
 * or protection, and guessing would put them in the wrong council with a wrong
 * BiS list. Such a character is better shown as "Spec unbekannt" (which is what
 * null leads to) than filed confidently into the wrong row.
 *
 * Spaces in the spec are ignored, so "Beast Mastery" (the way a person writes
 * it) finds "BeastMastery" (the way Warcraft Logs keys it).
 */
function specFor(className, spec) {
    const cls = String(className || "").trim();
    const sp = String(spec || "").replace(/\s+/g, "");
    if (!cls) return null;
    if (sp) {
        const exact = BY_KEY.get(`${cls}-${sp}`);
        if (exact) return exact;
    }
    const assumed = CLASS_FALLBACK[cls];
    return assumed ? { ...BY_KEY.get(assumed), assumedFromClass: true } : null;
}

/** The spec entry for a key, or null. */
function specByKey(key) {
    return BY_KEY.get(String(key || "")) || null;
}

/**
 * The spec a class is played as in a given role — the first one listed, which
 * for every hybrid is the one that matters: a priest planned as DPS is shadow,
 * a druid balance, a shaman elemental, a warrior planned as melee fury. Null
 * when the class has no spec in that role at all, so a mage can never be
 * planned as a tank.
 *
 * Which of the two healing specs a priest gets is deliberately not a decision:
 * there is no healing simulation, and Wowhead writes one priest healing list
 * for both — so Holy and Discipline are the same thing to everything
 * downstream.
 */
function specForRole(className, role) {
    const cls = String(className || "").trim();
    const want = String(role || "").trim();
    if (!cls || !want) return null;
    return SPECS.find((s) => s.className === cls && s.role === want) || null;
}

/**
 * Which roles a class can be planned as, in the order of ROLES. One entry means
 * there is nothing to choose — a mage is never a healer — and the page then
 * shows no switch.
 */
function rolesForClass(className) {
    const cls = String(className || "").trim();
    return [...new Set(SPECS.filter((s) => s.className === cls).map((s) => s.role))];
}

/** The stat weights a spec is judged by. */
function weightsFor(specEntry) {
    if (!specEntry) return CASTER_WEIGHTS;
    const base = specEntry.weights || ROLE_WEIGHTS[specEntry.role] || CASTER_WEIGHTS;
    // A school bonus ("+30 shadow damage") is spell power that only counts for
    // this spec's school — worth exactly as much as spell power to them, and
    // nothing to anyone else, which is why it hangs on the spec and not on the
    // shared weight table.
    return specEntry.school ? { ...base, [specEntry.school]: base.spellPower } : base;
}

/**
 * The spell-hit rating a caster needs before further hit is worthless. 16% for
 * a level-73 boss, 12.6 rating per percent; the three talented specs get part
 * of it from talents and need correspondingly less gear hit.
 */
const HIT_CAP = 202;
const TALENTED_HIT = {
    "Priest-Shadow": 3 * 12.6,          // Shadow Focus
    "Warlock-Affliction": 3 * 12.6,      // Suppression
    "Warlock-Destruction": 0,
    "Warlock-Demonology": 0,
    "Mage-Arcane": 3 * 12.6,             // Elemental Precision
    "Mage-Fire": 3 * 12.6,
    "Mage-Frost": 3 * 12.6,
    "Druid-Balance": 3 * 12.6,           // Balance of Power
};

/**
 * The physical hit cap (#669): 9 % against a level-73 boss — the cap for
 * special attacks, shots and a tank's taunts — at 15.77 hit rating per percent.
 * A dual wielder's white swings miss up to 28 %, but that cap is out of reach
 * and its value far lower; the council measures the one every melee gears for.
 */
const MELEE_HIT_PER_PCT = 15.77;
const MELEE_HIT_CAP = Math.round(9 * MELEE_HIT_PER_PCT); // 142
// Talented physical hit, in percent. A spec not listed has none in the usual
// raid build — Arms is assumed without Precision, and a Retribution paladin
// does not reach the protection tree's.
const TALENTED_MELEE_HIT = {
    "Warrior-Fury": 3,           // Precision
    "Rogue-Combat": 5,           // Precision
    "Rogue-Assassination": 5,    // Precision (in every raid build's 20 combat points)
    "Rogue-Subtlety": 5,
    "Shaman-Enhancement": 6,     // Dual Wield Specialization
    "Hunter-Survival": 3,        // Surefooted
    "Paladin-Protection": 3,     // Precision
};

/**
 * Which item stat is the hit that counts for this spec: "spellHit" for a
 * caster, "meleeHit" for everyone fighting with weapons (hunters included — the
 * generated table carries one physical hit rating), "" for a healer, who has no
 * hit to chase.
 */
function hitStatFor(specEntry) {
    if (!specEntry || specEntry.role === "healer") return "";
    return specEntry.role === "caster" ? "spellHit" : "meleeHit";
}

/** Gear hit rating this spec still needs to be capped (the stat: hitStatFor). 0 for healers. */
function hitCapFor(specEntry) {
    const stat = hitStatFor(specEntry);
    if (stat === "spellHit") return Math.max(0, Math.round(HIT_CAP - (TALENTED_HIT[specEntry.key] || 0)));
    if (stat === "meleeHit") {
        return Math.max(0, Math.round(MELEE_HIT_CAP - (TALENTED_MELEE_HIT[specEntry.key] || 0) * MELEE_HIT_PER_PCT));
    }
    return 0;
}

/** The BiS list to show for this spec and tier, plus where it came from. */
function bisForSpec(specEntry, tierId) {
    if (!specEntry) return { items: [], tier: "", exact: false, source: "", sourceLabel: "", borrowedFrom: "" };
    const own = bisFor(specEntry.key, tierId);
    if (own.items.length) return { ...own, borrowedFrom: "" };
    if (!specEntry.bisSpec) return { ...own, borrowedFrom: "" };
    const borrowed = bisFor(specEntry.bisSpec, tierId);
    return { ...borrowed, borrowedFrom: borrowed.items.length ? specEntry.bisSpec : "" };
}

/** The rotation to sim this spec with, or null when it has none. */
function aplForSpec(specEntry) {
    if (!specEntry) return null;
    return aplFor(specEntry.key) || (specEntry.simSpec ? aplFor(specEntry.simSpec) : null);
}

/**
 * Whether the sim can produce a number for this spec at all: a damage spec with
 * a reference talent string and a vendored rotation. Today that is the casters
 * only — scripts/fetch-wowsims-data.js vendors no physical rotation and
 * utils/wowsims/presets.js carries no physical buff set yet, so tanks, melee
 * and hunters are judged by stat weights like the healers. Vendoring both (and
 * a `talents`/`specField` on the spec) is all it takes to switch one on.
 */
function isSimSupported(specEntry) {
    return !!(specEntry && specEntry.role !== "healer" && specEntry.talents && aplForSpec(specEntry));
}

/**
 * Which specs have this item on their BiS list for a tier — the answer to "für
 * wen ist das eigentlich BiS?".
 *
 * Worth its own function because most drops are contested: 29 of the 50 items
 * on a T6 caster BiS list are wanted by more than one spec, and a trinket or a
 * cloak is regularly on a melee and a hunter list at once, so "BiS" on its own
 * says nothing about *whose*.
 *
 * Specs that borrow another's list are folded into the spec they borrow from
 * (`alsoFor`) rather than listed separately. Otherwise every contested item
 * would show nine entries carrying five distinct claims, and the borrowed ones
 * are an assumption anyway — the page shows them as such.
 *
 * @returns [{ specKey, label, className, spec, role, alsoFor: [label] }]
 */
function bisSpecsForItem(itemId, tierId) {
    const id = Number(itemId);
    if (!id) return [];
    const owners = new Map();
    for (const spec of SPECS) {
        const bis = bisForSpec(spec, tierId);
        if (!bis.items.some((entry) => Number(entry.id) === id)) continue;
        // The spec whose list this actually is: the lender for a borrowed one.
        const ownerKey = bis.borrowedFrom || spec.key;
        if (!owners.has(ownerKey)) {
            const owner = BY_KEY.get(ownerKey) || spec;
            owners.set(ownerKey, {
                specKey: owner.key,
                label: owner.label,
                className: owner.className,
                spec: owner.spec,
                role: owner.role,
                tier: bis.tier,
                alsoFor: [],
            });
        }
        if (bis.borrowedFrom) owners.get(ownerKey).alsoFor.push(spec.label);
    }
    return [...owners.values()];
}

module.exports = {
    ROLES, ROLE_IDS, SPECS, CASTER_WEIGHTS, HEALER_WEIGHTS, ROLE_WEIGHTS, HIT_CAP, MELEE_HIT_CAP,
    specFor, specByKey, specForRole, rolesForClass, weightsFor, hitStatFor, hitCapFor, gearFamilyFor,
    bisForSpec, aplForSpec, isSimSupported, bisSpecsForItem,
};
