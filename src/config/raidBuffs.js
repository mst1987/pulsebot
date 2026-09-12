// Raid buffs on the players — the class buffs a raid puts on its own members,
// as opposed to the debuffs it puts on the boss (raidDebuffs.js) and the
// consumables a raider brings themselves (claData.js).
//
// Every spell id of every TBC 2.4.3 rank, single-target and group version
// alike, verified against Wowhead's TBC database
// (nether.wowhead.com/tbc/tooltip/spell/<id>). The buff table of a log
// carries the aura id, so a Gift of the Wild counts exactly like a Mark of
// the Wild. Fel Intelligence is deliberately absent: the felhunter only got
// it with WotLK (54424); in 2.4.3 there is no such aura.
//
// `roles` says who a buff is worth having on — Might on a warrior, Wisdom on
// a priest, never the other way round. The four roles are tank, healer,
// melee (physical dps incl. hunters) and caster; `classes` widens a buff to
// classes that want it in any role (a hunter, enhancer or retribution paladin
// runs on mana and takes Wisdom although they are "melee").
//
// `expect` says when a missing buff is a finding:
//   "blessing" — one blessing per paladin in the raid: the paladins limit how
//                many a player can carry, `priority` orders which ones (Kings
//                first, then the role's own, Salvation third);
//   "class"    — as soon as the providing class raided in that fight;
//   "majority" — once at least half of the players it is meant for had it in
//                that fight (Shadow Protection is a Shahraz thing, Thorns is
//                a raid's own habit — the raid, not the table, decides);
//   "never"    — party-bound or self-only, shown when present, never a finding.
//
// `neverWrong` marks a blessing that is usual on every role in TBC although
// only one role really wants it: Light sits on the whole raid wherever a
// paladin has a free blessing, Sanctuary lands on off-tanks WCL lists as dps.
// Such a blessing counts as present (and fills a blessing slot on any role);
// it is never reported as "on the wrong role".
//
// `ids` holds every rank of the single AND the group version (Greater
// Blessings, Prayers, Gift of the Wild, Arcane Brilliance) — both resolve to
// the same buff, a raid that casts the group version is never asked for the
// single one. `groupIds` names the group ranks among them and `groupLabel` the
// group spell, so the page can say "Mal / Gabe der Wildnis".

const ROLES = ["tank", "healer", "melee", "caster"];
const ROLE_LABELS = { tank: "Tank", healer: "Heiler", melee: "Nahkampf", caster: "Caster" };
const ALL = [...ROLES];
const MANA_MELEE = ["Hunter", "Shaman", "Paladin"];

const BUFFS = [
    // paladin blessings — one per paladin, the greater version lasts 30 min
    { key: "kings", name: "Blessing of Kings", label: "Segen der Könige", ids: [20217, 25898], groupIds: [25898], groupLabel: "Großer Segen der Könige", provider: "Paladin", icon: "spell_magic_greaterblessingofkings", group: "blessing", roles: ALL, priority: 1, expect: "blessing" },
    { key: "might", name: "Blessing of Might", label: "Segen der Macht", ids: [19740, 19834, 19835, 19836, 19837, 19838, 25291, 27140, 25782, 25916, 27141], groupIds: [25782, 25916, 27141], groupLabel: "Großer Segen der Macht", provider: "Paladin", icon: "spell_holy_fistofjustice", group: "blessing", roles: ["tank", "melee"], priority: 2, expect: "blessing" },
    { key: "wisdom", name: "Blessing of Wisdom", label: "Segen der Weisheit", ids: [19742, 19850, 19852, 19853, 19854, 25290, 27142, 25894, 25918, 27143], groupIds: [25894, 25918, 27143], groupLabel: "Großer Segen der Weisheit", provider: "Paladin", icon: "spell_holy_sealofwisdom", group: "blessing", roles: ["healer", "caster"], classes: MANA_MELEE, priority: 2, expect: "blessing" },
    { key: "salvation", name: "Blessing of Salvation", label: "Segen der Rettung", ids: [1038, 25895], groupIds: [25895], groupLabel: "Großer Segen der Rettung", provider: "Paladin", icon: "spell_holy_sealofsalvation", group: "blessing", roles: ["healer", "melee", "caster"], priority: 3, expect: "blessing" },
    { key: "sanctuary", name: "Blessing of Sanctuary", label: "Segen des Refugiums", ids: [20911, 20912, 20913, 20914, 27168, 25899, 27169], groupIds: [25899, 27169], groupLabel: "Großer Segen des Refugiums", provider: "Paladin", icon: "spell_nature_lightningshield", group: "blessing", roles: ["tank"], priority: 3, expect: "blessing", neverWrong: true },
    { key: "light", name: "Blessing of Light", label: "Segen des Lichts", ids: [19977, 19978, 19979, 27144, 25890, 27145], groupIds: [25890, 27145], groupLabel: "Großer Segen des Lichts", provider: "Paladin", icon: "spell_holy_prayerofhealing02", group: "blessing", roles: ["tank"], priority: 4, expect: "blessing", neverWrong: true },
    // priest
    { key: "fortitude", name: "Power Word: Fortitude", label: "Machtwort: Seelenstärke", ids: [1243, 1244, 1245, 2791, 10937, 10938, 25389, 21562, 21564, 25392], groupIds: [21562, 21564, 25392], groupLabel: "Gebet der Seelenstärke", provider: "Priest", icon: "spell_holy_wordfortitude", group: "stats", roles: ALL, expect: "class" },
    { key: "spirit", name: "Divine Spirit", label: "Göttlicher Willen", ids: [14752, 14818, 14819, 27841, 27681, 32999], groupIds: [27681, 32999], groupLabel: "Gebet des Willens", provider: "Priest", icon: "spell_holy_divinespirit", group: "stats", roles: ["healer", "caster"], expect: "majority" },
    { key: "shadowProt", name: "Shadow Protection", label: "Schattenschutz", ids: [976, 10957, 10958, 25433, 27683, 39374], groupIds: [27683, 39374], groupLabel: "Gebet des Schattenschutzes", provider: "Priest", icon: "spell_shadow_antishadow", group: "protection", roles: ALL, expect: "majority" },
    // druid
    { key: "motw", name: "Mark of the Wild", label: "Mal der Wildnis", ids: [1126, 5232, 6756, 5234, 8907, 9884, 9885, 26990, 21849, 21850, 26991], groupIds: [21849, 21850, 26991], groupLabel: "Gabe der Wildnis", provider: "Druid", icon: "spell_nature_regeneration", group: "stats", roles: ALL, expect: "class" },
    { key: "thorns", name: "Thorns", label: "Dornen", ids: [467, 782, 1075, 8914, 9756, 9910, 26992], provider: "Druid", icon: "spell_nature_thorns", group: "protection", roles: ["tank"], expect: "majority" },
    // mage
    { key: "intellect", name: "Arcane Intellect", label: "Arkane Intelligenz", ids: [1459, 1460, 1461, 10156, 10157, 27126, 23028, 27127], groupIds: [23028, 27127], groupLabel: "Arkane Brillanz", provider: "Mage", icon: "spell_holy_magicalsentry", group: "stats", roles: ["healer", "caster"], classes: MANA_MELEE, expect: "class" },
    // shaman — Earth Shield is judged by the healer analysis (healerSpells.js), here only shown
    { key: "earthShield", name: "Earth Shield", label: "Erdschild", ids: [974, 32593, 32594], provider: "Shaman", icon: "spell_nature_skinofearth", group: "shield", roles: ["tank"], expect: "never" },
    { key: "waterShield", name: "Water Shield", label: "Wasserschild", ids: [24398, 33736], provider: "Shaman", icon: "ability_shaman_watershield", group: "shield", roles: ["healer", "caster"], expect: "never" },
    // warlock (imp, party only)
    { key: "bloodPact", name: "Blood Pact", label: "Blutpakt", ids: [6307, 7804, 7805, 11766, 11767, 27268], provider: "Warlock", icon: "spell_shadow_bloodboil", group: "party", roles: ALL, expect: "never" },
    // party auras and shouts — bound to the group, so never a finding for the raid
    { key: "heroicPresence", name: "Heroic Presence", label: "Heroische Präsenz", ids: [6562], provider: "Draenei", icon: "inv_helmet_21", group: "party", roles: ["tank", "melee"], expect: "never" },
    { key: "inspiringPresence", name: "Inspiring Presence", label: "Inspirierende Präsenz", ids: [28878], provider: "Draenei", icon: "inv_helmet_21", group: "party", roles: ["healer", "caster"], expect: "never" },
    { key: "trueshot", name: "Trueshot Aura", label: "Aura des Volltreffers", ids: [19506, 20905, 20906, 27066], provider: "Hunter", icon: "ability_trueshot", group: "party", roles: ["tank", "melee"], expect: "never" },
    { key: "lotp", name: "Leader of the Pack", label: "Anführer des Rudels", ids: [24932], provider: "Druid", icon: "spell_nature_unyeildingstamina", group: "party", roles: ["tank", "melee"], expect: "never" },
    { key: "moonkinAura", name: "Moonkin Aura", label: "Moonkinaura", ids: [24907], provider: "Druid", icon: "spell_nature_moonglow", group: "party", roles: ["healer", "caster"], expect: "never" },
    { key: "sanctityAura", name: "Sanctity Aura", label: "Aura der Heiligkeit", ids: [20218], provider: "Paladin", icon: "spell_holy_mindvision", group: "party", roles: ["tank", "melee"], expect: "never" },
    { key: "battleShout", name: "Battle Shout", label: "Schlachtruf", ids: [6673, 5242, 6192, 11549, 11550, 11551, 25289, 2048], provider: "Warrior", icon: "ability_warrior_battleshout", group: "party", roles: ["tank", "melee"], expect: "never" },
    { key: "commandingShout", name: "Commanding Shout", label: "Befehlsruf", ids: [469], provider: "Warrior", icon: "ability_warrior_rallyingcry", group: "party", roles: ALL, expect: "never" },
];

const GROUPS = {
    blessing: "Segen",
    stats: "Werte",
    protection: "Schutz",
    shield: "Schilde",
    party: "Gruppe",
};

const BLESSINGS = BUFFS.filter((b) => b.expect === "blessing").sort((a, b) => a.priority - b.priority);

const BY_ID = new Map();
for (const b of BUFFS) {
    for (const id of b.ids) BY_ID.set(String(id), b);
}
const BY_KEY = new Map(BUFFS.map((b) => [b.key, b]));

/** The buff definition an aura guid (any rank, single or group version) belongs to, or null. */
function buffByGuid(guid) {
    if (guid === undefined || guid === null) return null;
    return BY_ID.get(String(guid)) || null;
}

/** The buff definition by key, or null. */
function buffByKey(key) {
    return BY_KEY.get(key) || null;
}

/**
 * Whether a buff is worth having on this player: their role is in the buff's
 * roles, or their class wants it in any role.
 *
 * @param {object} def   a BUFFS entry
 * @param {{ type: string, role: string }} player
 */
function buffFits(def, player) {
    if (!def || !player) return false;
    if ((def.roles || []).includes(player.role)) return true;
    return (def.classes || []).includes(player.type);
}

/**
 * The blessings this player should carry, in priority order, given how many
 * paladins raided: at most one per paladin, Kings first. No paladin — no
 * blessing expected; one paladin — Kings only, the missing second one is not
 * a finding.
 *
 * @returns {Array<object>} BUFFS entries
 */
function expectedBlessings(player, paladins) {
    const n = Math.max(0, Number(paladins) || 0);
    if (n === 0) return [];
    return BLESSINGS.filter((b) => buffFits(b, player)).slice(0, n);
}

module.exports = { BUFFS, BLESSINGS, GROUPS, ROLES, ROLE_LABELS, buffByGuid, buffByKey, buffFits, expectedBlessings };
