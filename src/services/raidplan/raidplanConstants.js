// The plain lists the raid plan's modules share (#424): the assignment types and
// the class ids. Data only, no require — so the catalog store and the
// assignment model can both read them without requiring each other.

/** Every assignment type a row of the plan may have (raidplanAssign.js), "other" the fallback. */
const ASSIGN_TYPES = ["tank", "heal", "kick", "md", "ss", "fearward", "special", "dispel", "cc", "buff", "curse", "thunderclap", "demoshout", "trashtank", "other",
    // #536: debuffs on the boss, paladin blessings, auras, shaman totems, the battle res (Rebirth)
    "debuff", "blessing", "aura", "totem", "brez"];

/** The TBC classes, as stored on assignments, catalog spells and slots. */
const CLASS_IDS = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];

module.exports = { ASSIGN_TYPES, CLASS_IDS };
