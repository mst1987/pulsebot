// The TBC Anniversary rule set.
//
// The instances are not listed here a second time: ids, names, boss order and
// final bosses all come from config/tbcContent.js, which the loot import, the
// raid list and the logcheck guard already read. This file only adds what a
// raid *plan* needs on top — the raid size and a suggested number of tanks and
// healers — and the boss icon the menu shows (the same one as
// src/web-client/src/lib/raidIcons.ts).

const { CONTENTS, encountersFor, finalBossesFor } = require("../tbcContent");
const { buildClasses } = require("./classes");
const { buildBuffs } = require("./buffs");

// Per content: size, suggested tanks / healers and the look the bot's event
// message falls back to (#307) — a colour per raid beside the boss icon, so
// SSC, BT and Hyjal tell themselves apart with nothing configured anywhere.
// Suggestions only: a raid template (#266) and every event can change them.
// `art` is the slug of Blizzard's zone picture — the banner under the message
// (embedLook.raidArtUrl).
const PLAN = {
    kara: { size: 10, color: "#6d4b9e", icon: "achievement_boss_princemalchezaar_02", art: "karazhan", tanks: 2, healers: 3 },
    gruul: { size: 25, color: "#9b5a2a", icon: "achievement_boss_gruulthedragonkiller", art: "gruuls-lair", tanks: 4, healers: 6 },
    mag: { size: 25, color: "#a8322c", icon: "achievement_boss_magtheridon", art: "magtheridons-lair", tanks: 3, healers: 6 },
    ssc: { size: 25, color: "#1f8ba5", icon: "achievement_boss_ladyvashj", art: "serpentshrine-cavern", tanks: 3, healers: 7 },
    tk: { size: 25, color: "#3f7fd6", icon: "achievement_boss_kael'thassunstrider_01", art: "tempest-keep", tanks: 3, healers: 7 },
    za: { size: 10, color: "#d08a1f", icon: "achievement_boss_zuljin", art: "zulaman", tanks: 2, healers: 3 },
    hyjal: { size: 25, color: "#2f7a4f", icon: "achievement_boss_archimonde-", art: "the-battle-for-mount-hyjal", tanks: 3, healers: 7 },
    bt: { size: 25, color: "#7ab648", icon: "achievement_boss_illidan", art: "black-temple", tanks: 3, healers: 7 },
    swp: { size: 25, color: "#e0c35c", icon: "achievement_boss_kiljaedan", art: "sunwell-plateau", tanks: 3, healers: 8 },
};

const classes = buildClasses();

const instances = CONTENTS.map((c) => {
    const plan = PLAN[c.id];
    const finals = finalBossesFor(c.id);
    return {
        id: c.id,
        name: c.label,
        short: c.short,
        sizes: [plan.size],
        defaultSize: plan.size,
        icon: plan.icon,
        // The colour of the bot's event message when nothing else sets one (#307).
        color: plan.color,
        // The raid's picture under the event message (Blizzard's zone art).
        art: plan.art,
        bosses: encountersFor(c.id),
        finalBoss: finals[0] || "",
        finalBossNames: finals,
        composition: { [plan.size]: { tanks: plan.tanks, healers: plan.healers } },
        status: "complete",
    };
});

module.exports = {
    id: "tbc",
    label: "TBC Anniversary",
    short: "TBC",
    classes,
    instances,
    // Everything raidBuffs.js/totems.js know is TBC 2.4.3, so nothing is dropped.
    ...buildBuffs(classes),
    PLAN,
};
