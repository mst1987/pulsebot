const { CLASSES } = require("../../config/applyClasses");
const { CLASS_COLORS } = require("../../utils/setup/setupView");

// What the Bewerbungen tab shows per application beyond the parsed embed: class
// and spec apart (the embed has them as one "Druid – Balance" string), the
// class colour and icons, and a status badge.

/** An application younger than this counts as "neu". */
const NEW_APPLICATION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// One WoW spell icon per spec of the application flow (config/applyClasses.js).
// Every name checked against the zamimg CDN.
const SPEC_ICONS = {
    warrior: { Arms: "ability_warrior_savageblow", Fury: "ability_warrior_innerrage", Protection: "ability_warrior_defensivestance" },
    paladin: { Holy: "spell_holy_holybolt", Protection: "spell_holy_devotionaura", Retribution: "spell_holy_auraoflight" },
    hunter: { "Beast Mastery": "ability_hunter_beasttaming", Marksmanship: "ability_marksmanship", Survival: "ability_hunter_camouflage" },
    rogue: { Assassination: "ability_rogue_eviscerate", Combat: "ability_backstab", Subtlety: "ability_stealth" },
    priest: { Discipline: "spell_holy_wordfortitude", Holy: "spell_holy_guardianspirit", Shadow: "spell_shadow_shadowwordpain" },
    shaman: { Elemental: "spell_nature_lightning", Enhancement: "spell_nature_lightningshield", Restoration: "spell_nature_magicimmunity" },
    mage: { Arcane: "spell_holy_magicalsentry", Fire: "spell_fire_firebolt02", Frost: "spell_frost_frostbolt02" },
    warlock: { Affliction: "spell_shadow_deathcoil", Demonology: "spell_shadow_metamorphosis", Destruction: "spell_shadow_rainoffire" },
    druid: { Balance: "spell_nature_starfall", Feral: "ability_druid_catform", Restoration: "spell_nature_healingtouch" },
};

/**
 * Split the embed's "Klasse / Spec" value ("Druid – Balance", emoji already
 * stripped) into a known class and spec. An unknown class keeps the raw text as
 * the spec so nothing the applicant wrote is lost.
 */
function splitClassSpec(classSpec) {
    const raw = String(classSpec || "").trim();
    if (!raw || raw === "Unbekannt") return { cls: null, spec: "" };
    const [head, ...rest] = raw.split(/\s+[–-]\s+/);
    const cls = CLASSES.find((c) => c.label.toLowerCase() === head.trim().toLowerCase()) || null;
    if (!cls) return { cls: null, spec: raw };
    return { cls, spec: rest.join(" – ").trim() };
}

/**
 * "archiviert" for an archived thread, "neu" for one younger than
 * NEW_APPLICATION_DAYS, "offen" otherwise. Nothing is stored: "neu" means
 * recent, not unread — a per-admin "seen" flag would be a second list to keep.
 */
function applicationStatus(app, now = Date.now()) {
    if (app.archived) return "archiviert";
    const created = Number(app.createdAt) || 0;
    if (created && now - created < NEW_APPLICATION_DAYS * DAY_MS) return "neu";
    return "offen";
}

/** The application plus className, spec, classColor, classIcon, specIcon and status. */
function annotateApplication(app, now = Date.now()) {
    const { cls, spec } = splitClassSpec(app.classSpec);
    return {
        ...app,
        className: cls ? cls.label : "",
        spec,
        classColor: cls ? CLASS_COLORS[cls.label] || "" : "",
        classIcon: cls ? `classicon_${cls.value}` : "",
        specIcon: cls && SPEC_ICONS[cls.value] ? SPEC_ICONS[cls.value][spec] || "" : "",
        status: applicationStatus(app, now),
    };
}

module.exports = { NEW_APPLICATION_DAYS, SPEC_ICONS, splitClassSpec, applicationStatus, annotateApplication };
