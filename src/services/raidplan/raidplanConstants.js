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
 * The game versions that have an assignment type (#751). A type missing here exists in every version.
 *
 * Decided per type against the Classic rule set (Forever has the same nine classes and specs as Classic):
 *   soulstone (ss), thunderclap, demoshout (Demoralizing Shout), fearward, curse, totem, blessing, aura and
 *   brez (Rebirth) all exist in Classic Era, so Classic and Forever keep them.
 *   md (Misdirection) is new in TBC (Classic's hunter has no such spell; Tricks of the Trade is Wrath),
 *   so only TBC offers it.
 * The catalog's spells carry their own `versions` on top (raidplanCatalogDefaults.js) - this list only
 * decides which cards a plan of a version can add.
 */
const ASSIGN_TYPE_VERSIONS = { md: ["tbc"] };

/** The assignment types a plan of a version offers (every type for an unknown or empty version). */
function typesOfVersion(versionId) {
    const id = String(versionId || "");
    return ASSIGN_TYPES.filter((t) => !id || !ASSIGN_TYPE_VERSIONS[t] || ASSIGN_TYPE_VERSIONS[t].includes(id));
}

/** The class ids of a version's rule set, as stored on assignments, catalog spells and slots. */
function classIdsOf(versionId) {
    const rules = rulesFor(versionId);
    return rules ? rules.classes.map((c) => c.id) : [];
}

/** The classes of every rule set (the version-less lists: the catalog form, what a stored row may keep). */
const CLASS_IDS = [...new Set(VERSIONS.flatMap((v) => v.classes.map((c) => c.id)))];

module.exports = { ASSIGN_TYPES, ASSIGN_TYPE_VERSIONS, CLASS_IDS, typesOfVersion, classIdsOf };
