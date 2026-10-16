// The plain lists the raid plan's modules share (#424): the assignment types and
// the class ids. Data only (plus the rule sets, which are data too) - so the
// catalog store and the assignment model can both read them without requiring
// each other.

const { VERSIONS, rulesFor } = require("../../config/gameVersions");

/** Every assignment type a row of the plan may have (raidplanAssign.js), "other" the fallback. */
const ASSIGN_TYPES = ["tank", "heal", "kick", "md", "ss", "fearward", "special", "dispel", "cc", "buff", "curse", "thunderclap", "demoshout", "trashtank", "other",
    // #536: debuffs on the boss, paladin blessings, auras, shaman totems, the battle res (Rebirth)
    "debuff", "blessing", "aura", "totem", "brez"];

/**
 * The assignment types a plan of a version offers (every type for an unknown or empty version).
 *
 * Which types a version lacks is rule-set data since #761 (`raidplanTypesLeftOut` in
 * config/gameVersions/<id>.js), so a new version needs no code here. Decided per type against the
 * Classic rule set (Forever has the same nine classes and specs as Classic, #751): soulstone (ss),
 * thunderclap, demoshout (Demoralizing Shout), fearward, curse, totem, blessing, aura and brez (Rebirth)
 * all exist in Classic Era; md (Misdirection) is new in TBC, so Classic and Forever leave it out.
 * The catalog's spells carry their own `versions` on top (raidplanCatalogDefaults.js) - this only
 * decides which cards a plan of a version can add.
 */
function typesOfVersion(versionId) {
    const rules = rulesFor(versionId);
    const leftOut = rules && Array.isArray(rules.raidplanTypesLeftOut) ? rules.raidplanTypesLeftOut : [];
    return ASSIGN_TYPES.filter((t) => !leftOut.includes(t));
}

/** The class ids of a version's rule set, as stored on assignments, catalog spells and slots. */
function classIdsOf(versionId) {
    const rules = rulesFor(versionId);
    return rules ? rules.classes.map((c) => c.id) : [];
}

/** The classes of every rule set (the version-less lists: the catalog form, what a stored row may keep). */
const CLASS_IDS = [...new Set(VERSIONS.flatMap((v) => v.classes.map((c) => c.id)))];

module.exports = { ASSIGN_TYPES, CLASS_IDS, typesOfVersion, classIdsOf };
