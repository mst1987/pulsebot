// The bosses the loading scene (components/ui/RaidLoader.tsx) goes at, per
// game version: the Forever part shows no Lady Vashj or Gruul.
import { RAID_CONTENTS } from "./raidIcons";

export type LoaderBoss = { icon: string; label: string };

/** A raid's end boss with the icon the rest of the menu uses for that raid (lib/wow/raidIcons.ts). */
const endBoss = (raid: string, label: string): LoaderBoss => ({ icon: RAID_CONTENTS[raid].icon, label });

// The bosses per game version. Every icon name is checked against the zamimg
// CDN (large variant): Classic has an achievement icon for the end boss of
// every dungeon but for few raid bosses — Naxxramas is the exception — so the
// raid side is the end bosses plus Naxxramas' wings.
const TBC_BOSSES: LoaderBoss[] = [
    endBoss("kara", "Malchezaar"),
    endBoss("gruul", "Gruul"),
    endBoss("mag", "Magtheridon"),
    endBoss("ssc", "Lady Vashj"),
    endBoss("tk", "Kael'thas"),
    endBoss("za", "Zul'jin"),
    endBoss("hyjal", "Archimonde"),
    endBoss("bt", "Illidan"),
    endBoss("swp", "Kil'jaeden"),
];

const CLASSIC_BOSSES: LoaderBoss[] = [
    // raids
    endBoss("ony", "Onyxia"),
    endBoss("mc", "Ragnaros"),
    endBoss("bwl", "Nefarian"),
    endBoss("zg", "Hakkar"),
    endBoss("aq20", "Ossirian"),
    endBoss("aq40", "C'Thun"),
    endBoss("naxx", "Kel'Thuzad"),
    { icon: "achievement_boss_patchwerk", label: "Patchwerk" },
    { icon: "achievement_boss_maexxna", label: "Maexxna" },
    { icon: "achievement_boss_heigantheunclean", label: "Heigan" },
    { icon: "achievement_boss_loatheb", label: "Loatheb" },
    { icon: "achievement_boss_thaddius", label: "Thaddius" },
    { icon: "achievement_boss_fourhorsemen", label: "Four Horsemen" },
    { icon: "achievement_boss_sapphiron_01", label: "Sapphiron" },
    // dungeons
    { icon: "achievement_boss_mutanus_the_devourer", label: "Mutanus" },
    { icon: "achievement_boss_edwinvancleef", label: "VanCleef" },
    { icon: "achievement_boss_archmagearugal", label: "Arugal" },
    { icon: "achievement_boss_bazil_thredd", label: "Bazil Thredd" },
    { icon: "achievement_boss_bazil_akumai", label: "Aku'mai" },
    { icon: "achievement_boss_charlgarazorflank", label: "Charlga" },
    { icon: "achievement_boss_amnennar_the_coldbringer", label: "Amnennar" },
    { icon: "achievement_boss_archaedas", label: "Archaedas" },
    { icon: "achievement_boss_chiefukorzsandscalp", label: "Ukorz" },
    { icon: "achievement_boss_princesstheradras", label: "Theradras" },
    { icon: "achievement_boss_shadeoferanikus", label: "Eranikus" },
    { icon: "achievement_boss_emperordagranthaurissan", label: "Thaurissan" },
    { icon: "achievement_boss_overlord_wyrmthalak", label: "Wyrmthalak" },
    { icon: "achievement_boss_generaldrakkisath", label: "Drakkisath" },
];

// Forever's own raids (src/config/gameVersions/forever.js) on top of Classic's
// bosses. Barrow Deeps' end boss, Sonya Darkhallow, is the name from the beta
// client files (warcraft.wiki.gg, 10/2026) and may still change; it has no icon
// of its own yet, so it takes the raid's. Labels stay short: the boss name is
// cut at about 15 characters (.rl-boss .rl-name).
const FOREVER_BOSSES: LoaderBoss[] = [
    endBoss("forever-barrow", "Sonya"),
    endBoss("forever-hyjal", "Archimonde"),
    ...CLASSIC_BOSSES,
];

/**
 * The bosses a loader may draw for a game version. Unknown (no session yet, a
 * first visit) gets Classic's: old enough to fit every version.
 */
export function bossesFor(version: string): LoaderBoss[] {
    if (version === "tbc") return TBC_BOSSES;
    if (version === "forever") return FOREVER_BOSSES;
    return CLASSIC_BOSSES;
}

export function pickBoss(version: string): LoaderBoss {
    const pool = bossesFor(version);
    return pool[Math.floor(Math.random() * pool.length)];
}
