// The main professions of the classic clients, for "Mein Profil" (Berufe,
// config/gameVersions/index.js professionsOf). Pure data, confirmed by
// core:wow-researcher with two sources each (October 2026): the ten main
// professions of TBC with their highest skill 375; Classic Era has the same
// minus Jewelcrafting (new in TBC) and 300. Secondary professions (cooking,
// first aid, fishing) are left out on purpose: the profile asks for main ones.
// WoW Forever has no list yet - its client is a retail one, the decision is
// open (docs/roster-profile.md "Berufe").
//
// `label` is the German client name, `labelEn` the English one, `icon` a
// zamimg icon name.

const TBC_PROFESSIONS = Object.freeze([
    { id: "alchemy", label: "Alchimie", labelEn: "Alchemy", icon: "trade_alchemy" },
    { id: "blacksmithing", label: "Schmiedekunst", labelEn: "Blacksmithing", icon: "trade_blacksmithing" },
    { id: "enchanting", label: "Verzauberkunst", labelEn: "Enchanting", icon: "trade_engraving" },
    { id: "engineering", label: "Ingenieurskunst", labelEn: "Engineering", icon: "trade_engineering" },
    { id: "herbalism", label: "Kräuterkunde", labelEn: "Herbalism", icon: "trade_herbalism" },
    { id: "jewelcrafting", label: "Juwelenschleifen", labelEn: "Jewelcrafting", icon: "inv_misc_gem_01" },
    { id: "leatherworking", label: "Lederverarbeitung", labelEn: "Leatherworking", icon: "inv_misc_armorkit_17" },
    { id: "mining", label: "Bergbau", labelEn: "Mining", icon: "trade_mining" },
    { id: "skinning", label: "Kürschnerei", labelEn: "Skinning", icon: "inv_misc_pelt_wolf_01" },
    { id: "tailoring", label: "Schneiderei", labelEn: "Tailoring", icon: "trade_tailoring" },
]);

const CLASSIC_PROFESSIONS = Object.freeze(TBC_PROFESSIONS.filter((p) => p.id !== "jewelcrafting"));

module.exports = { TBC_PROFESSIONS, CLASSIC_PROFESSIONS };
