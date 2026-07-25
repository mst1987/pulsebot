// softres.it instance catalogue: maps each raid to its softres.it instance code,
// display name, edition ("classic"/"tbc"/"wotlk"), raid size and a set of title
// keywords used to pre-select instances from a Raid-Helper event title.
//
// Codes + names were taken from softres.it's own instance list; only the codes
// the API accepts are valid. `keywords` are lower-cased, accent-free tokens; a
// title matches an instance when it contains one of them as a word/abbreviation.
// See utils/softres.js (parseInstancesFromTitle) for the matching logic.

const INSTANCES = {
    // --- Classic ---
    mc: { name: "Molten Core", edition: "classic", slots: 40, keywords: ["mc", "molten core", "molten"] },
    bwl: { name: "Blackwing Lair", edition: "classic", slots: 40, keywords: ["bwl", "blackwing"] },
    onyxia: { name: "Onyxia's Lair", edition: "classic", slots: 40, keywords: ["ony", "onyxia"] },
    zg: { name: "Zul'Gurub", edition: "classic", slots: 20, keywords: ["zg", "zulgurub", "gurub"] },
    aq20: { name: "AQ20 – Ruins of Ahn'Qiraj", edition: "classic", slots: 20, keywords: ["aq20", "ruins"] },
    aq40: { name: "AQ40 – Ahn'Qiraj", edition: "classic", slots: 40, keywords: ["aq40", "ahnqiraj", "temple of ahn"] },
    naxxramas: { name: "Naxxramas", edition: "classic", slots: 40, keywords: ["naxx", "naxxramas"] },
    dragonsofnightmare: { name: "The Dragons of Nightmare", edition: "classic", slots: 40, keywords: ["nightmare dragons", "dragons of nightmare"] },
    lordkazzak: { name: "Lord Kazzak", edition: "classic", slots: 40, keywords: ["lord kazzak"] },
    azuregos: { name: "Azuregos", edition: "classic", slots: 40, keywords: ["azuregos"] },

    // --- The Burning Crusade ---
    kara: { name: "Karazhan", edition: "tbc", slots: 10, keywords: ["kara", "karazhan", "kz"] },
    gruul: { name: "Gruul's Lair", edition: "tbc", slots: 25, keywords: ["gruul", "gruuls", "gl"] },
    magtheridon: { name: "Magtheridon's Lair", edition: "tbc", slots: 25, keywords: ["magtheridon", "magth", "mag"] },
    gruulmag: { name: "Gruul's Lair & Magtheridon's Lair", edition: "tbc", slots: 25, keywords: ["gruulmag", "gruul+mag", "gruul mag"] },
    za: { name: "Zul'Aman", edition: "tbc", slots: 10, keywords: ["za", "zulaman", "aman"] },
    ssc: { name: "Serpentshrine Cavern", edition: "tbc", slots: 25, keywords: ["ssc", "serpentshrine", "serpent"] },
    tempestkeep: { name: "Tempest Keep: The Eye", edition: "tbc", slots: 25, keywords: ["tk", "tempest keep", "the eye", "tempest"] },
    ssctempestkeep: { name: "Serpentshrine Cavern & Tempest Keep", edition: "tbc", slots: 25, keywords: ["ssctk", "ssc+tk", "ssc tk"] },
    blacktemple: { name: "Black Temple", edition: "tbc", slots: 25, keywords: ["bt", "black temple", "blacktemple"] },
    hyjal: { name: "Hyjal Summit", edition: "tbc", slots: 25, keywords: ["hyjal", "mh", "mount hyjal", "battle for mount"] },
    bthyjal: { name: "Black Temple & Hyjal", edition: "tbc", slots: 25, keywords: ["bthyjal", "bt+mh", "bt mh"] },
    sunwellplateau: { name: "Sunwell Plateau", edition: "tbc", slots: 25, keywords: ["swp", "sunwell", "plateau"] },
    doomlordkazzak: { name: "Doom Lord Kazzak", edition: "tbc", slots: 40, keywords: ["doom lord kazzak", "doomlord"] },
    doomwalker: { name: "Doomwalker", edition: "tbc", slots: 40, keywords: ["doomwalker"] },
    worldbosses: { name: "World Bosses", edition: "tbc", slots: 40, keywords: ["world boss", "worldboss"] },

    // --- Wrath of the Lich King (common) ---
    wotlknaxx10: { name: "Naxxramas (10)", edition: "wotlk", slots: 10, keywords: ["naxx10"] },
    wotlknaxx25: { name: "Naxxramas (25)", edition: "wotlk", slots: 25, keywords: ["naxx25"] },
    ulduar10: { name: "Ulduar (10)", edition: "wotlk", slots: 10, keywords: ["ulduar10", "ulduar 10"] },
    ulduar25: { name: "Ulduar (25)", edition: "wotlk", slots: 25, keywords: ["ulduar25", "ulduar 25", "ulduar"] },
    toc10: { name: "Trial of the Crusader (10)", edition: "wotlk", slots: 10, keywords: ["toc10", "togc10"] },
    toc25: { name: "Trial of the Crusader (25)", edition: "wotlk", slots: 25, keywords: ["toc25", "togc25", "toc", "togc"] },
    icc10: { name: "Icecrown Citadel (10)", edition: "wotlk", slots: 10, keywords: ["icc10"] },
    icc25: { name: "Icecrown Citadel (25)", edition: "wotlk", slots: 25, keywords: ["icc25", "icc", "icecrown"] },
    wotlkonyxia10: { name: "Onyxia's Lair (10)", edition: "wotlk", slots: 10, keywords: ["ony10"] },
    wotlkonyxia25: { name: "Onyxia's Lair (25)", edition: "wotlk", slots: 25, keywords: ["ony25"] },
    rubysanctum10: { name: "The Ruby Sanctum (10)", edition: "wotlk", slots: 10, keywords: ["ruby10"] },
    rubysanctum25: { name: "The Ruby Sanctum (25)", edition: "wotlk", slots: 25, keywords: ["ruby25", "ruby sanctum"] },
};

module.exports = { INSTANCES };
