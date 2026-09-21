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
// src/utils/characterNames.js, `characterNames.lastName` switches it on.

const classic = require("./classic");

const instances = [
    {
        id: "forever-barrow", name: "Barrow Deeps", short: "Barrow", sizes: [10], defaultSize: 10,
        icon: "spell_shadow_raisedead",
        color: "#5a6f8f",
        zoneNames: ["barrow deeps"],
        bosses: [], finalBoss: "", finalBossNames: [],
        composition: {},
        status: "incomplete",
    },
    {
        id: "forever-hyjal", name: "Hyjal Summit (Forever)", short: "Hyjal F", sizes: [20], defaultSize: 20,
        icon: "achievement_boss_archimonde-",
        art: "the-battle-for-mount-hyjal",
        color: "#2f7a4f",
        bosses: [], finalBoss: "", finalBossNames: [],
        composition: {},
        status: "incomplete",
    },
    {
        id: "forever-ony", name: "Onyxias Hort (Forever)", short: "Ony F", sizes: [40], defaultSize: 40,
        icon: "achievement_boss_onyxia",
        art: "onyxias-lair",
        color: "#8b2f4f",
        bosses: [], finalBoss: "", finalBossNames: [],
        composition: {},
        status: "incomplete",
    },
];

module.exports = {
    id: "forever",
    label: "WoW Forever",
    short: "Forever",
    characterNames: { lastName: true },
    classes: classic.classes,
    instances,
    partyBuffs: classic.partyBuffs,
    raidBuffs: classic.raidBuffs,
};
