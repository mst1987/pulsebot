// Raid-Helper's spec names, resolved to the rule set's classes and specs.
//
// Raid-Helper names a spec in a signup, a raidplan slot or a /signup argument
// with its own strings — "Holy1" for a holy paladin, "Destro", "RestoSham",
// several aliases for one spec. This file is only the table from those names
// to the rule-set key `"<Class>-<Spec>"` (a bare class id for Raid-Helper's
// class-only entries). Everything about a class or spec — its class, its role,
// how Raid-Helper and the guild's emojis call it — comes from
// config/gameVersions/classes.js, the one place classes are described.

const { CLASSES, RAID_HELPER_ONLY_CLASSES, RAID_HELPER_NAMES } = require("./gameVersions/classes");

// Raid-Helper name → rule-set key. The order is the order the entries were
// always listed in: the first name of a spec is the one a catalog shows.
const ALIASES = {
    // Paladin
    Holy1: "Paladin-Holy",
    HolyPala: "Paladin-Holy",
    Protection1: "Paladin-Protection",
    ProtPala: "Paladin-Protection",
    Retribution: "Paladin-Retribution",
    Retri: "Paladin-Retribution",
    PALADIN: "Paladin",
    // Warrior
    Fury: "Warrior-Fury",
    Arms: "Warrior-Arms",
    Protection: "Warrior-Protection",
    ProtWarrior: "Warrior-Protection",
    WARRIOR: "Warrior",
    // Rogue
    Assassination: "Rogue-Assassination",
    Assa: "Rogue-Assassination",
    Sublety: "Rogue-Subtlety",
    Sub: "Rogue-Subtlety",
    Combat: "Rogue-Combat",
    TankRogue: "Rogue-Combat",
    ROGUE: "Rogue",
    // Priest
    Discipline: "Priest-Discipline",
    Disc: "Priest-Discipline",
    Shadow: "Priest-Shadow",
    HolyPriest: "Priest-Holy",
    Holy: "Priest-Holy",
    PRIEST: "Priest",
    // Hunter (Raid-Helper's class-only hunter has always meant survival)
    Survival: "Hunter-Survival",
    SV: "Hunter-Survival",
    Marksmanship: "Hunter-Marksmanship",
    Marksman: "Hunter-Marksmanship",
    MM: "Hunter-Marksmanship",
    Beastmastery: "Hunter-BeastMastery",
    BM: "Hunter-BeastMastery",
    HUNTER: "Hunter-Survival",
    // Warlock
    Demonology: "Warlock-Demonology",
    Demo: "Warlock-Demonology",
    TankWL: "Warlock-Demonology",
    Affliction: "Warlock-Affliction",
    Affli: "Warlock-Affliction",
    Destro: "Warlock-Destruction",
    WARLOCK: "Warlock",
    // Mage
    Fire: "Mage-Fire",
    Arcane: "Mage-Arcane",
    Frost: "Mage-Frost",
    MAGE: "Mage",
    // Druid
    Feral: "Druid-Feral",
    Guardian: "Druid-Guardian",
    Balance: "Druid-Balance",
    Restoration: "Druid-Restoration",
    RestoDruid: "Druid-Restoration",
    DRUID: "Druid",
    // Death Knight (no rule set plays one; see RAID_HELPER_ONLY_CLASSES)
    Unholy_DPS: "DK-Unholy",
    UnholyDK: "DK-Unholy",
    Frost_DPS: "DK-Frost",
    FrostDK: "DK-Frost",
    Blood_Tank: "DK-Blood",
    BloodTank: "DK-Blood",
    BloodDK: "DK-Blood",
    DEATHKNIGHT: "DK",
    // Shaman
    Restoration1: "Shaman-Restoration",
    RestoSham: "Shaman-Restoration",
    Elemental: "Shaman-Elemental",
    EleSham: "Shaman-Elemental",
    Enhancement: "Shaman-Enhancement",
    Enhancer: "Shaman-Enhancement",
    TankShaman: "Shaman-Enhancement",
    SHAMAN: "Shaman",
};

// Season of Discovery's tank runes: Raid-Helper names them apart, the talent
// tree is the damage spec's, the role is not.
const ROLE_OVERRIDES = { TankRogue: "tank", TankWL: "tank", TankShaman: "tank" };

// The names Raid-Helper files under its own "Tank" class. /signup has to send
// that class name back to Raid-Helper's API (utils/helper.js formatSpecs), and
// the setup view counts them as tanks whatever the spec.
const RAIDHELPER_TANK_CLASS = new Set(["Protection1", "ProtPala", "ProtWarrior", "WARRIOR", "Blood_Tank", "BloodTank"]);

const ALL_CLASSES = [...CLASSES, ...RAID_HELPER_ONLY_CLASSES];
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * The resolved entry of one alias:
 *   key             rule-set key ("Paladin-Protection", or "Paladin" for a class-only name)
 *   clazz           the WoW class id ("Paladin", "DK")
 *   role            tank / healer / melee / ranged, "" for a class-only name
 *   spec            Raid-Helper's own spec name ("Protection1")
 *   icon            the guild's Discord emoji name for it ("protpala")
 *   name            the label the bot shows ("Protection Pala")
 *   raidhelperClass the class name Raid-Helper's API expects ("Tank" for its tank entries)
 */
function buildEntry(alias, key) {
    const [classId, specId] = key.split("-");
    const cls = ALL_CLASSES.find((c) => c.id === classId);
    const spec = specId && cls ? cls.specs.find((s) => s.id === specId) : null;
    const names = RAID_HELPER_NAMES[key];
    if (!cls || (specId && !spec) || !names) throw new Error(`classlist: unknown key ${key} for ${alias}`);
    return Object.freeze({
        key,
        clazz: classId,
        role: ROLE_OVERRIDES[alias] || (spec ? spec.role : ""),
        spec: names.spec,
        icon: names.icon,
        name: names.name,
        raidhelperClass: RAIDHELPER_TANK_CLASS.has(alias) ? "Tank" : classId,
    });
}

const ENTRIES = Object.freeze(Object.fromEntries(Object.entries(ALIASES).map(([alias, key]) => [alias, buildEntry(alias, key)])));

// Raid-Helper's own spec name ("Destruction", "Unholy_DPS") → the first alias
// entry carrying it, for callers that may be handed either form.
const BY_SPEC = {};
for (const entry of Object.values(ENTRIES)) {
    if (!hasOwn(BY_SPEC, entry.spec)) BY_SPEC[entry.spec] = entry;
}

/** The entry of a Raid-Helper alias ("Destro", "ProtPala"), or null. */
function entryFor(name) {
    const key = String(name === null || name === undefined ? "" : name);
    return hasOwn(ENTRIES, key) ? ENTRIES[key] : null;
}

/** Like entryFor(), also accepting Raid-Helper's own spec name ("Destruction"). */
function entryForSpec(name) {
    const key = String(name === null || name === undefined ? "" : name);
    return entryFor(key) || (hasOwn(BY_SPEC, key) ? BY_SPEC[key] : null);
}

module.exports = { ALIASES, ROLE_OVERRIDES, ENTRIES, entryFor, entryForSpec };
