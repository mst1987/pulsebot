// The shaman's totems in TBC 2.4.3: the cast spell of every rank, the aura the
// totem puts on party members (empty for totems that buff nobody), the element
// slot it occupies and how long it stands.
//
// Verified against Wowhead's TBC database (nether.wowhead.com/tbc tooltips,
// EN and DE). Things easy to get wrong, all checked: the Fire Resistance totem
// is a WATER totem and Frost Resistance a FIRE totem; the Windfury aura on the
// party is the "Windfury Totem Effect" (8514 … 25580), not the totem-side
// passive (8515 … 25582) and not the proc attack; Flametongue's party auras
// are 8230/8250/10521/15036/25554; Fire Nova has seven ranks; Mana Tide's buff
// is 16191. Searing Totem stands 30–60 s by rank; the table carries 60.

const SLOTS = ["air", "earth", "fire", "water"];

const TOTEMS = [
    // air
    { key: "windfury", name: "Windfury Totem", label: "Totem des Windzorns", slot: "air", castIds: [8512, 10613, 10614, 25585, 25587], buffIds: [8514, 10607, 10611, 25579, 25580], duration: 120, icon: "spell_nature_windfury" },
    { key: "graceOfAir", name: "Grace of Air Totem", label: "Totem der luftgleichen Anmut", slot: "air", castIds: [8835, 10627, 25359], buffIds: [8836, 10626, 25360], duration: 120, icon: "spell_nature_invisibilitytotem" },
    { key: "wrathOfAir", name: "Wrath of Air Totem", label: "Totem des stürmischen Zorns", slot: "air", castIds: [3738], buffIds: [2895], duration: 120, icon: "spell_nature_slowingtotem" },
    { key: "tranquilAir", name: "Tranquil Air Totem", label: "Totem der beruhigenden Winde", slot: "air", castIds: [25908], buffIds: [25909], duration: 120, icon: "spell_nature_brilliance" },
    { key: "windwall", name: "Windwall Totem", label: "Totem der Windmauer", slot: "air", castIds: [15107, 15111, 15112], buffIds: [15108, 15109, 15110], duration: 120, icon: "spell_nature_earthbind" },
    { key: "natureResistance", name: "Nature Resistance Totem", label: "Totem des Naturwiderstands", slot: "air", castIds: [10595, 10600, 10601, 25574], buffIds: [10596, 10598, 10599, 25573], duration: 120, icon: "spell_nature_natureresistancetotem" },
    // earth
    { key: "strengthOfEarth", name: "Strength of Earth Totem", label: "Totem der Erdstärke", slot: "earth", castIds: [8075, 8160, 8161, 10442, 25361, 25528], buffIds: [8076, 8162, 8163, 10441, 25362, 25527], duration: 120, icon: "spell_nature_earthbindtotem" },
    { key: "stoneskin", name: "Stoneskin Totem", label: "Totem der Steinhaut", slot: "earth", castIds: [8071, 8154, 8155, 10406, 10407, 10408, 25508, 25509], buffIds: [8072, 8156, 8157, 10403, 10404, 10405, 25506, 25507], duration: 120, icon: "spell_nature_stoneskintotem" },
    { key: "tremor", name: "Tremor Totem", label: "Totem des Erdstoßes", slot: "earth", castIds: [8143], buffIds: [], duration: 120, icon: "spell_nature_tremortotem" },
    { key: "earthbind", name: "Earthbind Totem", label: "Totem der Erdbindung", slot: "earth", castIds: [2484], buffIds: [], duration: 45, icon: "spell_nature_strengthofearthtotem02" },
    { key: "stoneclaw", name: "Stoneclaw Totem", label: "Totem der Steinklaue", slot: "earth", castIds: [5730, 6390, 6391, 6392, 10427, 10428, 25525], buffIds: [], duration: 15, icon: "spell_nature_stoneclawtotem" },
    { key: "earthElemental", name: "Earth Elemental Totem", label: "Totem des Erdelementars", slot: "earth", castIds: [2062], buffIds: [], duration: 120, icon: "spell_nature_earthelemental_totem" },
    // fire
    { key: "totemOfWrath", name: "Totem of Wrath", label: "Totem des Ingrimms", slot: "fire", castIds: [30706], buffIds: [30708], duration: 120, icon: "spell_fire_totemofwrath" },
    { key: "flametongue", name: "Flametongue Totem", label: "Totem der Flammenzunge", slot: "fire", castIds: [8227, 8249, 10526, 16387, 25557], buffIds: [8230, 8250, 10521, 15036, 25554], duration: 120, icon: "spell_nature_guardianward" },
    { key: "searing", name: "Searing Totem", label: "Totem der Verbrennung", slot: "fire", castIds: [3599, 6363, 6364, 6365, 10437, 10438, 25533], buffIds: [], duration: 60, icon: "spell_fire_searingtotem" },
    { key: "magma", name: "Magma Totem", label: "Totem des glühenden Magmas", slot: "fire", castIds: [8190, 10585, 10586, 10587, 25552], buffIds: [], duration: 20, icon: "spell_fire_selfdestruct" },
    { key: "fireNova", name: "Fire Nova Totem", label: "Totem der Feuernova", slot: "fire", castIds: [1535, 8498, 8499, 11314, 11315, 25546, 25547], buffIds: [], duration: 5, icon: "spell_fire_sealoffire" },
    { key: "frostResistance", name: "Frost Resistance Totem", label: "Totem des Frostwiderstands", slot: "fire", castIds: [8181, 10478, 10479, 25560], buffIds: [8182, 10476, 10477, 25559], duration: 120, icon: "spell_frostresistancetotem_01" },
    { key: "fireElemental", name: "Fire Elemental Totem", label: "Totem des Feuerelementars", slot: "fire", castIds: [2894], buffIds: [], duration: 120, icon: "spell_fire_elemental_totem" },
    // water
    { key: "manaSpring", name: "Mana Spring Totem", label: "Totem der Manaquelle", slot: "water", castIds: [5675, 10495, 10496, 10497, 25570], buffIds: [5677, 10491, 10493, 10494, 25569], duration: 120, icon: "spell_nature_manaregentotem" },
    { key: "healingStream", name: "Healing Stream Totem", label: "Totem des heilenden Flusses", slot: "water", castIds: [5394, 6375, 6377, 10462, 10463, 25567], buffIds: [5672, 6371, 6372, 10460, 10461, 25566], duration: 120, icon: "inv_spear_04" },
    { key: "manaTide", name: "Mana Tide Totem", label: "Totem der Manaflut", slot: "water", castIds: [16190], buffIds: [16191], duration: 12, icon: "spell_frost_summonwaterelemental" },
    { key: "fireResistance", name: "Fire Resistance Totem", label: "Totem des Feuerwiderstands", slot: "water", castIds: [8184, 10537, 10538, 25563], buffIds: [8185, 10534, 10535, 25562], duration: 120, icon: "spell_fireresistancetotem_01" },
    { key: "poisonCleansing", name: "Poison Cleansing Totem", label: "Totem der Giftreinigung", slot: "water", castIds: [8166], buffIds: [], duration: 120, icon: "spell_nature_poisoncleansingtotem" },
    { key: "diseaseCleansing", name: "Disease Cleansing Totem", label: "Totem der Krankheitsreinigung", slot: "water", castIds: [8170], buffIds: [], duration: 120, icon: "spell_nature_diseasecleansingtotem" },
];

const BY_CAST = new Map();
const BY_BUFF = new Map();
for (const t of TOTEMS) {
    for (const id of t.castIds) BY_CAST.set(String(id), t);
    for (const id of t.buffIds) BY_BUFF.set(String(id), t);
}

/** The totem a cast spell id (any rank) belongs to, or null. */
function totemByCast(guid) {
    if (guid === undefined || guid === null) return null;
    return BY_CAST.get(String(guid)) || null;
}

/** The totem a party-buff aura id (any rank) belongs to, or null. */
function totemByBuff(guid) {
    if (guid === undefined || guid === null) return null;
    return BY_BUFF.get(String(guid)) || null;
}

module.exports = { TOTEMS, SLOTS, totemByCast, totemByBuff };
