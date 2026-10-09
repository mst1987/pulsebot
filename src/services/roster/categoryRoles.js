// The Discord roles that mean "expected raider" of a raid category (#653).
//
// Before the rosters that was config.categoryRoles[categoryId] (Einstellungen →
// Kategorien). A category with a roster now answers with the roster's roleIds;
// one without keeps the settings value. Every reader that means "who is
// expected in this raid" (missing list, pings, reminders, sign-up gate) asks
// here, so the roster is the one source once it exists.
//
// The settings page still edits config.categoryRoles; syncRosterRoleIds()
// carries such a save over to the rosters, and mirrorCategoryRoles() carries a
// roster's roles (set on the roster page, #657) back into the settings, so
// both always stay the same.
const rosterStore = require("../../stores/rosterStore");

/** The config to read: the one handed in, else the stored one (required late, no cycle). */
function configOf(config) {
    if (config && typeof config === "object") return config;
    return require("../../stores/configStore").getConfig() || {};
}

/**
 * The expected raider roles of a category: its roster's roleIds when it has a
 * roster, else config.categoryRoles. Always a fresh array of strings.
 * @param {string} categoryId
 * @param {object} [config]  the caller's config (settingsStore.getConfig()); read when left out
 * @returns {string[]}
 */
function expectedRoleIds(categoryId, config) {
    const cat = String(categoryId || "").trim();
    if (!cat) return [];
    const roster = rosterStore.rosterForCategory(cat);
    if (roster) return roster.roleIds.map(String);
    const map = configOf(config).categoryRoles || {};
    return (Array.isArray(map[cat]) ? map[cat] : []).map(String).filter(Boolean);
}

/**
 * After the settings saved config.categoryRoles: every roster of a category
 * gets that category's roles (none = no roles). Returns the ids of the
 * rosters that changed.
 * @param {Record<string, string[]>} categoryRoles  the saved, normalised map
 * @param {{ actor?: string }} [opts]
 * @returns {string[]}
 */
function syncRosterRoleIds(categoryRoles, { actor = "" } = {}) {
    // no map at all is no save of the roles - nothing to carry over
    if (!categoryRoles || typeof categoryRoles !== "object" || Array.isArray(categoryRoles)) return [];
    const map = categoryRoles;
    const changed = [];
    for (const roster of rosterStore.listRosters("")) {
        if (!roster.categoryId) continue;
        const next = (Array.isArray(map[roster.categoryId]) ? map[roster.categoryId] : []).map(String);
        if (next.join(",") === roster.roleIds.join(",")) continue;
        rosterStore.updateRoster(roster.id, { roleIds: next }, { actor });
        changed.push(roster.id);
    }
    return changed;
}

/**
 * The other direction (#657): the roster page changed a roster's roles, so the
 * settings value of its category follows - otherwise the next save of the
 * settings page (syncRosterRoleIds) would hand the roster the old roles back.
 * A roster without category touches nothing. Returns whether the config changed.
 * @param {{ categoryId?: string|null, roleIds?: string[] } | null} roster
 * @returns {boolean}
 */
function mirrorCategoryRoles(roster) {
    const cat = String((roster && roster.categoryId) || "").trim();
    if (!cat) return false;
    const configStore = require("../../stores/configStore");
    const current = (configStore.getConfig() || {}).categoryRoles || {};
    const next = (roster.roleIds || []).map(String).filter(Boolean);
    if ((Array.isArray(current[cat]) ? current[cat] : []).map(String).join(",") === next.join(",")) return false;
    configStore.saveConfig({ categoryRoles: { ...current, [cat]: next } });
    return true;
}

module.exports = { expectedRoleIds, syncRosterRoleIds, mirrorCategoryRoles };
