// What the healer analysis looks for: the shields and HoTs a healer keeps on
// the tank, and the ways a healer gets mana back mid-fight.
//
// Spell ids are TBC 2.4.3 aura/effect ids of every rank (Wowhead's TBC
// database, nether.wowhead.com/tbc/spell=<id>). Buff events carry the aura id,
// so every rank is listed; the energize ids are what the log credits the mana
// to, which for a potion is the potion's own spell and for a totem or a pet is
// the effect it triggers.

// Auras the tank should carry: one row per aura and source on the timeline.
// `stacks` is the height a stacking HoT can reach (Lifebloom); 0 for the rest.
// `expect` says whose job it is — the class whose healer is asked about the
// uptime — and `expectPct` the uptime below which it is a finding.
const TANK_AURAS = [
    { key: "earthShield", name: "Earth Shield", label: "Erdschild", ids: [974, 32593, 32594], stacks: 0, provider: "Shaman", icon: "spell_nature_skinofearth", expectPct: 80 },
    { key: "lifebloom", name: "Lifebloom", label: "Blühendes Leben", ids: [33763], stacks: 3, provider: "Druid", icon: "inv_misc_herb_felblossom", expectPct: 80 },
    { key: "pws", name: "Power Word: Shield", label: "Machtwort: Schild", ids: [17, 592, 600, 3747, 6065, 6066, 10898, 10899, 10900, 10901, 25217, 25218], stacks: 0, provider: "Priest", icon: "spell_holy_powerwordshield", expectPct: 0 },
    { key: "renew", name: "Renew", label: "Erneuerung", ids: [139, 6074, 6075, 6076, 6077, 6078, 10927, 10928, 10929, 25315, 25221, 25222], stacks: 0, provider: "Priest", icon: "spell_holy_renew", expectPct: 0 },
    { key: "rejuvenation", name: "Rejuvenation", label: "Verjüngung", ids: [774, 1058, 1430, 2090, 2091, 3627, 8910, 9839, 9840, 9841, 25299, 26981, 26982], stacks: 0, provider: "Druid", icon: "spell_nature_rejuvenation", expectPct: 0 },
    { key: "regrowth", name: "Regrowth", label: "Nachwachsen", ids: [8936, 8938, 8939, 8940, 8941, 9750, 9856, 9857, 9858, 26980], stacks: 0, provider: "Druid", icon: "spell_nature_resistnature", expectPct: 0 },
    { key: "prayerOfMending", name: "Prayer of Mending", label: "Gebet der Besserung", ids: [41635], stacks: 5, provider: "Priest", icon: "spell_holy_prayerofmendingtga", expectPct: 0 },
];

// Absorbs the healing table credits as healing: kept apart from the heals so
// an overheal share is not diluted by a shield that never overheals.
const ABSORB_IDS = new Set(TANK_AURAS.find((a) => a.key === "pws").ids.map(String));

// Active mana regeneration, by the energize id the log credits it to.
// `kind` "potion" is what a healer presses themselves (and shares the potion
// cooldown), "cooldown" is a class or raid cooldown, "external" comes from
// somebody else and is not the healer's call.
const MANA_REGEN = [
    { key: "superMana", label: "Super-Manatrank", ids: [28499], icon: "inv_potion_137", kind: "potion" },
    { key: "felMana", label: "Teufelsmanatrank", ids: [38929], icon: "inv_potion_138", kind: "potion" },
    { key: "runicMana", label: "Runenmanatrank", ids: [43186], icon: "inv_alchemy_elixir_02", kind: "potion" },
    { key: "majorMana", label: "Großer Manatrank", ids: [17531], icon: "inv_potion_76", kind: "potion" },
    { key: "greaterMana", label: "Starker Manatrank", ids: [11903], icon: "inv_potion_73", kind: "potion" },
    { key: "nethergon", label: "Nethergonenergie", ids: [41618], icon: "inv_potion_156", kind: "potion" },
    { key: "cenarion", label: "Cenarius-Manasalbe", ids: [41617], icon: "inv_potion_168", kind: "potion" },
    { key: "demonicRune", label: "Dämonische Rune", ids: [16666], icon: "inv_misc_rune_04", kind: "potion" },
    { key: "darkRune", label: "Dunkle Rune", ids: [27869], icon: "inv_misc_rune_04", kind: "potion" },
    { key: "manaTide", label: "Manaflut-Totem", ids: [39609, 17360, 17359, 17358, 16191], icon: "spell_frost_summonwaterelemental", kind: "cooldown" },
    { key: "innervate", label: "Anregen", ids: [29166], icon: "spell_nature_lightning", kind: "external" },
    { key: "shadowfiend", label: "Schattenteufel", ids: [34650], icon: "spell_shadow_shadowfiend", kind: "cooldown" },
    { key: "symbolOfHope", label: "Symbol der Hoffnung", ids: [32548], icon: "spell_holy_symbolofhope", kind: "cooldown" },
];

const auraById = new Map();
for (const a of TANK_AURAS) for (const id of a.ids) auraById.set(String(id), a);
const regenById = new Map();
for (const r of MANA_REGEN) for (const id of r.ids) regenById.set(String(id), r);

/** The tank aura an aura id belongs to, or undefined. */
function tankAuraById(id) {
    return auraById.get(String(id));
}

/** The regeneration an energize id belongs to, or undefined. */
function manaRegenById(id) {
    return regenById.get(String(id));
}

module.exports = { TANK_AURAS, ABSORB_IDS, MANA_REGEN, tankAuraById, manaRegenById };
