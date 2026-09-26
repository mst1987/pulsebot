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
            { id: "Survival", label: "Überleben", labelEn: "Survival", role: "ranged", buffRole: "melee", icon: "ability_hunter_camouflage" },
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
            { id: "Holy", label: "Heilig", labelEn: "Holy", role: "healer", buffRole: "healer", icon: "spell_holy_guardianspirit", canHeal: true },
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

// Classes Raid-Helper still offers that no rule set here plays (the Death
// Knight came with Wrath). Only config/classlist.js reads them — to resolve a
// Raid-Helper spec name that may still arrive — so they stay out of CLASSES and
// never reach a class picker. `DK` is the id Raid-Helper and the setup sheets use.
const RAID_HELPER_ONLY_CLASSES = [
    {
        id: "DK", label: "Todesritter", labelEn: "Death Knight", color: "#C41F3B",
        specs: [
            { id: "Blood", label: "Blut", labelEn: "Blood", role: "tank", buffRole: "tank" },
            { id: "Frost", label: "Frost", labelEn: "Frost", role: "melee", buffRole: "melee" },
            { id: "Unholy", label: "Unheilig", labelEn: "Unholy", role: "melee", buffRole: "melee" },
        ],
    },
];

// How Raid-Helper presents each spec, for config/classlist.js: its own spec
// name (`spec` — what its API sends and expects back), the Discord emoji the
// guild uploaded for it (`icon`) and the label the bot has always shown
// (`name`). A key without a spec ("Paladin") is the class-only entry
// Raid-Helper offers. Raid-Helper's spellings are kept as they are ("Sublety",
// "Beastmaster Hunter", "Protection Pala") — they are names on its side and on
// the guild's emojis, not ours to correct.
const RAID_HELPER_NAMES = {
    "Warrior": { spec: "Warrior", icon: "warrior", name: "Warrior" },
    "Warrior-Arms": { spec: "Arms", icon: "arms", name: "Arms Warrior" },
    "Warrior-Fury": { spec: "Fury", icon: "fury", name: "Fury Warrior" },
    "Warrior-Protection": { spec: "Protection", icon: "protection", name: "Protection Warrior" },
    "Paladin": { spec: "paladin", icon: "paladin", name: "Paladin" },
    "Paladin-Holy": { spec: "Holy1", icon: "holypala", name: "Holy Paladin" },
    "Paladin-Protection": { spec: "Protection1", icon: "protpala", name: "Protection Pala" },
    "Paladin-Retribution": { spec: "Retribution", icon: "retribution", name: "Retribution Pala" },
    "Hunter-BeastMastery": { spec: "Beastmastery", icon: "beastmaster", name: "Beastmaster Hunter" },
    "Hunter-Marksmanship": { spec: "Marksmanship", icon: "marksman", name: "Marksman Hunter" },
    "Hunter-Survival": { spec: "Survival", icon: "survival", name: "Survival Hunter" },
    "Rogue": { spec: "rogue", icon: "rogue", name: "Rogue" },
    "Rogue-Assassination": { spec: "Assassination", icon: "assassination", name: "Assassination Rogue" },
    "Rogue-Combat": { spec: "Combat", icon: "combat", name: "Combat Rogue" },
    "Rogue-Subtlety": { spec: "Sublety", icon: "sublety", name: "Sublety Rogue" },
    "Priest": { spec: "Priest", icon: "priest", name: "Priest" },
    "Priest-Discipline": { spec: "Discipline", icon: "discipline", name: "Discipline Priest" },
    "Priest-Holy": { spec: "HolyPriest", icon: "holypriest", name: "Holy Priest" },
    "Priest-Shadow": { spec: "Shadow", icon: "shadow", name: "Shadow Priest" },
    "Shaman": { spec: "Shaman", icon: "shaman", name: "Shaman" },
    "Shaman-Elemental": { spec: "Elemental", icon: "elemental", name: "Elemental Shaman" },
    "Shaman-Enhancement": { spec: "Enhancement", icon: "enhancement", name: "Enhancement Shaman" },
    "Shaman-Restoration": { spec: "Restoration1", icon: "restosham", name: "Restoration Shaman" },
    "Mage": { spec: "mage", icon: "mage", name: "Mage" },
    "Mage-Arcane": { spec: "Arcane", icon: "arcane", name: "Arcane Mage" },
    "Mage-Fire": { spec: "Fire", icon: "firemage", name: "Fire Mage" },
    "Mage-Frost": { spec: "Frost", icon: "frostmage", name: "Frost Mage" },
    "Warlock": { spec: "warlock", icon: "warlock", name: "Warlock" },
    "Warlock-Affliction": { spec: "Affliction", icon: "affliction", name: "Affliction Warlock" },
    "Warlock-Demonology": { spec: "Demonology", icon: "demonology", name: "Demonology Warlock" },
    "Warlock-Destruction": { spec: "Destruction", icon: "destruction", name: "Destruction Warlock" },
    "Druid": { spec: "druid", icon: "druid", name: "Druid" },
    "Druid-Balance": { spec: "Balance", icon: "balance", name: "Balance Druid" },
    "Druid-Feral": { spec: "Feral", icon: "feral", name: "Feral Druid" },
    "Druid-Guardian": { spec: "Guardian", icon: "guardian", name: "Feral Tank" },
    "Druid-Restoration": { spec: "Restoration", icon: "restoration", name: "Restoration Druid" },
    "DK": { spec: "Deathknight", icon: "deathknight", name: "Deathknight" },
    "DK-Blood": { spec: "Blood_Tank", icon: "blooddk", name: "Blood Tank" },
    "DK-Frost": { spec: "Frost_DPS", icon: "frostdk", name: "Frost Deathknight" },
    "DK-Unholy": { spec: "Unholy_DPS", icon: "unholy", name: "Unholy Deathknight" },
};

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

module.exports = { CLASSES, RAID_HELPER_ONLY_CLASSES, RAID_HELPER_NAMES, ROLES, ROLE_LABELS, ROLE_LABELS_EN, buildClasses, labelEnOf };
