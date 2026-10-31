// The TBC tables the log-check analyzers used to keep inside themselves (#747):
// potions, drums, Bloodlust, the shadow-resistance enchants and gems, the RPB
// zone tags. They live here so the TBC rule set (utils/logcheck/rules.js) can
// hand them out without requiring the analyzers — the analyzers read them from
// here and still export them under their old names. Contents unchanged.

// Combat potions per player (utils/logcheck/consumables/potions.js).
//
// The three columns the report shows (Destruction / Haste / Mana) are aggregates;
// underneath, every consumable is counted by its own type so the report can show
// *which* mana source a raider actually drank. That matters because the sources
// differ wildly in strength — a Super Mana Potion is worth roughly twice a Greater
// one, and the zone-limited Coilfang/Tempest Keep items are free.
//
// Spell ids and icons were verified against live Warcraft-Logs data plus the
// Wowhead item entries. The two zone items report a generic trade_engineering
// spell icon, so those carry their item icon instead.
const POTION_TYPES = [
    // --- damage / haste ---------------------------------------------------
    { key: "destruction", group: "destruction", label: "Zerstörungstrank", ids: ["28508"], itemId: 22839, icon: "inv_potion_107" },
    { key: "haste", group: "haste", label: "Hast-Trank", ids: ["28507"], itemId: 22838, icon: "inv_potion_108" },
    // --- mana, strongest first --------------------------------------------
    { key: "superMana", group: "mana", label: "Super-Manatrank", ids: ["28499"], itemId: 22832, icon: "inv_potion_137" },
    { key: "felMana", group: "mana", label: "Teufelsmanatrank", ids: ["38929"], itemId: 31677, icon: "inv_potion_138" },
    { key: "runicMana", group: "mana", label: "Runenmanatrank", ids: ["43186"], itemId: 33448, icon: "inv_alchemy_elixir_02" },
    { key: "majorMana", group: "mana", label: "Großer Manatrank", ids: ["17531"], itemId: 13444, icon: "inv_potion_76" },
    { key: "greaterMana", group: "mana", label: "Starker Manatrank", ids: ["11903"], itemId: 6149, icon: "inv_potion_73" },
    // zone-limited drops — free inside their instance, so skipping them is pure waste
    { key: "nethergon", group: "mana", label: "Nethergonenergie (Festung der Stürme)", ids: ["41618"], itemId: 32902, icon: "inv_potion_156" },
    { key: "cenarion", group: "mana", label: "Cenarius-Manasalbe (Höhlen des Schlangenschreins)", ids: ["41617"], itemId: 32903, icon: "inv_potion_168" },
    // runes trade health for mana
    { key: "demonicRune", group: "mana", label: "Dämonische Rune", ids: ["16666"], itemId: 12662, icon: "inv_misc_rune_04" },
    { key: "darkRune", group: "mana", label: "Dunkle Rune", ids: ["27869"], itemId: 20520, icon: "inv_misc_rune_04" },
    { key: "madAlchemist", group: "mana", label: "Trank des verrückten Alchemisten", ids: ["45051"], spellId: 45051, icon: "trade_alchemy" },
    // an injector-style effect; the log only ever names it "Mana Infusion"
    { key: "manaInfusion", group: "mana", label: "Manainfusion", ids: ["28760"], spellId: 28760, icon: "trade_engineering" },
];

// Drum ability GUIDs -> category (utils/logcheck/consumables/drums.js). Covers TBC and the "fresh" re-issues.
const DRUM_TYPE = {
    35476: "Battle", 351355: "Battle",
    35475: "War", 351360: "War",
    35478: "Restoration", 351358: "Restoration",
    35477: "Speed", 351359: "Speed",
};

// Bloodlust / Heroism and how long its window lasts (utils/logcheck/fights/cooldownTimeline.js).
const LUST_IDS = new Set(["2825", "32182"]);
const LUST_MS = 40000;

// Shadow resistance granted by enchants / gems (utils/logcheck/consumables/shadowResi.js, ported from ShadowResistance.js)
const SR_ENCHANT = { 804: 10, 1888: 5, 2984: 8, 3009: 20, 2998: 7, 2664: 7, 1441: 15, 2683: 10 };
const SR_GEM = { 22459: 4, 22460: 3 };

// WCL zone id -> zone tag (utils/logcheck/rpb/validate.js), used only to label
// the result. Detection itself runs off the killed npcs (see detectZones),
// because zone ids differ between the classic and the fresh/anniversary realms —
// a fresh SSC+TK report reports zone 1056, which the v1 /zones endpoint does not
// even list.
const ZONE_TAGS = {
    1007: ["Kara"],
    1010: ["SSC", "TK"],
    1011: ["BT", "MH"],
    1012: ["ZA"],
    1013: ["SW"],
    1060: ["BT", "MH"],
};

module.exports = { POTION_TYPES, DRUM_TYPE, LUST_IDS, LUST_MS, SR_ENCHANT, SR_GEM, ZONE_TAGS };
