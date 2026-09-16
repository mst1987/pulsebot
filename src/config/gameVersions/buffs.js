// Who brings which party or raid buff, and whom it helps — for the setup
// suggestion (#262), not for the log analysis.
//
// Nothing here is maintained twice: the buffs themselves (label, icon, the
// roles they are worth having on) come from config/raidBuffs.js and
// config/totems.js. This file only adds what those two do not say because the
// log analysis never needed it: which *spec* provides a buff when it is a
// talent (Trueshot Aura, Moonkin Aura, Totem of Wrath …), whether it reaches
// the party or the whole raid, and which buffs a game version does not have.
//
// Shields (Earth Shield, Water Shield) are left out: they sit on one target,
// they are not a reason to put anybody into a group. Racial auras (Draenei)
// are left out too: a race is not a spec, and the setup places specs.

const { BUFFS } = require("../raidBuffs");
const { TOTEMS } = require("../totems");

// Buffs a talent provides, by spec key; every other buff comes from each spec
// of its providing class.
const SPEC_PROVIDERS = {
    trueshot: ["Hunter-Marksmanship"],
    lotp: ["Druid-Feral", "Druid-Guardian"],
    moonkinAura: ["Druid-Balance"],
    sanctityAura: ["Paladin-Retribution"],
    totemOfWrath: ["Shaman-Elemental"],
    manaTide: ["Shaman-Restoration"],
    vampiricTouch: ["Priest-Shadow"],
};

// The totems a setup groups a shaman for. Resistance, tremor and damage totems
// are situational and bring nobody into a group. `roles` in raidBuffs.js's
// vocabulary (tank / healer / melee / caster); `classes` widens it the same way.
const MANA_MELEE = ["Hunter", "Shaman", "Paladin"];
const TOTEM_BUFFS = {
    windfury: { roles: ["tank", "melee"] },
    graceOfAir: { roles: ["tank", "melee"] },
    strengthOfEarth: { roles: ["tank", "melee"] },
    wrathOfAir: { roles: ["healer", "caster"] },
    totemOfWrath: { roles: ["healer", "caster"] },
    manaSpring: { roles: ["healer", "caster"], classes: MANA_MELEE },
    manaTide: { roles: ["healer", "caster"], classes: MANA_MELEE },
    healingStream: { roles: ["tank", "healer", "melee", "caster"] },
};

// Party buffs the log analysis never reads as an aura, but a setup places people
// for: Vampiric Touch returns mana to the shadow priest's party, so the priest
// belongs with the casters and healers.
const SETUP_ONLY = [
    { key: "vampiricTouch", label: "Vampirberührung", icon: "spell_holy_stoicism", providerClass: "Priest", scope: "party", roles: ["healer", "caster"], classes: MANA_MELEE },
];

const EXCLUDED_GROUPS = new Set(["shield"]);
const PLAYABLE_CLASSES = new Set(["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"]);

/** Every buff candidate in one shape, before a version drops what it lacks. */
function allBuffs() {
    const fromBuffs = BUFFS
        .filter((b) => !EXCLUDED_GROUPS.has(b.group) && PLAYABLE_CLASSES.has(b.provider))
        .map((b) => ({
            key: b.key,
            label: b.groupLabel || b.label,
            icon: b.icon,
            providerClass: b.provider,
            // Blessings, prayers, gift and brilliance reach the whole raid;
            // auras, shouts and pacts only the caster's party.
            scope: b.group === "party" ? "party" : "raid",
            roles: b.roles,
            classes: b.classes || [],
            // A warrior keeps one shout up, not both.
            slot: b.key === "battleShout" || b.key === "commandingShout" ? "shout" : "",
        }));
    const fromTotems = TOTEMS
        .filter((t) => TOTEM_BUFFS[t.key])
        .map((t) => ({
            key: t.key,
            label: t.label,
            icon: t.icon,
            providerClass: "Shaman",
            scope: "party",
            slot: t.slot,
            roles: TOTEM_BUFFS[t.key].roles,
            classes: TOTEM_BUFFS[t.key].classes || [],
        }));
    return [...fromBuffs, ...fromTotems, ...SETUP_ONLY];
}

/**
 * The party and raid buffs of a rule set.
 *
 * @param {object[]} classes  buildClasses() output of the version
 * @param {{ exclude?: string[] }} [options]  buff keys the version does not have
 * @returns {{ partyBuffs: object[], raidBuffs: object[] }} each entry
 *   `{ key, label, icon, scope, slot, providers: specKey[], beneficiaries: specKey[] }`
 */
function buildBuffs(classes, options = {}) {
    const exclude = new Set(options.exclude || []);
    const specs = classes.flatMap((c) => c.specs);
    const entries = allBuffs()
        .filter((b) => !exclude.has(b.key))
        .map((b) => ({
            key: b.key,
            label: b.label,
            icon: b.icon,
            scope: b.scope,
            // One buff per provider per slot: a totem's element (a shaman drops
            // one air totem), a warrior's shout. "" for everything else.
            slot: b.slot || "",
            providers: SPEC_PROVIDERS[b.key]
                ? SPEC_PROVIDERS[b.key].filter((key) => specs.some((s) => s.key === key))
                : specs.filter((s) => s.classId === b.providerClass).map((s) => s.key),
            beneficiaries: specs
                .filter((s) => b.roles.includes(s.buffRole) || b.classes.includes(s.classId))
                .map((s) => s.key),
        }))
        .filter((b) => b.providers.length > 0);
    return {
        partyBuffs: entries.filter((b) => b.scope === "party"),
        raidBuffs: entries.filter((b) => b.scope === "raid"),
    };
}

module.exports = { buildBuffs, SPEC_PROVIDERS, TOTEM_BUFFS };
