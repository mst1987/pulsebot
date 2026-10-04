// How a raid category plans its raids: with the EventHelper's own raid plan
// ("raidplan": boards per boss, the „Einteilungen“ link) or with a Google Sheet
// ("sheet": the category's fixed sheet or a filled copy of a raidsheet template).
// Never both — the raid detail, the bot's event message and the routes that
// fill/post a sheet or post the raid plan all ask this one rule.
//
// Stored per category in config.categoryPlanning, only where somebody picked a
// mode (Einstellungen → Kategorien → Setup & Planung). Without an entry a
// category keeps what it already used: "sheet" when a fixed sheet is assigned to
// it (config.categorySheets), otherwise "raidplan". No category at all (an event
// outside every Discord category) has no fixed sheet either, so it is "raidplan".
//
// Pure: takes the config, never reads a store (configStore requires this module).

const PLANNING_MODES = ["raidplan", "sheet"];

/** `{ [categoryId]: "raidplan" | "sheet" }` — anything else drops out. */
function normalizeCategoryPlanning(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, mode] of Object.entries(raw)) {
        const key = String(catId).trim();
        if (key && PLANNING_MODES.includes(mode)) out[key] = mode;
    }
    return out;
}

/**
 * The planning mode of a category.
 * @param {string} categoryId the raid channel's Discord category ("" = none)
 * @param {object} config     getConfig()'s result (categoryPlanning, categorySheets)
 * @returns {"raidplan" | "sheet"}
 */
function planningOf(categoryId, config) {
    const key = String(categoryId || "").trim();
    const cfg = config || {};
    const stored = (cfg.categoryPlanning || {})[key];
    if (key && PLANNING_MODES.includes(stored)) return stored;
    const sheet = (cfg.categorySheets || {})[key];
    return key && sheet && sheet.url ? "sheet" : "raidplan";
}

/** The German refusal of a route whose action the category's planning does not offer (HTTP 409). */
const PLANNING_REFUSALS = {
    sheet: "Diese Kategorie plant mit dem Raidplan – ein Raidsheet gibt es hier nicht (Einstellungen → Kategorien → Setup & Planung).",
    raidplan: "Diese Kategorie plant mit einem Google-Sheet – Einteilungen aus dem Raidplan gibt es hier nicht (Einstellungen → Kategorien → Setup & Planung).",
};

/**
 * Whether `action` ("sheet" | "raidplan") is offered for a category; null when it is,
 * else `{ status: 409, code: "planning_mismatch", message }`.
 */
function planningRefusal(action, categoryId, config) {
    return planningOf(categoryId, config) === action ? null : { status: 409, code: "planning_mismatch", message: PLANNING_REFUSALS[action] };
}

module.exports = { PLANNING_MODES, normalizeCategoryPlanning, planningOf, planningRefusal };
