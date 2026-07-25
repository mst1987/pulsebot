// Turn raw Raid-Helper raidplan slots into display-ready, role-grouped data for
// the web admin (class icons + WoW class colours). Discord server emojis don't
// render on the web, so we use the zamimg class-icon CDN like src/web/render.js.

const classlist = require("../config/classlist");

// Resolve a slot's spec by classlist key ("Destro") AND by spec field
// ("Destruction") — Raid-Helper may send either form. First definition wins, so
// a spec's own key (e.g. "Combat" = melee rogue) is never clobbered by a later
// entry that reuses the same spec field (e.g. "TankRogue" whose spec is "Combat").
const SPEC_LOOKUP = {};
for (const [key, val] of Object.entries(classlist)) {
    if (!(key in SPEC_LOOKUP)) SPEC_LOOKUP[key] = val;
    if (val.spec && !(val.spec in SPEC_LOOKUP)) SPEC_LOOKUP[val.spec] = val;
}

// WoW class colours (hex), matching src/commands/setup/fillSetup.js.
const CLASS_COLORS = {
    Warrior: "#C79C6E", Paladin: "#F58CBA", Hunter: "#ABD473", Rogue: "#FFF569",
    Priest: "#FFFFFF", Shaman: "#0070DE", Mage: "#69CCF0", Warlock: "#9482C9",
    Druid: "#FF7D0A", DK: "#C41F3B",
};

// classlist `clazz` is sometimes the generic "Tank"; recover the real class from
// the spec icon so we pick the right class icon + colour.
const TANK_ICON_CLASS = {
    protpala: "Paladin", protection: "Warrior", blooddk: "DK",
    guardian: "Druid", combat: "Rogue", enhancement: "Shaman", demonology: "Warlock",
};

// WoW class -> zamimg class-icon asset slug.
const CLASS_ICON_SLUG = {
    Warrior: "warrior", Paladin: "paladin", Hunter: "hunter", Rogue: "rogue",
    Priest: "priest", Shaman: "shaman", Mage: "mage", Warlock: "warlock",
    Druid: "druid", DK: "deathknight",
};

// classlist `icon` slug -> zamimg spell/ability icon filename, so each raider
// shows their SPEC icon (not just a generic class icon). All URLs verified to
// return HTTP 200 on wow.zamimg.com. Falls back to the class icon when a spec
// has no entry here.
const SPEC_ICON = {
    // Warrior
    arms: "ability_warrior_savageblow", fury: "ability_warrior_innerrage",
    protection: "ability_warrior_defensivestance", warrior: "inv_sword_27",
    // Paladin
    holypala: "spell_holy_holybolt", protpala: "spell_holy_devotionaura",
    retribution: "spell_holy_auraoflight", paladin: "spell_holy_holybolt",
    // Hunter
    beastmaster: "ability_hunter_beasttaming", marksman: "ability_hunter_focusedaim",
    survival: "ability_hunter_swiftstrike", hunter: "inv_weapon_bow_07",
    // Rogue
    assassination: "ability_rogue_eviscerate", combat: "ability_backstab",
    sublety: "ability_stealth", rogue: "inv_throwingknife_04",
    // Priest
    discipline: "spell_holy_powerwordshield", holypriest: "spell_holy_holynova",
    shadow: "spell_shadow_shadowwordpain", priest: "inv_staff_30",
    // Shaman
    elemental: "spell_nature_lightning", enhancement: "spell_nature_lightningshield",
    restosham: "spell_nature_magicimmunity", shaman: "spell_nature_lightning",
    // Mage
    arcane: "spell_holy_magicalsentry", firemage: "spell_fire_firebolt02",
    frostmage: "spell_frost_frostbolt02", mage: "spell_holy_magicalsentry",
    // Warlock
    affliction: "spell_shadow_deathcoil", demonology: "spell_shadow_metamorphosis",
    destruction: "spell_shadow_rainoffire", warlock: "spell_shadow_deathcoil",
    // Druid
    balance: "spell_nature_starfall", feral: "ability_druid_catform",
    guardian: "ability_racial_bearform", restoration: "spell_nature_healingtouch",
    druid: "ability_druid_catform",
    // Death Knight
    unholy: "spell_deathknight_unholypresence", frostdk: "spell_deathknight_frostpresence",
    blooddk: "spell_deathknight_bloodpresence", deathknight: "spell_deathknight_bloodpresence",
};

const ROLE_LABELS = { tank: "Tanks", healer: "Heiler", melee: "Nahkampf", ranged: "Fernkampf", dps: "DPS" };

// Classes that can main-/off-tank, plus any explicit tank spec (sodclazz/clazz
// "tank"). Drives the 3rd-tank candidate picker on the raidsheet-fill form.
const TANK_CANDIDATE_CLASSES = new Set(["Warrior", "Druid", "Paladin", "DK"]);

// The real WoW class for a classlist entry (recovering it when clazz is "Tank").
function realClass(entry) {
    if (!entry) return null;
    if (entry.clazz && entry.clazz !== "Tank") return entry.clazz;
    return TANK_ICON_CLASS[entry.icon] || null;
}

// Bucket a spec into tank / healer / melee / ranged (fallback: dps).
function roleOf(entry) {
    if (!entry) return "dps";
    const sod = String(entry.sodclazz || "").toLowerCase();
    if (sod === "tank" || entry.clazz === "Tank") return "tank";
    if (sod === "healer") return "healer";
    if (sod === "melee") return "melee";
    if (sod === "ranged") return "ranged";
    return "dps";
}

function slotName(slot) {
    return String(slot.name || slot.charName || slot.characterName || "").trim();
}
function slotSpec(slot) {
    return String(slot.specName || slot.spec || slot.className || "").trim();
}

// zamimg class-icon URL for a WoW class, or "" when unknown.
function classIconUrl(cls) {
    const slug = CLASS_ICON_SLUG[cls] || "";
    return slug ? `https://wow.zamimg.com/images/wow/icons/large/classicon_${slug}.jpg` : "";
}

// zamimg SPEC-icon URL for a classlist entry (by its icon slug). Falls back to
// the class icon when the spec has no mapping, or "" when nothing is known.
function specIconUrl(entry) {
    const file = entry && SPEC_ICON[entry.icon];
    if (file) return `https://wow.zamimg.com/images/wow/icons/large/${file}.jpg`;
    return classIconUrl(realClass(entry));
}

// Warcraft Logs names a spec by (class, spec) — "Paladin" + "Holy" — while the
// classlist is keyed by its own slugs. Several spec names exist for two classes
// (Holy, Protection, Restoration, Frost), so the class decides which icon is meant.
const WCL_SPEC_SLUG = {
    Warrior: { arms: "arms", fury: "fury", protection: "protection" },
    Paladin: { holy: "holypala", protection: "protpala", retribution: "retribution" },
    Hunter: { beastmastery: "beastmaster", marksmanship: "marksman", survival: "survival" },
    Rogue: { assassination: "assassination", combat: "combat", subtlety: "sublety" },
    Priest: { discipline: "discipline", holy: "holypriest", shadow: "shadow" },
    Shaman: { elemental: "elemental", enhancement: "enhancement", restoration: "restosham" },
    Mage: { arcane: "arcane", fire: "firemage", frost: "frostmage" },
    Warlock: { affliction: "affliction", demonology: "demonology", destruction: "destruction" },
    Druid: { balance: "balance", feral: "feral", guardian: "guardian", restoration: "restoration" },
    DK: { blood: "blooddk", frost: "frostdk", unholy: "unholy" },
};

/**
 * Spec icon for a (class, spec) pair as Warcraft Logs reports it. Falls back to
 * the plain class icon for an unknown/blank spec, and to "" for an unknown class.
 * @param {string} className e.g. "Paladin"
 * @param {string} spec      e.g. "Holy" / "Beast Mastery" (case/space tolerant)
 */
function classSpecIconUrl(className, spec) {
    const cls = String(className || "").trim();
    const key = String(spec || "").trim().toLowerCase().replace(/[\s_-]/g, "");
    const slug = (WCL_SPEC_SLUG[cls] || {})[key];
    const file = slug && SPEC_ICON[slug];
    if (file) return `https://wow.zamimg.com/images/wow/icons/large/${file}.jpg`;
    return classIconUrl(cls);
}

/**
 * Enrich one raidplan slot into display data:
 * { name, spec, specName, className, classColor, iconUrl, role }.
 * iconUrl is the SPEC icon (class icon as fallback).
 */
function enrichSlot(slot) {
    const slotObj = slot || {};
    const name = slotName(slotObj);
    const spec = slotSpec(slotObj);
    const entry = SPEC_LOOKUP[spec] || null;
    const cls = realClass(entry);
    return {
        name,
        spec,
        specName: entry ? entry.name : (spec || "Unbekannt"),
        className: cls || "",
        classColor: (cls && CLASS_COLORS[cls]) || "",
        iconUrl: specIconUrl(entry),
        role: roleOf(entry),
    };
}

// Raid group of a slot: an explicit numeric `slot.group` wins; otherwise fall
// back to 5 slots per group by position (index 0-4 = group 1), matching the
// sheet export in src/utils/fillSetup.js. Uses the raw array index so empty
// slots keep the following players in their real group instead of shifting them.
function groupOf(slot, index) {
    const g = slot && slot.group;
    const n = typeof g === "number" ? g : parseInt(g, 10);
    if (Number.isInteger(n) && n >= 1) return n;
    return Math.floor(index / 5) + 1;
}

// Whether a classlist entry can tank: an explicit tank spec (sodclazz/clazz
// "tank") or a class that can off-tank (Warrior, Druid, Paladin, DK).
function isTankSpec(entry) {
    if (!entry) return false;
    if (String(entry.sodclazz || "").toLowerCase() === "tank") return true;
    if (entry.clazz === "Tank") return true;
    return TANK_CANDIDATE_CLASSES.has(entry.clazz);
}

/**
 * Turn raw raidplan slots into raid-group display data (Group 1–5 like the
 * Raid-Helper raidplan). Empty slots (no name) are dropped. Returns:
 *   { total, groups: [{ group, label, players: [...] }], roleCounts: { [role]: n } }
 */
function buildSetupView(slots) {
    const players = (Array.isArray(slots) ? slots : [])
        .map((slot, index) => ({ ...enrichSlot(slot), group: groupOf(slot, index) }))
        .filter((p) => p.name);
    const byGroup = new Map();
    for (const p of players) {
        if (!byGroup.has(p.group)) byGroup.set(p.group, []);
        byGroup.get(p.group).push(p);
    }
    const groups = [...byGroup.keys()]
        .sort((a, b) => a - b)
        .map((g) => ({ group: g, label: `Gruppe ${g}`, players: byGroup.get(g) }));
    const roleCounts = {};
    for (const p of players) roleCounts[p.role] = (roleCounts[p.role] || 0) + 1;
    return { total: players.length, groups, roleCounts };
}

/**
 * Names of raiders in the setup whose spec/class can tank — offered as 3rd-tank
 * candidates on the raidsheet-fill form. Deduped by name, in raidplan order.
 * Returns [{ name, specName, className }].
 */
function tankCandidates(slots) {
    const seen = new Set();
    const out = [];
    for (const slot of (Array.isArray(slots) ? slots : [])) {
        const p = enrichSlot(slot);
        if (!p.name || seen.has(p.name)) continue;
        if (!isTankSpec(SPEC_LOOKUP[p.spec] || null)) continue;
        seen.add(p.name);
        out.push({ name: p.name, specName: p.specName, className: p.className });
    }
    return out;
}

/**
 * Class/spec display data for a raw spec key (classlist key or spec name), or
 * null when the spec is unknown — used to enrich a *name only* (e.g. a past
 * signup) without a full raidplan slot. Unlike enrichSlot(), this never makes
 * up a fallback so callers can tell "known" from "unknown" apart.
 * @returns {{ specName:string, className:string, classColor:string, iconUrl:string }|null}
 */
function specProfile(spec) {
    const entry = SPEC_LOOKUP[String(spec || "").trim()];
    if (!entry) return null;
    const cls = realClass(entry);
    return {
        specName: entry.name,
        className: cls || "",
        classColor: (cls && CLASS_COLORS[cls]) || "",
        iconUrl: specIconUrl(entry),
    };
}

module.exports = {
    buildSetupView, tankCandidates, isTankSpec, groupOf,
    enrichSlot, realClass, roleOf, classIconUrl, specIconUrl, specProfile, classSpecIconUrl,
    CLASS_COLORS, ROLE_LABELS,
};
