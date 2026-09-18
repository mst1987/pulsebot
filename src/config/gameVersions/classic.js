// The Classic Era rule set (patch 1.12 raids).
//
// Classes and specs are the same nine classes and talent trees as in TBC. The
// buffs are TBC's minus what TBC added: Commanding Shout, Wrath of Air,
// Totem of Wrath, Earth and Water Shield and the Draenei auras (the latter two
// groups are never setup buffs anyway, see buffs.js). What stays — blessings,
// Fortitude, Mark of the Wild, Arcane Intellect, Trueshot, Leader of the Pack,
// Moonkin and Sanctity Aura, Windfury, Grace of Air, Strength of Earth, Mana
// Spring and Mana Tide — exists in 1.12, if at lower ranks.
//
// Instance ids are unique across *all* versions (Classic Onyxia is "ony",
// Forever's is "forever-ony"), so a stored instance id never needs its version
// to be read. Boss names are Warcraft Logs' English encounter names; the final
// boss also lists the German client name, since WCL hands back whatever the
// uploading client called it. Tanks and healers are suggestions only.

const { buildClasses } = require("./classes");
const { buildBuffs } = require("./buffs");

const classes = buildClasses();

// What 1.12 does not have.
const EXCLUDED_BUFFS = ["commandingShout", "wrathOfAir", "totemOfWrath", "vampiricTouch"];

const instances = [
    {
        id: "ony", name: "Onyxias Hort", short: "Ony", sizes: [40], defaultSize: 40,
        icon: "achievement_boss_onyxia",
        color: "#8b2f4f",
        bosses: ["Onyxia"],
        finalBoss: "Onyxia", finalBossNames: ["Onyxia"],
        composition: { 40: { tanks: 2, healers: 8 } },
        zoneNames: ["onyxia's lair", "onyxias hort"],
        status: "complete",
    },
    {
        id: "mc", name: "Geschmolzener Kern", short: "MC", sizes: [40], defaultSize: 40,
        icon: "achievement_boss_ragnaros",
        color: "#e05a1f",
        bosses: [
            "Lucifron", "Magmadar", "Gehennas", "Garr", "Shazzrah", "Baron Geddon",
            "Golemagg the Incinerator", "Sulfuron Harbinger", "Majordomo Executus", "Ragnaros",
        ],
        finalBoss: "Ragnaros", finalBossNames: ["Ragnaros"],
        composition: { 40: { tanks: 3, healers: 10 } },
        zoneNames: ["molten core", "geschmolzener kern"],
        status: "complete",
    },
    {
        id: "bwl", name: "Pechschwingenhort", short: "BWL", sizes: [40], defaultSize: 40,
        icon: "achievement_boss_nefarion",
        color: "#a83232",
        bosses: [
            "Razorgore the Untamed", "Vaelastrasz the Corrupt", "Broodlord Lashlayer",
            "Firemaw", "Ebonroc", "Flamegor", "Chromaggus", "Nefarian",
        ],
        finalBoss: "Nefarian", finalBossNames: ["Nefarian"],
        composition: { 40: { tanks: 4, healers: 10 } },
        zoneNames: ["blackwing lair", "pechschwingenhort"],
        status: "complete",
    },
    {
        id: "zg", name: "Zul'Gurub", short: "ZG", sizes: [20], defaultSize: 20,
        icon: "achievement_boss_hakkar",
        color: "#3f8f6f",
        bosses: [
            "High Priestess Jeklik", "High Priest Venoxis", "High Priestess Mar'li",
            "Bloodlord Mandokir", "Edge of Madness", "High Priest Thekal", "Gahz'ranka",
            "High Priestess Arlokk", "Jin'do the Hexxer", "Hakkar",
        ],
        finalBoss: "Hakkar", finalBossNames: ["Hakkar"],
        composition: { 20: { tanks: 2, healers: 5 } },
        zoneNames: ["zul'gurub", "zulgurub"],
        status: "complete",
    },
    {
        id: "aq20", name: "Ruinen von Ahn'Qiraj", short: "AQ20", sizes: [20], defaultSize: 20,
        icon: "achievement_boss_ossiriantheunscarred",
        color: "#c9a227",
        bosses: [
            "Kurinnaxx", "General Rajaxx", "Moam", "Buru the Gorger", "Ayamiss the Hunter",
            "Ossirian the Unscarred",
        ],
        finalBoss: "Ossirian the Unscarred", finalBossNames: ["Ossirian the Unscarred", "Ossirian der Narbenlose"],
        composition: { 20: { tanks: 2, healers: 5 } },
        zoneNames: ["ruins of ahn'qiraj", "ruinen von ahn'qiraj"],
        status: "complete",
    },
    {
        id: "aq40", name: "Tempel von Ahn'Qiraj", short: "AQ40", sizes: [40], defaultSize: 40,
        icon: "achievement_boss_cthun",
        color: "#6fa02f",
        bosses: [
            "The Prophet Skeram", "Silithid Royalty", "Battleguard Sartura", "Fankriss the Unyielding",
            "Viscidus", "Princess Huhuran", "Twin Emperors", "Ouro", "C'Thun",
        ],
        finalBoss: "C'Thun", finalBossNames: ["C'Thun"],
        composition: { 40: { tanks: 5, healers: 11 } },
        zoneNames: ["temple of ahn'qiraj", "tempel von ahn'qiraj", "ahn'qiraj temple"],
        status: "complete",
    },
    {
        id: "naxx", name: "Naxxramas", short: "Naxx", sizes: [40], defaultSize: 40,
        icon: "achievement_boss_kelthuzad_01",
        color: "#3fa7c4",
        bosses: [
            "Anub'Rekhan", "Grand Widow Faerlina", "Maexxna",
            "Noth the Plaguebringer", "Heigan the Unclean", "Loatheb",
            "Instructor Razuvious", "Gothik the Harvester", "The Four Horsemen",
            "Patchwerk", "Grobbulus", "Gluth", "Thaddius",
            "Sapphiron", "Kel'Thuzad",
        ],
        finalBoss: "Kel'Thuzad", finalBossNames: ["Kel'Thuzad"],
        composition: { 40: { tanks: 6, healers: 12 } },
        zoneNames: ["naxxramas"],
        status: "complete",
    },
];

module.exports = {
    id: "classic",
    label: "Classic Era",
    short: "Classic",
    classes,
    instances,
    ...buildBuffs(classes, { exclude: EXCLUDED_BUFFS }),
    EXCLUDED_BUFFS,
};
