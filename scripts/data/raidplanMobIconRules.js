// How the default mobs of the raid plan catalog get their icons (docs/raidplan.md). No source gives an icon for
// every add: Warcraft Logs (the source of the boss icons, scripts/fetch-boss-icons.js) lists encounters, not their
// adds or trash. So each default mob gets a SIMILAR WoW icon from the Wowhead icon CDN that the menu already uses
// for spells — chosen by the mob's kind of creature — and the catalog marks it as a placeholder.
//
// scripts/fetch-mob-icons.js turns this table into src/config/mobIcons.json: for every mob the first candidate
// whose URL really answers 200 with an image is taken, nothing is written blind. Edit THIS table, not the JSON.
// Input of scripts/fetch-mob-icons.js only, so it lives beside the script in scripts/data/ (#424): the backend never
// reads it (it reads the generated src/config/mobIcons.json), and it is no configuration anybody sets.

// The kind of creature -> icons that look right for it (the first one that exists wins).
const KIND_ICONS = {
    infernal: ["spell_shadow_summoninfernal"],
    doomguard: ["spell_shadow_summonfelguard"],
    demon: ["spell_shadow_summonvoidwalker", "spell_shadow_summonfelhunter"],
    fel: ["spell_fire_felflamestrike", "spell_fire_fireball02"],
    undead: ["spell_shadow_animatedead", "spell_shadow_raisedead"],
    necromancer: ["spell_shadow_deathcoil", "spell_shadow_shadowbolt"],
    caster: ["spell_frost_frostbolt02", "spell_fire_fireball02"],
    priest: ["spell_holy_holybolt", "spell_holy_flashheal"],
    rogue: ["ability_stealth", "ability_rogue_ambush"],
    guard: ["ability_warrior_defensivestance", "ability_defend"],
    warrior: ["ability_warrior_charge", "ability_warrior_defensivestance"],
    paladin: ["spell_holy_sealofmight", "spell_holy_devotionaura"],
    ranged: ["ability_marksmanship", "ability_hunter_snipershot"],
    beast: ["ability_hunter_beasttaming", "ability_druid_catform"],
    shaman: ["spell_nature_lightning", "spell_nature_lightningshield"],
    fire: ["spell_fire_incinerate", "spell_fire_flamebolt"],
    water: ["spell_frost_summonwaterelemental_2", "spell_frost_frozencore"],
    tainted: ["spell_nature_acid_01", "spell_shadow_curseofmannoroth"],
    arcane: ["spell_arcane_arcane01", "spell_holy_magicalsentry"],
    shadow: ["spell_shadow_shadowfury", "spell_shadow_shadowbolt"],
    drain: ["spell_shadow_lifedrain02", "spell_shadow_lifedrain"],
    fiend: ["spell_shadow_shadowfiend", "spell_shadow_unholyfrenzy"],
    horse: ["ability_mount_ridinghorse", "ability_mount_blackdirewolf"],
    engineer: ["inv_misc_gear_01", "inv_misc_wrench_01"],
    generic: ["inv_misc_head_orc_01", "ability_warrior_defensivestance"],
};

// Per default mob (its slug, the `d:<slug>` id without the prefix): which kind of creature it is.
const MOB_KINDS = {
    gathios: "paladin", zerevor: "caster", malande: "priest", veras: "rogue",
    "flame-of-azzinoth": "fire", "shadow-demon": "demon", "parasitic-shadowfiend": "fiend", maiev: "rogue",
    "ashtongue-channeler": "shadow", "ashtongue-sorcerer": "caster", "ashtongue-defender": "guard", "ashtongue-elementalist": "shaman", "ashtongue-rogue": "rogue",
    "essence-of-suffering": "drain", "essence-of-desire": "arcane", "essence-of-anger": "fel",
    "shadowy-construct": "shadow", "vengeful-spirit": "undead",
    "illidari-nightlord": "doomguard", "illidari-fearbringer": "demon", "illidari-defiler": "fel", "illidari-heartseeker": "ranged",
    "towering-infernal": "infernal", "lesser-doomguard": "doomguard", "doomfire-spirit": "fel",
    "hyjal-abomination": "undead", "hyjal-ghoul": "undead", "hyjal-necromancer": "necromancer", "hyjal-crypt-fiend": "beast", "hyjal-giant-infernal": "infernal",
    midnight: "horse", "netherspite-infernal": "infernal",
    "pure-spawn": "water", "tainted-spawn": "tainted", "fathom-guard-sharkkis": "ranged", "fathom-guard-tidalvess": "shaman", "fathom-guard-caribdis": "priest",
    "tainted-elemental": "tainted", "coilfang-strider": "beast", "enchanted-elemental": "arcane",
    thaladred: "warrior", sanguinar: "drain", capernian: "caster", telonicus: "engineer",
    sathrovarr: "demon", "void-sentinel": "shadow",
};

// Icons an admin can pick from when a mob is made, by category (each checked by the script like the rest).
const ICON_CHOICES = {
    Demon: ["spell_shadow_summoninfernal", "spell_shadow_summonfelguard", "spell_shadow_summonvoidwalker", "spell_shadow_summonfelhunter", "spell_shadow_demonform", "spell_shadow_shadowfiend"],
    Undead: ["spell_shadow_animatedead", "spell_shadow_raisedead", "spell_shadow_deathcoil", "spell_shadow_shadowbolt", "spell_shadow_lifedrain02"],
    Elemental: ["spell_fire_incinerate", "spell_fire_flamebolt", "spell_frost_summonwaterelemental_2", "spell_nature_lightning", "spell_arcane_arcane01", "spell_nature_earthquake"],
    Guard: ["ability_warrior_defensivestance", "ability_defend", "ability_warrior_charge", "ability_warrior_shieldbash", "inv_shield_06"],
    Caster: ["spell_frost_frostbolt02", "spell_fire_fireball02", "spell_holy_holybolt", "spell_holy_flashheal", "spell_shadow_shadowfury"],
    Rogue: ["ability_stealth", "ability_rogue_ambush", "ability_rogue_eviscerate", "ability_backstab"],
    Beast: ["ability_hunter_beasttaming", "ability_druid_catform", "ability_mount_ridinghorse", "ability_hunter_pet_bear"],
    Ranged: ["ability_marksmanship", "ability_hunter_snipershot", "inv_weapon_bow_07"],
    Other: ["inv_misc_head_orc_01", "inv_misc_gear_01", "inv_misc_questionmark", "spell_shadow_curseofmannoroth"],
};

module.exports = { KIND_ICONS, MOB_KINDS, ICON_CHOICES };
