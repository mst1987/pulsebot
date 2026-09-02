// The buff/consumable/option sets a caster is simulated under — vendored from
// WoWSims-TBC (wowsims/tbc-new, MIT), transcribed as protojson.
//
// These are a deliberate 1:1 copy of `ui/<class>/<spec>/presets.ts`
// (`Default{RaidBuffs,PartyBuffs,IndividualBuffs,Debuffs,Consumables}` and the
// spec options), NOT our own tuning. The point is that our number is WoWSims'
// number: a raider simmed here and the same raider pasted into the WoWSims UI
// should land on the same DPS, and only an unmodified preset set makes that so.
// Don't "improve" a value — re-copy it when the pinned release moves.
//
// ⚠️ Every spec set is what the *rest of the raid* provides, so a buff the spec
// supplies itself is deliberately missing from its own set: no Misery/Shadow
// Weaving for the shadow priest, no Wrath of Air/Totem of Wrath/Mana Spring for
// the elemental shaman, no Moonkin Aura for the balance druid. Adding them back
// would count the same buff twice and quietly inflate that spec against the
// others — which for a loot council is exactly the wrong kind of wrong.

// The raid buffs every caster set shares (the differences are all in party,
// individual and debuffs).
const CASTER_RAID_BUFFS = {
    bloodlust: true,
    arcaneBrilliance: true,
    giftOfTheWild: "TristateEffectImproved",
    powerWordFortitude: "TristateEffectImproved",
    divineSpirit: "TristateEffectImproved",
};

// Warlock — the generic caster set from warlock/presets.ts.
const WARLOCK_BUFFS = {
    raid: { ...CASTER_RAID_BUFFS },
    party: {
        manaSpringTotem: "TristateEffectRegular",
        moonkinAura: "TristateEffectRegular",
        totemOfWrath: 1,
        wrathOfAirTotem: "TristateEffectImproved",
        eyeOfTheNight: true,
        chainOfTheTwilightOwl: true,
        drums: "LesserDrumsOfBattle",
    },
    individual: { blessingOfKings: true, blessingOfWisdom: "TristateEffectImproved" },
    debuffs: {
        judgementOfWisdom: true, misery: true, shadowWeaving: true, sunderArmor: true,
        curseOfRecklessness: true, shadowEmbrace: true,
        curseOfElements: "TristateEffectImproved", exposeArmor: "TristateEffectImproved",
        huntersMark: "TristateEffectImproved", faerieFire: "TristateEffectImproved",
        improvedSealOfTheCrusader: "TristateEffectImproved",
        screech: true, bloodFrenzy: true, giftOfArthas: true, mangle: true,
        isbUptime: 0.52, exposeWeaknessUptime: 0.9, exposeWeaknessHunterAgility: 1080,
    },
};

// Shadow priest — supplies Misery and Shadow Weaving itself, so both are absent.
const PRIEST_SHADOW_BUFFS = {
    raid: { ...CASTER_RAID_BUFFS },
    party: {
        manaSpringTotem: "TristateEffectRegular",
        wrathOfAirTotem: "TristateEffectImproved",
        eyeOfTheNight: true,
        chainOfTheTwilightOwl: true,
        drums: "LesserDrumsOfBattle",
    },
    individual: { blessingOfKings: true, blessingOfWisdom: "TristateEffectImproved" },
    debuffs: {
        improvedSealOfTheCrusader: "TristateEffectImproved", judgementOfWisdom: true,
        faerieFire: "TristateEffectImproved", shadowEmbrace: true,
        curseOfElements: "TristateEffectImproved", exposeArmor: "TristateEffectImproved",
        isbUptime: 0.52,
    },
};

// Elemental shaman — provides Wrath of Air, Totem of Wrath and Mana Spring, so
// its party block carries none of them.
const SHAMAN_ELEMENTAL_BUFFS = {
    raid: { ...CASTER_RAID_BUFFS },
    party: {
        moonkinAura: "TristateEffectImproved",
        chainOfTheTwilightOwl: true,
        eyeOfTheNight: true,
    },
    individual: {
        blessingOfKings: true, blessingOfWisdom: "TristateEffectImproved", shadowPriestDps: 800,
    },
    debuffs: {
        bloodFrenzy: true, curseOfElements: "TristateEffectImproved", curseOfRecklessness: true,
        exposeArmor: "TristateEffectImproved", faerieFire: "TristateEffectImproved",
        giftOfArthas: true, huntersMark: "TristateEffectImproved",
        improvedSealOfTheCrusader: "TristateEffectImproved", judgementOfWisdom: true,
        mangle: true, misery: true, sunderArmor: true,
    },
};

// Balance druid — provides Moonkin Aura itself; keeps the shaman totems.
const DRUID_BALANCE_BUFFS = {
    raid: { ...CASTER_RAID_BUFFS },
    party: {
        chainOfTheTwilightOwl: true, draeneiRacialCaster: true, drums: "LesserDrumsOfBattle",
        eyeOfTheNight: true, totemOfWrath: 1, wrathOfAirTotem: "TristateEffectImproved",
    },
    individual: {
        blessingOfKings: true, blessingOfWisdom: "TristateEffectImproved", shadowPriestDps: 800,
    },
    debuffs: {
        bloodFrenzy: true, curseOfElements: "TristateEffectImproved", curseOfRecklessness: true,
        exposeArmor: "TristateEffectImproved", giftOfArthas: true,
        huntersMark: "TristateEffectImproved", improvedSealOfTheCrusader: "TristateEffectImproved",
        judgementOfWisdom: true, mangle: true, misery: true, sunderArmor: true,
    },
};

// Mage — the mana-heavy support set from mage/dps/presets.ts.
const MAGE_BUFFS = {
    raid: { ...CASTER_RAID_BUFFS, shadowProtection: true },
    party: {
        manaSpringTotem: "TristateEffectImproved", manaTideTotems: 1,
        wrathOfAirTotem: "TristateEffectRegular", drums: "LesserDrumsOfBattle",
    },
    individual: {
        blessingOfKings: true, blessingOfWisdom: "TristateEffectImproved",
        innervates: 1, powerInfusions: 1, shadowPriestDps: 1400,
    },
    debuffs: {
        misery: true, curseOfElements: "TristateEffectImproved",
        improvedSealOfTheCrusader: "TristateEffectImproved", judgementOfWisdom: true,
        isbUptime: 0.52,
    },
};

// ⚠️ Consumable ids are not one kind of id. `flaskId`/`foodId`/`battleElixirId`/
// `guardianElixirId`/`conjuredId`/`potId` are real item ids, `mhImbueId` is the
// *effect* id (25122, not the oil's item id) and `explosiveId` is likewise an
// effect id — and a wrong one there does not warn, it aborts the whole sim
// ("Major cooldown must have a Spell!"). These are the verified values; do not
// substitute an id looked up on Wowhead.
const WARLOCK_CONSUMABLES = {
    flaskId: 22866, foodId: 27657, conjuredId: 12662,
    mhImbueId: 25122, potId: 22839, explosiveId: 30217,
    petFoodId: 33874, petScrollAgi: true, petScrollStr: true,
};
const PRIEST_SHADOW_CONSUMABLES = {
    flaskId: 22866, foodId: 27657, conjuredId: 12662,
    mhImbueId: 22522, potId: 22839, explosiveId: 30217,
};
const SHAMAN_ELEMENTAL_CONSUMABLES = {
    conjuredId: 12662, flaskId: 22861, foodId: 27657, mhImbueId: 25122, potId: 22839,
};
const DRUID_BALANCE_CONSUMABLES = {
    conjuredId: 12662, flaskId: 22861, foodId: 27657, mhImbueId: 25122, potId: 22832,
};
const MAGE_CONSUMABLES = {
    guardianElixirId: 32067, battleElixirId: 28103, foodId: 27657,
    mhImbueId: 25122, conjuredId: 12662, potId: 22832,
};

// Player-level defaults (professions and range) from each class's OtherDefaults.
const WARLOCK_PLAYER = { profession1: "Engineering", profession2: "Tailoring", distanceFromTarget: 20 };
const PRIEST_PLAYER = { profession1: "Enchanting", profession2: "Tailoring", distanceFromTarget: 28, channelClipDelay: 100 };
const SHAMAN_PLAYER = { profession1: "Leatherworking", profession2: "Enchanting", distanceFromTarget: 20 };
const DRUID_PLAYER = { profession1: "Enchanting", profession2: "Tailoring", distanceFromTarget: 20 };
const MAGE_PLAYER = { profession1: "Engineering", profession2: "Tailoring", distanceFromTarget: 20 };

/**
 * The sim configuration per spec key (see config/casterSpecs.js). Specs that
 * borrow another's rotation (Fire/Frost mage) borrow its entry wholesale — the
 * talent string in casterSpecs.js is what makes them the build WoWSims models.
 */
const SPEC_PRESETS = {
    "Priest-Shadow": {
        options: { classOptions: { preShadowform: true } },
        consumables: PRIEST_SHADOW_CONSUMABLES, player: PRIEST_PLAYER, buffs: PRIEST_SHADOW_BUFFS,
    },
    "Mage-Arcane": {
        options: { classOptions: { defaultMageArmor: "MageArmorMageArmor" } },
        consumables: MAGE_CONSUMABLES, player: MAGE_PLAYER, buffs: MAGE_BUFFS,
    },
    "Warlock-Destruction": {
        options: { classOptions: { armor: "FelArmor", curseOptions: "Recklessness", sacrificeSummon: true, summon: "Succubus" } },
        consumables: WARLOCK_CONSUMABLES, player: WARLOCK_PLAYER, buffs: WARLOCK_BUFFS,
    },
    "Warlock-Affliction": {
        options: { classOptions: { armor: "FelArmor", curseOptions: "Recklessness", summon: "Imp" } },
        consumables: WARLOCK_CONSUMABLES, player: WARLOCK_PLAYER, buffs: WARLOCK_BUFFS,
    },
    "Warlock-Demonology": {
        options: { classOptions: { armor: "FelArmor", curseOptions: "Recklessness", summon: "Felguard" } },
        consumables: WARLOCK_CONSUMABLES, player: WARLOCK_PLAYER, buffs: WARLOCK_BUFFS,
    },
    "Druid-Balance": {
        options: { classOptions: {} },
        consumables: DRUID_BALANCE_CONSUMABLES, player: DRUID_PLAYER, buffs: DRUID_BALANCE_BUFFS,
    },
    "Shaman-Elemental": {
        options: { classOptions: { shieldProcrate: 0 } },
        consumables: SHAMAN_ELEMENTAL_CONSUMABLES, player: SHAMAN_PLAYER, buffs: SHAMAN_ELEMENTAL_BUFFS,
    },
};

/**
 * The standard raid boss: level 73, the same target WoWSims defaults to. The
 * encounter MUST carry at least one target with a level — an empty target list
 * leaves `primaryTarget` undefined and the sim dies reading `.level` off it.
 */
const DEFAULT_TARGET = {
    id: 31146,
    name: "Raid Target",
    level: 73,
    mobType: "MobTypeMechanical",
    minBaseDamage: 15113,
    damageSpread: 0.5,
    swingSpeed: 2,
    parryHaste: true,
    canCrush: true,
};

/** The encounter block for a fight of `duration` seconds. */
function encounter(duration) {
    return { duration, targets: [{ ...DEFAULT_TARGET }] };
}

/** The sim preset for a spec entry, following `simSpec` where one is set. */
function presetFor(specEntry) {
    if (!specEntry) return null;
    return SPEC_PRESETS[specEntry.key] || (specEntry.simSpec ? SPEC_PRESETS[specEntry.simSpec] : null) || null;
}

module.exports = { SPEC_PRESETS, DEFAULT_TARGET, encounter, presetFor };
