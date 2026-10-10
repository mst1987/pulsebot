// The features a game version can have (#761), in the order the settings
// matrix (Einstellungen → Spielversion → "Funktionen je Version") lists them.
// Pure data: the ids and the one normaliser of the setting. Whether a feature
// is possible for a version and whether it is switched on is decided in one
// place, services/events/versionCapabilities.js.
//
//   logcheck         the log check of Warcraft-Logs reports (rules ready + log site)
//   lootCouncilBis   the loot council's content data: BiS lists, item table, tier filter
//   simulation       the loot council's simulation (WoWSims)
//   raidSheet        filling the Google raid sheet (a sheet layout in the rule set)
//   softres          softres.it lists (a softres edition in the version's settings)
//   armory           the Battle.net armory lookup (region, realm, namespace set)
//   wowheadLinks     links to Wowhead (a Wowhead path in the version's settings)
//   raidplanCatalog  the raid plan's catalog of mobs and spells (entries of the version)
//
// The setting is `config.versionSettings[<versionId>].disabled`: the features
// switched off for that version. Missing or empty = every possible feature on,
// so no migration is needed.
const VERSION_FEATURES = Object.freeze([
    "logcheck", "lootCouncilBis", "simulation", "raidSheet", "softres", "armory", "wowheadLinks", "raidplanCatalog",
]);

/** Whether `id` names a feature of the matrix. */
function isVersionFeature(id) {
    return VERSION_FEATURES.includes(String(id || ""));
}

/**
 * The stored `disabled` list in its final shape: known feature ids only, each
 * once, in the matrix order. Anything else (not a list, unknown ids) drops out.
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeDisabled(raw) {
    const list = Array.isArray(raw) ? raw.map((x) => String(x || "").trim()) : [];
    return VERSION_FEATURES.filter((f) => list.includes(f));
}

module.exports = { VERSION_FEATURES, isVersionFeature, normalizeDisabled };
