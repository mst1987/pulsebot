// softres.it instance catalogue: maps each raid to its softres.it instance code,
// numeric softres id, display name, edition ("classic"/"tbc"/"wotlk"), raid size
// and a set of title keywords used to pre-select instances from a Raid-Helper
// event title.
//
// `code` (the object key) is softres.it's own slug and stays our stable key — it
// is what the admin UI and the stored event records use. `id` is the numeric id
// softres.it's create endpoint expects on the wire since its 2026 rewrite; the
// slug is no longer accepted there. Both come from softres.it's own instance
// list, which the site ships as page props on its start page.
//
// `keywords` are lower-cased, accent-free tokens; a title matches an instance
// when it contains one of them as a word/abbreviation. See utils/softres.js
// (parseInstancesFromTitle) for the matching logic.

const INSTANCES = {
    // --- Classic ---
    mc: { id: 2, name: "Molten Core", edition: "classic", slots: 40, keywords: ["mc", "molten core", "molten"] },
    bwl: { id: 3, name: "Blackwing Lair", edition: "classic", slots: 40, keywords: ["bwl", "blackwing"] },
    onyxia: { id: 1, name: "Onyxia's Lair", edition: "classic", slots: 40, keywords: ["ony", "onyxia"] },
    zg: { id: 4, name: "Zul'Gurub", edition: "classic", slots: 20, keywords: ["zg", "zulgurub", "gurub"] },
    aq20: { id: 5, name: "AQ20 – Ruins of Ahn'Qiraj", edition: "classic", slots: 20, keywords: ["aq20", "ruins"] },
    aq40: { id: 6, name: "AQ40 – Ahn'Qiraj", edition: "classic", slots: 40, keywords: ["aq40", "ahnqiraj", "temple of ahn"] },
    naxxramas: { id: 7, name: "Naxxramas", edition: "classic", slots: 40, keywords: ["naxx", "naxxramas"] },
    dragonsofnightmare: { id: 10, name: "The Dragons of Nightmare", edition: "classic", slots: 40, keywords: ["nightmare dragons", "dragons of nightmare"] },
    lordkazzak: { id: 8, name: "Lord Kazzak", edition: "classic", slots: 40, keywords: ["lord kazzak"] },
    azuregos: { id: 9, name: "Azuregos", edition: "classic", slots: 40, keywords: ["azuregos"] },

    // --- The Burning Crusade ---
    kara: { id: 25, name: "Karazhan", edition: "tbc", slots: 10, keywords: ["kara", "karazhan", "kz"] },
    gruul: { id: 27, name: "Gruul's Lair", edition: "tbc", slots: 25, keywords: ["gruul", "gruuls", "gl"] },
    magtheridon: { id: 28, name: "Magtheridon's Lair", edition: "tbc", slots: 25, keywords: ["magtheridon", "magth", "mag"] },
    za: { id: 26, name: "Zul'Aman", edition: "tbc", slots: 10, keywords: ["za", "zulaman", "aman"] },
    ssc: { id: 29, name: "SSC", edition: "tbc", slots: 25, keywords: ["ssc", "serpentshrine", "serpent"] },
    tempestkeep: { id: 30, name: "TK", edition: "tbc", slots: 25, keywords: ["tk", "tempest keep", "the eye", "tempest"] },
    blacktemple: { id: 32, name: "Black Temple", edition: "tbc", slots: 25, keywords: ["bt", "black temple", "blacktemple"] },
    hyjal: { id: 31, name: "Hyjal Summit", edition: "tbc", slots: 25, keywords: ["hyjal", "mh", "mount hyjal", "battle for mount"] },
    sunwellplateau: { id: 33, name: "Sunwell Plateau", edition: "tbc", slots: 25, keywords: ["swp", "sunwell", "plateau"] },
    doomlordkazzak: { id: 34, name: "Doom Lord Kazzak", edition: "tbc", slots: 40, keywords: ["doom lord kazzak", "doomlord"] },
    doomwalker: { id: 35, name: "Doomwalker", edition: "tbc", slots: 40, keywords: ["doomwalker"] },
    // The combined `worldbosses` entry is gone since the rewrite — the two world
    // bosses above are the only way to pick them now.

    // --- Wrath of the Lich King (common) ---
    wotlknaxx10: { id: 36, name: "Naxxramas (10)", edition: "wotlk", slots: 10, keywords: ["naxx10"] },
    wotlknaxx25: { id: 37, name: "Naxxramas (25)", edition: "wotlk", slots: 25, keywords: ["naxx25"] },
    ulduar10: { id: 42, name: "Ulduar (10)", edition: "wotlk", slots: 10, keywords: ["ulduar10", "ulduar 10"] },
    ulduar25: { id: 43, name: "Ulduar (25)", edition: "wotlk", slots: 25, keywords: ["ulduar25", "ulduar 25", "ulduar"] },
    toc10: { id: 44, name: "Trial of the Crusader (10)", edition: "wotlk", slots: 10, keywords: ["toc10", "togc10"] },
    toc25: { id: 45, name: "Trial of the Crusader (25)", edition: "wotlk", slots: 25, keywords: ["toc25", "togc25", "toc", "togc"] },
    icc10: { id: 48, name: "Icecrown Citadel (10)", edition: "wotlk", slots: 10, keywords: ["icc10"] },
    icc25: { id: 49, name: "Icecrown Citadel (25)", edition: "wotlk", slots: 25, keywords: ["icc25", "icc", "icecrown"] },
    wotlkonyxia10: { id: 46, name: "Onyxia's Lair (10)", edition: "wotlk", slots: 10, keywords: ["ony10"] },
    wotlkonyxia25: { id: 47, name: "Onyxia's Lair (25)", edition: "wotlk", slots: 25, keywords: ["ony25"] },
    rubysanctum10: { id: 50, name: "The Ruby Sanctum (10)", edition: "wotlk", slots: 10, keywords: ["ruby10"] },
    rubysanctum25: { id: 51, name: "The Ruby Sanctum (25)", edition: "wotlk", slots: 25, keywords: ["ruby25", "ruby sanctum"] },
};

module.exports = { INSTANCES };
