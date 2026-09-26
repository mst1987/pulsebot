// Role order, role attributes and the tool row (role segment, search,
// orientation) of the RPB tables.
const { esc } = require("../layout");
const { LINE, hicon } = require("../widgets");

// --- RPB (Role Performance Breakdown) panels ------------------------------

/** Group rows by the role the RPB assigned, in the sheet's own role order. */
const RPB_ROLE_ORDER = ["Tank", "Healer", "Caster", "Physical"];

/** The RPB role of a raider; everyone the sheet did not place is Physical, as the sheet itself does. */
function rpbRole(roles, name) {
    return (roles && roles[name]) || "Physical";
}

/** Rows in the sheet's own role order (tanks, healers, casters, melee), the given order inside a role. */
function sortByRole(rows, roles) {
    const rank = (r) => {
        const i = RPB_ROLE_ORDER.indexOf(rpbRole(roles, r.name));
        return i < 0 ? RPB_ROLE_ORDER.length : i;
    };
    return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}

// German label + icon per RPB role, for the role segment of the detail dialogs.
const ROLE_META = {
    Tank: { label: "Tanks", icon: "inv_shield_06" },
    Healer: { label: "Heiler", icon: "spell_holy_flashheal" },
    Caster: { label: "Caster", icon: "spell_fire_flamebolt" },
    Physical: { label: "Nahkampf", icon: "ability_dualwield" },
};

/** `data-role` / `data-name` of one raider's row or column cell, for the tool row's filter. */
function roleAttrs(roles, name) {
    return ` data-role="${esc(rpbRole(roles, name))}" data-name="${esc(name)}"`;
}

/**
 * The tool row of an RPB table: one role segment (Alle / Tanks / Heiler /
 * Caster / Nahkampf with their counts), the raider search and — for the
 * damage table — two icon buttons for the orientation. Replaces the role tabs,
 * the orientation switch and the colour legend in one line.
 */
function rpbTools(rows, roles, orient) {
    const counts = {};
    for (const r of rows) {
        const k = rpbRole(roles, r.name);
        counts[k] = (counts[k] || 0) + 1;
    }
    const btn = (key, label, icon, n, active) => `<button type="button" class="seg-btn${active ? " active" : ""}" data-frole="${esc(key)}">${icon ? hicon(icon, "") : ""}${esc(label)}<span class="n">${esc(n)}</span></button>`;
    const seg = [btn("all", "Alle", "", rows.length, true), ...RPB_ROLE_ORDER.filter((r) => counts[r]).map((r) => btn(r, ROLE_META[r].label, ROLE_META[r].icon, counts[r], false))].join("");
    const o = orient
        ? `<nav class="seg sm"><button type="button" class="seg-btn active" data-orient="p" data-tip="Spieler als Zeilen" aria-label="Spieler als Zeilen">${LINE.rows}</button><button type="button" class="seg-btn" data-orient="a" data-tip="Fähigkeiten als Zeilen" aria-label="Fähigkeiten als Zeilen">${LINE.cols}</button></nav>`
        : "";
    return `<div class="dtools"><nav class="seg sm">${seg}</nav><span class="grow"></span><label class="field">${LINE.search}<input type="search" data-fsearch placeholder="Raider suchen …" aria-label="Raider suchen"></label>${o}</div>`;
}

module.exports = {
    sortByRole, roleAttrs, rpbTools,
};
