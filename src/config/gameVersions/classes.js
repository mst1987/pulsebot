// The classes and specs of the pre-Wrath rule sets (Classic Era, TBC Anniversary
// and WoW Forever share the same nine classes and talent trees).
//
// A spec's key is `"<Class>-<Spec>"` in Warcraft Logs' own spelling — the same
// key config/casterSpecs.js uses — so a spec from a log, from the loot council
// and from the rule set are one and the same string.
//
// `role` is what a setup counts a raider as: tank / healer / melee / ranged.
// `buffRole` is the vocabulary of config/raidBuffs.js (tank / healer / melee /
// caster), which sorts by damage type rather than by range: a hunter is "melee"
// there because Might and Trueshot are worth having on him, a shadow priest a
// "caster". The two differ on purpose; `role` places a raider, `buffRole` says
// which buffs they want.
//
// `canTank` / `canHeal` say what a spec can step in as, beyond its own role —
// a feral druid tanks in bear form, a protection paladin is a tank to begin
// with. Only the spec decides; that a fury warrior *could* put on a shield is
// the raider's profile's business (#255), not the rule set's.

const CLASSES = [
    {
        id: "Warrior", label: "Krieger", color: "#C79C6E", icon: "classicon_warrior",
        specs: [
            { id: "Arms", label: "Waffen", role: "melee", buffRole: "melee", icon: "ability_warrior_savageblow" },
            { id: "Fury", label: "Furor", role: "melee", buffRole: "melee", icon: "ability_warrior_innerrage" },
            { id: "Protection", label: "Schutz", role: "tank", buffRole: "tank", icon: "ability_warrior_defensivestance", canTank: true },
        ],
    },
    {
        id: "Paladin", label: "Paladin", color: "#F58CBA", icon: "classicon_paladin",
        specs: [
            { id: "Holy", label: "Heilig", role: "healer", buffRole: "healer", icon: "spell_holy_holybolt", canHeal: true },
            { id: "Protection", label: "Schutz", role: "tank", buffRole: "tank", icon: "spell_holy_devotionaura", canTank: true },
            { id: "Retribution", label: "Vergeltung", role: "melee", buffRole: "melee", icon: "spell_holy_auraoflight" },
        ],
    },
    {
        id: "Hunter", label: "Jäger", color: "#ABD473", icon: "classicon_hunter",
        specs: [
            { id: "BeastMastery", label: "Tierherrschaft", role: "ranged", buffRole: "melee", icon: "ability_hunter_beasttaming" },
            { id: "Marksmanship", label: "Treffsicherheit", role: "ranged", buffRole: "melee", icon: "ability_hunter_focusedaim" },
            { id: "Survival", label: "Überleben", role: "ranged", buffRole: "melee", icon: "ability_hunter_swiftstrike" },
        ],
    },
    {
        id: "Rogue", label: "Schurke", color: "#FFF569", icon: "classicon_rogue",
        specs: [
            { id: "Assassination", label: "Meucheln", role: "melee", buffRole: "melee", icon: "ability_rogue_eviscerate" },
            { id: "Combat", label: "Kampf", role: "melee", buffRole: "melee", icon: "ability_backstab" },
            { id: "Subtlety", label: "Täuschung", role: "melee", buffRole: "melee", icon: "ability_stealth" },
        ],
    },
    {
        id: "Priest", label: "Priester", color: "#FFFFFF", icon: "classicon_priest",
        specs: [
            { id: "Discipline", label: "Disziplin", role: "healer", buffRole: "healer", icon: "spell_holy_powerwordshield", canHeal: true },
            { id: "Holy", label: "Heilig", role: "healer", buffRole: "healer", icon: "spell_holy_holynova", canHeal: true },
            { id: "Shadow", label: "Schatten", role: "ranged", buffRole: "caster", icon: "spell_shadow_shadowwordpain" },
        ],
    },
    {
        id: "Shaman", label: "Schamane", color: "#0070DE", icon: "classicon_shaman",
        specs: [
            { id: "Elemental", label: "Elementar", role: "ranged", buffRole: "caster", icon: "spell_nature_lightning" },
            { id: "Enhancement", label: "Verstärkung", role: "melee", buffRole: "melee", icon: "spell_nature_lightningshield" },
            { id: "Restoration", label: "Wiederherstellung", role: "healer", buffRole: "healer", icon: "spell_nature_magicimmunity", canHeal: true },
        ],
    },
    {
        id: "Mage", label: "Magier", color: "#69CCF0", icon: "classicon_mage",
        specs: [
            { id: "Arcane", label: "Arkan", role: "ranged", buffRole: "caster", icon: "spell_holy_magicalsentry" },
            { id: "Fire", label: "Feuer", role: "ranged", buffRole: "caster", icon: "spell_fire_firebolt02" },
            { id: "Frost", label: "Frost", role: "ranged", buffRole: "caster", icon: "spell_frost_frostbolt02" },
        ],
    },
    {
        id: "Warlock", label: "Hexenmeister", color: "#9482C9", icon: "classicon_warlock",
        specs: [
            { id: "Affliction", label: "Gebrechen", role: "ranged", buffRole: "caster", icon: "spell_shadow_deathcoil" },
            { id: "Demonology", label: "Dämonologie", role: "ranged", buffRole: "caster", icon: "spell_shadow_metamorphosis" },
            { id: "Destruction", label: "Zerstörung", role: "ranged", buffRole: "caster", icon: "spell_shadow_rainoffire" },
        ],
    },
    {
        id: "Druid", label: "Druide", color: "#FF7D0A", icon: "classicon_druid",
        specs: [
            { id: "Balance", label: "Gleichgewicht", role: "ranged", buffRole: "caster", icon: "spell_nature_starfall" },
            // Raid-Helper keeps cat and bear apart; the talent tree is one.
            { id: "Feral", label: "Wilder Kampf (Katze)", role: "melee", buffRole: "melee", icon: "ability_druid_catform", canTank: true },
            { id: "Guardian", label: "Wilder Kampf (Bär)", role: "tank", buffRole: "tank", icon: "ability_racial_bearform", canTank: true },
            { id: "Restoration", label: "Wiederherstellung", role: "healer", buffRole: "healer", icon: "spell_nature_healingtouch", canHeal: true },
        ],
    },
];

const ROLES = ["tank", "healer", "melee", "ranged"];
const ROLE_LABELS = { tank: "Tank", healer: "Heiler", melee: "Nahkampf", ranged: "Fernkampf" };

/**
 * The class list in its served shape: every spec carries its full key, its
 * class and explicit `canTank`/`canHeal` booleans (a tank spec can tank, a
 * healer spec can heal, whatever else is set).
 */
function buildClasses(classes = CLASSES) {
    return classes.map((c) => ({
        ...c,
        specs: c.specs.map((s) => ({
            ...s,
            key: `${c.id}-${s.id}`,
            classId: c.id,
            canTank: s.role === "tank" || !!s.canTank,
            canHeal: s.role === "healer" || !!s.canHeal,
        })),
    }));
}

module.exports = { CLASSES, ROLES, ROLE_LABELS, buildClasses };
