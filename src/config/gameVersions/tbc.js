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

// Per content: size and suggested tanks / healers. Suggestions only — a raid
// template (#266) and every event can change them.
const PLAN = {
    kara: { size: 10, icon: "achievement_boss_princemalchezaar_02", tanks: 2, healers: 3 },
    gruul: { size: 25, icon: "achievement_boss_gruulthedragonkiller", tanks: 4, healers: 6 },
    mag: { size: 25, icon: "achievement_boss_magtheridon", tanks: 3, healers: 6 },
    ssc: { size: 25, icon: "achievement_boss_ladyvashj", tanks: 3, healers: 7 },
    tk: { size: 25, icon: "achievement_boss_kael'thassunstrider_01", tanks: 3, healers: 7 },
    za: { size: 10, icon: "achievement_boss_zuljin", tanks: 2, healers: 3 },
    hyjal: { size: 25, icon: "achievement_boss_archimonde-", tanks: 3, healers: 7 },
    bt: { size: 25, icon: "achievement_boss_illidan", tanks: 3, healers: 7 },
    swp: { size: 25, icon: "achievement_boss_kiljaedan", tanks: 3, healers: 8 },
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
