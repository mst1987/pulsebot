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

const ROLE_ORDER = ["tank", "healer", "melee", "ranged", "dps"];
const ROLE_LABELS = { tank: "Tanks", healer: "Heiler", melee: "Nahkampf", ranged: "Fernkampf", dps: "DPS" };

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

/**
 * Enrich one raidplan slot into display data:
 * { name, spec, specName, className, classColor, iconUrl, role }.
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
        iconUrl: classIconUrl(cls),
        role: roleOf(entry),
    };
}

/**
 * Turn raw raidplan slots into role-grouped display data. Empty slots (no name)
 * are dropped. Returns:
 *   { total, counts: { [role]: n }, groups: [{ role, label, players: [...] }] }
 */
function buildSetupView(slots) {
    const players = (Array.isArray(slots) ? slots : [])
        .map(enrichSlot)
        .filter((p) => p.name);
    const byRole = {};
    for (const p of players) {
        (byRole[p.role] = byRole[p.role] || []).push(p);
    }
    const groups = ROLE_ORDER
        .filter((r) => byRole[r] && byRole[r].length)
        .map((r) => ({ role: r, label: ROLE_LABELS[r], players: byRole[r] }));
    const counts = {};
    for (const g of groups) counts[g.role] = g.players.length;
    return { total: players.length, counts, groups };
}

module.exports = {
    buildSetupView, enrichSlot, realClass, roleOf, classIconUrl,
    CLASS_COLORS, ROLE_LABELS,
};
