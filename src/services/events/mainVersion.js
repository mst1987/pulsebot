// The guild's main game version (#541): which rule set something new starts
// with when nobody picked one. A setting, not a code constant — the orga
// switches it in Einstellungen → Spielversion without a deploy:
//
//   config.categoryVersion[categoryId]  a category that plays another version
//   config.mainVersion                  the guild's main version
//   DEFAULT_VERSION ("tbc")             what an install without either plays
//
// Only a *missing* version is filled from here. An event, a raid template or a
// signup that carries its own `versionId` keeps it, whatever the setting says
// later; a record stored before versions existed is LEGACY_VERSION (TBC), not
// the main version of today (config/gameVersions).
const { rulesFor, DEFAULT_VERSION } = require("../../config/gameVersions");

/** `id` when a rule set has it, else "". */
function knownVersion(id) {
    const key = String(id || "").trim();
    return key && rulesFor(key) ? key : "";
}

/**
 * The config to read: the one handed in (a route passes settingsStore's), else
 * the stored one. The config store itself, not the settingsStore facade — that
 * one loads the template store, which asks here (a require cycle). Required
 * late, and a config that cannot be read counts as "nothing set".
 */
function configOf(config) {
    if (config && typeof config === "object") return config;
    try {
        return require("../../stores/configStore").getConfig() || {};
    } catch {
        return {};
    }
}

/**
 * The version a category plays: its own override, else the main version, else
 * DEFAULT_VERSION. An id no rule set knows is skipped, never handed out.
 * @param {{ categoryId?: string, config?: object }} [opts]
 * @returns {string} a known version id
 */
function mainVersionFor({ categoryId = "", config } = {}) {
    const cfg = configOf(config);
    const map = cfg.categoryVersion && typeof cfg.categoryVersion === "object" && !Array.isArray(cfg.categoryVersion) ? cfg.categoryVersion : {};
    const cat = String(categoryId || "").trim();
    return (cat && knownVersion(map[cat])) || knownVersion(cfg.mainVersion) || DEFAULT_VERSION;
}

/**
 * The version of an event: its own when it has a known one (every own event),
 * else what its category plays (a Raid-Helper event carries none).
 * @param {{ versionId?: string, categoryId?: string } | null} event
 */
function versionOfEvent(event, { config } = {}) {
    const e = event || {};
    return knownVersion(e.versionId) || mainVersionFor({ categoryId: e.categoryId, config });
}

/** The rule set of an event (see versionOfEvent) — never null. */
function rulesForEvent(event, opts) {
    return rulesFor(versionOfEvent(event, opts));
}

/**
 * The class list of a version as the signup and the profile pick from it:
 * `{ id, label, color, icon }`. The main version when `versionId` is unknown.
 */
function classesOfVersion(versionId, { config } = {}) {
    const rules = rulesFor(knownVersion(versionId) || mainVersionFor({ config }));
    return rules.classes.map((c) => ({ id: c.id, label: c.label, color: c.color, icon: c.icon }));
}

module.exports = { mainVersionFor, versionOfEvent, rulesForEvent, classesOfVersion, knownVersion };
