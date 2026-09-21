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
        id: "Warrior", label: "Krieger", labelEn: "Warrior", color: "#C79C6E", icon: "classicon_warrior",
        specs: [
            { id: "Arms", label: "Waffen", labelEn: "Arms", role: "melee", buffRole: "melee", icon: "ability_warrior_savageblow" },
            { id: "Fury", label: "Furor", labelEn: "Fury", role: "melee", buffRole: "melee", icon: "ability_warrior_innerrage" },
            { id: "Protection", label: "Schutz", labelEn: "Protection", role: "tank", buffRole: "tank", icon: "ability_warrior_defensivestance", canTank: true },
        ],
    },
    {
        id: "Paladin", label: "Paladin", labelEn: "Paladin", color: "#F58CBA", icon: "classicon_paladin",
        specs: [
            { id: "Holy", label: "Heilig", labelEn: "Holy", role: "healer", buffRole: "healer", icon: "spell_holy_holybolt", canHeal: true },
            { id: "Protection", label: "Schutz", labelEn: "Protection", role: "tank", buffRole: "tank", icon: "spell_holy_devotionaura", canTank: true },
            { id: "Retribution", label: "Vergeltung", labelEn: "Retribution", role: "melee", buffRole: "melee", icon: "spell_holy_auraoflight" },
        ],
    },
    {
        id: "Hunter", label: "Jäger", labelEn: "Hunter", color: "#ABD473", icon: "classicon_hunter",
        specs: [
            { id: "BeastMastery", label: "Tierherrschaft", labelEn: "Beast Mastery", role: "ranged", buffRole: "melee", icon: "ability_hunter_beasttaming" },
            { id: "Marksmanship", label: "Treffsicherheit", labelEn: "Marksmanship", role: "ranged", buffRole: "melee", icon: "ability_hunter_focusedaim" },
            { id: "Survival", label: "Überleben", labelEn: "Survival", role: "ranged", buffRole: "melee", icon: "ability_hunter_swiftstrike" },
        ],
    },
    {
        id: "Rogue", label: "Schurke", labelEn: "Rogue", color: "#FFF569", icon: "classicon_rogue",
        specs: [
            { id: "Assassination", label: "Meucheln", labelEn: "Assassination", role: "melee", buffRole: "melee", icon: "ability_rogue_eviscerate" },
            { id: "Combat", label: "Kampf", labelEn: "Combat", role: "melee", buffRole: "melee", icon: "ability_backstab" },
            { id: "Subtlety", label: "Täuschung", labelEn: "Subtlety", role: "melee", buffRole: "melee", icon: "ability_stealth" },
        ],
    },
    {
        id: "Priest", label: "Priester", labelEn: "Priest", color: "#FFFFFF", icon: "classicon_priest",
        specs: [
            { id: "Discipline", label: "Disziplin", labelEn: "Discipline", role: "healer", buffRole: "healer", icon: "spell_holy_powerwordshield", canHeal: true },
            { id: "Holy", label: "Heilig", labelEn: "Holy", role: "healer", buffRole: "healer", icon: "spell_holy_holynova", canHeal: true },
            { id: "Shadow", label: "Schatten", labelEn: "Shadow", role: "ranged", buffRole: "caster", icon: "spell_shadow_shadowwordpain" },
        ],
    },
    {
        id: "Shaman", label: "Schamane", labelEn: "Shaman", color: "#0070DE", icon: "classicon_shaman",
        specs: [
            { id: "Elemental", label: "Elementar", labelEn: "Elemental", role: "ranged", buffRole: "caster", icon: "spell_nature_lightning" },
            { id: "Enhancement", label: "Verstärkung", labelEn: "Enhancement", role: "melee", buffRole: "melee", icon: "spell_nature_lightningshield" },
            { id: "Restoration", label: "Wiederherstellung", labelEn: "Restoration", role: "healer", buffRole: "healer", icon: "spell_nature_magicimmunity", canHeal: true },
        ],
    },
    {
        id: "Mage", label: "Magier", labelEn: "Mage", color: "#69CCF0", icon: "classicon_mage",
        specs: [
            { id: "Arcane", label: "Arkan", labelEn: "Arcane", role: "ranged", buffRole: "caster", icon: "spell_holy_magicalsentry" },
            { id: "Fire", label: "Feuer", labelEn: "Fire", role: "ranged", buffRole: "caster", icon: "spell_fire_firebolt02" },
            { id: "Frost", label: "Frost", labelEn: "Frost", role: "ranged", buffRole: "caster", icon: "spell_frost_frostbolt02" },
        ],
    },
    {
        id: "Warlock", label: "Hexenmeister", labelEn: "Warlock", color: "#9482C9", icon: "classicon_warlock",
        specs: [
            { id: "Affliction", label: "Gebrechen", labelEn: "Affliction", role: "ranged", buffRole: "caster", icon: "spell_shadow_deathcoil" },
            { id: "Demonology", label: "Dämonologie", labelEn: "Demonology", role: "ranged", buffRole: "caster", icon: "spell_shadow_metamorphosis" },
            { id: "Destruction", label: "Zerstörung", labelEn: "Destruction", role: "ranged", buffRole: "caster", icon: "spell_shadow_rainoffire" },
        ],
    },
    {
        id: "Druid", label: "Druide", labelEn: "Druid", color: "#FF7D0A", icon: "classicon_druid",
        specs: [
            { id: "Balance", label: "Gleichgewicht", labelEn: "Balance", role: "ranged", buffRole: "caster", icon: "spell_nature_starfall" },
            // Raid-Helper keeps cat and bear apart; the talent tree is one.
            { id: "Feral", label: "Wilder Kampf (Katze)", labelEn: "Feral (Cat)", role: "melee", buffRole: "melee", icon: "ability_druid_catform", canTank: true },
            { id: "Guardian", label: "Wilder Kampf (Bär)", labelEn: "Feral (Bear)", role: "tank", buffRole: "tank", icon: "ability_racial_bearform", canTank: true },
            { id: "Restoration", label: "Wiederherstellung", labelEn: "Restoration", role: "healer", buffRole: "healer", icon: "spell_nature_healingtouch", canHeal: true },
        ],
    },
];

const ROLES = ["tank", "healer", "melee", "ranged"];
const ROLE_LABELS = { tank: "Tank", healer: "Heiler", melee: "Nahkampf", ranged: "Fernkampf" };
// The same in English, for everything a raider reads in Discord (the bot's
// event message, signup dialogs, pings). `label` stays the German one the web
// admin shows; `labelEn` on every class and spec is its English counterpart.
const ROLE_LABELS_EN = { tank: "Tank", healer: "Healer", melee: "Melee", ranged: "Ranged" };

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

/** The English label of a class (by id) or of a spec (by key "Priest-Shadow"); "" when unknown. */
function labelEnOf(idOrKey) {
    const [classId, specId] = String(idOrKey || "").split("-");
    const cls = CLASSES.find((c) => c.id === classId);
    if (!cls) return "";
    if (!specId) return cls.labelEn;
    const spec = cls.specs.find((sp) => sp.id === specId);
    return spec ? spec.labelEn : "";
}

module.exports = { CLASSES, ROLES, ROLE_LABELS, ROLE_LABELS_EN, buildClasses, labelEnOf };
