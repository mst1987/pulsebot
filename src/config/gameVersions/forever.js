// The World of Warcraft: Forever rule set — as far as it was announced at
// BlizzCon 2026 (launch 4 Nov 2026, the first raids open 9 Dec 2026).
//
// Classes, specs and buffs are Classic's. The instances are Forever's own and
// all `incomplete`: sizes are announced, bosses and final bosses are not. An
// incomplete instance is plannable, the menu marks it "Infos fehlen", and the
// unfinished-raid guard never blocks on it — it has no final boss to wait for.
// Fill in bosses once the raids are out (by hand or with a scan script like
// scripts/fetch-tbc-loot.js).
//
// Deliberately not listed: the two raids announced for spring 2027 and the
// reworked "iconic" raid of summer 2027 (no names yet), and the Classic raids
// (MC, BWL, AQ, ZG, Naxx) that Forever has "not yet opened" — until they do,
// plan them as Classic instances.
//
// The ids carry a `forever-` prefix: Forever's Hyjal Summit is not TBC's Hyjal
// ("hyjal") and Forever's Onyxia is not Classic's ("ony").
//
// Characters in Forever carry a first and a last name, twelve letters each
// ("Vorname Nachname"); the other versions know one name. The rule lives in
// src/utils/signup/characterNames.js, `characterNames.lastName` switches it on.

const classic = require("./classic");
const { buildBuffs } = require("./buffs");

// Suggested tanks/healers per size are an ESTIMATE (10.10.2026): the bosses are
// unknown, so each size takes the curve of the comparable Classic/TBC raid
// (10 = Karazhan 2/3, 20 = Zul'Gurub 2/5, 40 = Onyxia 2/8). Correct them when
// the first raids are out.

// Buffs (#751): Classic's, with Forever's changes. Source: the user's
// confirmation and the beta (Daybreak Forever "raid buffs", Blizzard forum beta
// notes of 24.09.2026), checked 10.10.2026 - the exact list still has to be
// verified on the server.
//   * Group buffs that reach the WHOLE raid in Forever (Gift of the Wild, Arcane
//     Brilliance, the Prayers, Aspect of the Wild, resistance auras/totems) are
//     "raid" buffs. In the rule set Mark of the Wild, Arcane Intellect,
//     Fortitude, Spirit and Shadow Protection already are; Aspect of the Wild
//     and the resistance buffs are no setup buffs at all.
//   * Still party only: Battle Shout, Windfury Totem, Grace of Air Totem,
//     Strength of Earth Totem, Leader of the Pack.
//   * Not confirmed either way, so they keep Classic's party reach: the
//     paladin, hunter and moonkin auras, Mana Spring/Tide, Healing Stream,
//     Blood Pact.
//   * Tranquil Air, Windfury and Grace of Air no longer stack with each other,
//     not even from different shamans: the air slot is shared, so a second
//     shaman in a party adds nothing (`sharedSlot`, setupEditor's
//     partyBenefits). The Flametongue/Windfury clash is not modelled
//     (Flametongue is no setup buff).
const SCOPES = {
    motw: "raid", intellect: "raid", fortitude: "raid", spirit: "raid", shadowProt: "raid",
    battleShout: "party", windfury: "party", graceOfAir: "party", strengthOfEarth: "party", lotp: "party",
};
const buffs = buildBuffs(classic.classes, {
    exclude: classic.EXCLUDED_BUFFS,
    scopes: SCOPES,
    sharedSlots: ["air"],
});

// Lockouts: all weekly (gameVersions.resetDaysOf standard 7) - unconfirmed,
// check after launch and set `resetDays` per instance where it differs.
const instances = [
    {
        id: "forever-barrow", name: "Barrow Deeps", short: "Barrow", sizes: [10], defaultSize: 10,
        icon: "spell_shadow_raisedead",
        color: "#5a6f8f",
        zoneNames: ["barrow deeps"],
        bosses: [], finalBoss: "", finalBossNames: [],
        composition: { 10: { tanks: 2, healers: 3 } },
        status: "incomplete",
    },
    {
        id: "forever-hyjal", name: "Hyjal Summit (Forever)", short: "Hyjal F", sizes: [20], defaultSize: 20,
        icon: "achievement_boss_archimonde-",
        art: "the-battle-for-mount-hyjal",
        color: "#2f7a4f",
        // What a log or a title says: Forever's Hyjal Summit, not TBC's ("hyjal").
        zoneNames: ["hyjal summit", "hyjalgipfel", "hyjal"],
        // Encounter names known before the raid is filled in: they place a log in
        // this raid without making it a final boss (the guard stays off).
        bossHints: ["Archimonde"],
        bosses: [], finalBoss: "", finalBossNames: [],
        composition: { 20: { tanks: 2, healers: 5 } },
        status: "incomplete",
    },
    {
        id: "forever-ony", name: "Onyxias Hort (Forever)", short: "Ony F", sizes: [40], defaultSize: 40,
        icon: "achievement_boss_onyxia",
        art: "onyxias-lair",
        color: "#8b2f4f",
        zoneNames: ["onyxia's lair", "onyxias hort"],
        bossHints: ["Onyxia"],
        bosses: [], finalBoss: "", finalBossNames: [],
        composition: { 40: { tanks: 2, healers: 8 } },
        status: "incomplete",
    },
];

module.exports = {
    id: "forever",
    label: "WoW Forever",
    short: "Forever",
    // The version's launcher icon (WoW Forever); see tbc.js.
    icon: "/versions/forever.png",
    // The version's colour in the web admin (#742, dark theme); see tbc.js.
    color: "#4da3ff",
    characterNames: { lastName: true },
    // Dungeon best times (feature "dungeonTimes", services/versions/versionCapabilities.js):
    // the LevelHelper addon runs on this client and reports group runs and
    // achievement points (docs/dungeon-leaderboard.md); "Mein Profil" shows them
    // per character only for a version that has this.
    dungeonTimes: true,
    // Classic's classes, so Classic's assignment types (#751): no Misdirection.
    raidplanTypesLeftOut: classic.raidplanTypesLeftOut,
    // The version's own curve for a raid size without an instance suggestion
    // (defaultComposition); the same estimate as above.
    composition: { 10: { tanks: 2, healers: 3 }, 20: { tanks: 2, healers: 5 }, 40: { tanks: 2, healers: 8 } },
    classes: classic.classes,
    instances,
    partyBuffs: buffs.partyBuffs,
    raidBuffs: buffs.raidBuffs,
    // Wowhead has a section of its own for Forever (www.wowhead.com/forever,
    // #750). The beta's namespace, armory and log sites are not known (Epic
    // #540 phase 2): once they are, they go here in the shape of classic.js'
    // settingsDefaults, and the start-up migration fills the empty fields once.
    settingsDefaults: {
        wowheadPath: "forever",
    },
};
