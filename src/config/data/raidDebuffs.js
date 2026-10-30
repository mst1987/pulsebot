// Raid debuffs on the boss — the auras the raid puts on its target, not the
// boss mechanics that land on players (those are rpbData.DEBUFFS).
//
// Every spell id of every TBC 2.4.3 rank, verified against Wowhead's TBC
// database (nether.wowhead.com/tbc/tooltip/spell/<id>). Talent procs carry the
// *aura* id, which differs from the talent: Shadow Weaving lands 15258, Improved
// Shadow Bolt 17800, Improved Scorch 22959, Expose Weakness 34501.
//
// `expect` says when the raid should have had a debuff:
//   "class" — as soon as the providing class raided (a warlock means Curse of
//             the Elements, a hunter means Hunter's Mark);
//   "seen"  — only once it landed somewhere in the log, because it needs a
//             spec the roster does not reveal (Misery proves a shadow priest);
//   "never" — worth showing when present, never a finding when absent.
// `exclusive` groups overwrite each other in-game (Expose Armor replaces Sunder,
// a paladin judges one seal), so one present member covers the whole group.

const DEBUFFS = [
    // armour
    { key: "sunder", name: "Sunder Armor", label: "Rüstung zerreißen", ids: [7386, 7405, 8380, 11596, 11597, 25225], stacks: 5, provider: "Warrior", spec: "", icon: "ability_warrior_sunder", group: "armor", exclusive: true, expect: "class" },
    { key: "expose", name: "Expose Armor", label: "Rüstung schwächen", ids: [8647, 8649, 8650, 11197, 11198, 26866], stacks: 0, provider: "Rogue", spec: "", icon: "ability_warrior_riposte", group: "armor", exclusive: true, expect: "class" },
    { key: "ff", name: "Faerie Fire", label: "Feenfeuer", ids: [770, 778, 9749, 9907, 26993], stacks: 0, provider: "Druid", spec: "", icon: "spell_nature_faeriefire", group: "faerie", exclusive: true, expect: "class" },
    { key: "ffFeral", name: "Faerie Fire (Feral)", label: "Feenfeuer (Tiergestalt)", ids: [16857, 17390, 17391, 17392, 27011], stacks: 0, provider: "Druid", spec: "Feral", icon: "spell_nature_faeriefire", group: "faerie", exclusive: true, expect: "class" },
    // spell damage
    { key: "coe", name: "Curse of the Elements", label: "Fluch der Elemente", ids: [1490, 11721, 11722, 27228], stacks: 0, provider: "Warlock", spec: "", icon: "spell_shadow_chilltouch", group: "spell", exclusive: false, expect: "class" },
    { key: "cos", name: "Curse of Shadow", label: "Fluch der Schatten", ids: [17862, 17937, 27229], stacks: 0, provider: "Warlock", spec: "", icon: "spell_shadow_curseofachimonde", group: "spell", exclusive: false, expect: "seen" },
    { key: "misery", name: "Misery", label: "Elend", ids: [33196, 33197, 33198, 33199, 33200], stacks: 0, provider: "Priest", spec: "Shadow", icon: "spell_shadow_misery", group: "spell", exclusive: false, expect: "seen" },
    { key: "shadowWeaving", name: "Shadow Weaving", label: "Schattenverwundbarkeit", ids: [15258], stacks: 5, provider: "Priest", spec: "Shadow", icon: "spell_shadow_blackplague", group: "spell", exclusive: false, expect: "seen" },
    { key: "isb", name: "Improved Shadow Bolt", label: "Schattenverwundbarkeit (Schattenblitz)", ids: [17800], stacks: 4, provider: "Warlock", spec: "", icon: "spell_shadow_shadowbolt", group: "spell", exclusive: false, expect: "seen" },
    { key: "impScorch", name: "Improved Scorch", label: "Feuerverwundbarkeit", ids: [22959], stacks: 5, provider: "Mage", spec: "Fire", icon: "spell_fire_soulburn", group: "spell", exclusive: false, expect: "seen" },
    { key: "wintersChill", name: "Winter's Chill", label: "Winterkälte", ids: [12579], stacks: 5, provider: "Mage", spec: "Frost", icon: "spell_frost_chillingblast", group: "spell", exclusive: false, expect: "seen" },
    // physical damage
    { key: "bloodFrenzy", name: "Blood Frenzy", label: "Blutraserei", ids: [30069, 30070], stacks: 0, provider: "Warrior", spec: "Arms", icon: "ability_warrior_bloodfrenzy", group: "physical", exclusive: false, expect: "seen" },
    { key: "mangle", name: "Mangle", label: "Zerfleischen", ids: [33876, 33982, 33983, 33878, 33986, 33987], stacks: 0, provider: "Druid", spec: "Feral", icon: "ability_druid_mangle2", group: "physical", exclusive: false, expect: "seen" },
    { key: "huntersMark", name: "Hunter's Mark", label: "Mal des Jägers", ids: [1130, 14323, 14324, 14325], stacks: 0, provider: "Hunter", spec: "", icon: "ability_hunter_snipershot", group: "physical", exclusive: false, expect: "class" },
    { key: "exposeWeakness", name: "Expose Weakness", label: "Schwäche aufdecken", ids: [34501], stacks: 0, provider: "Hunter", spec: "Survival", icon: "ability_rogue_findweakness", group: "physical", exclusive: false, expect: "seen" },
    { key: "recklessness", name: "Curse of Recklessness", label: "Fluch der Tollkühnheit", ids: [704, 7658, 7659, 11717, 27226], stacks: 0, provider: "Warlock", spec: "", icon: "spell_shadow_unholystrength", group: "physical", exclusive: false, expect: "never" },
    // judgements — one paladin judges one seal, so any one of them covers the group
    { key: "jow", name: "Judgement of Wisdom", label: "Richturteil der Weisheit", ids: [20186, 20354, 20355, 27164], stacks: 0, provider: "Paladin", spec: "", icon: "spell_holy_righteousnessaura", group: "judgement", exclusive: true, expect: "class" },
    { key: "jol", name: "Judgement of Light", label: "Richturteil des Lichts", ids: [20185, 20344, 20345, 20346, 27162], stacks: 0, provider: "Paladin", spec: "", icon: "spell_holy_healingaura", group: "judgement", exclusive: true, expect: "class" },
    { key: "joc", name: "Judgement of the Crusader", label: "Richturteil des Kreuzfahrers", ids: [20188, 20300, 20301, 20302, 20303, 27159], stacks: 0, provider: "Paladin", spec: "", icon: "spell_holy_holysmite", group: "judgement", exclusive: true, expect: "class" },
    // mitigation
    { key: "thunderClap", name: "Thunder Clap", label: "Donnerknall", ids: [6343, 8198, 8204, 8205, 11580, 11581, 25264], stacks: 0, provider: "Warrior", spec: "", icon: "spell_nature_thunderclap", group: "mitigation", exclusive: false, expect: "seen" },
    { key: "demoShout", name: "Demoralizing Shout", label: "Demoralisierender Ruf", ids: [1160, 6190, 11554, 11555, 11556, 25202, 25203], stacks: 0, provider: "Warrior", spec: "", icon: "ability_warrior_warcry", group: "demoralize", exclusive: true, expect: "class" },
    { key: "demoRoar", name: "Demoralizing Roar", label: "Demoralisierendes Gebrüll", ids: [99, 1735, 9490, 9747, 9898, 26998], stacks: 0, provider: "Druid", spec: "", icon: "classic_ability_druid_demoralizingroar", group: "demoralize", exclusive: true, expect: "class" },
    { key: "screech", name: "Screech", label: "Schrei", ids: [24423, 24577, 24578, 24579, 27051], stacks: 0, provider: "Hunter", spec: "Pet", icon: "ability_hunter_pet_bat", group: "mitigation", exclusive: false, expect: "never" },
    { key: "insectSwarm", name: "Insect Swarm", label: "Insektenschwarm", ids: [5570, 24974, 24975, 24976, 24977, 27013], stacks: 0, provider: "Druid", spec: "Balance", icon: "spell_nature_insectswarm", group: "mitigation", exclusive: false, expect: "never" },
    { key: "scorpidSting", name: "Scorpid Sting", label: "Skorpidstich", ids: [3043], stacks: 0, provider: "Hunter", spec: "", icon: "ability_hunter_criticalshot", group: "mitigation", exclusive: false, expect: "never" },
];

const GROUPS = {
    armor: "Rüstung",
    faerie: "Feenfeuer",
    spell: "Zauberschaden",
    physical: "Physischer Schaden",
    judgement: "Richturteile",
    demoralize: "Demoralisieren",
    mitigation: "Schadensminderung",
};

const BY_ID = new Map();
for (const d of DEBUFFS) {
    for (const id of d.ids) BY_ID.set(String(id), d);
}

/** The debuff definition an aura guid (any rank) belongs to, or null. */
function debuffByGuid(guid) {
    if (guid === undefined || guid === null) return null;
    return BY_ID.get(String(guid)) || null;
}

/**
 * Which debuffs the raid should have had, from who raided and what landed.
 *
 * @param {Object<string, number>} classCounts  class → number of raiders
 * @param {Set<string>} seen  debuff keys that landed anywhere in the log
 * @returns {Set<string>}
 */
function expectedDebuffs(classCounts, seen) {
    const out = new Set();
    for (const d of DEBUFFS) {
        if (!(classCounts[d.provider] > 0)) continue;
        if (d.expect === "class") out.add(d.key);
        else if (d.expect === "seen" && seen && seen.has(d.key)) out.add(d.key);
    }
    return out;
}

module.exports = { DEBUFFS, GROUPS, debuffByGuid, expectedDebuffs };
