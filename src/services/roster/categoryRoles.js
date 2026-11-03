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
//
// One roster per category and version (#739): the roles of a raid are the
// roster of the raid's version (`versionId`), the settings value mirrors the
// open roster of the version the category plays NOW. A closed roster (a
// category switched to another version) is neither synced nor mirrored.
//
// A role belongs to one open roster (docs/roster-profile.md "Eine Rolle, ein
// Roster"): a category that gets the role of a roster without category takes that
// roster (adoptRosters), and a save that would give a category's roster the role of
// another roster is refused before it is written (rolesOfOtherRosters).
const rosterStore = require("../../stores/roster/rosterStore");
const { rosterOfCategory, isCurrentRoster, currentVersionOf } = require("./categoryRoster");

/** The config to read: the one handed in, else the stored one (required late, no cycle). */
function configOf(config) {
    if (config && typeof config === "object") return config;
    return require("../../stores/settings/configStore").getConfig() || {};
}

/**
 * The expected raider roles of a category: the roleIds of its roster of
 * `versionId` (the raid's version; none = the version the category plays now)
 * when it has one, else config.categoryRoles. Always a fresh array of strings.
 * @param {string} categoryId
 * @param {object} [config]  the caller's config (settingsStore.getConfig()); read when left out
 * @param {{ versionId?: string }} [opts]
 * @returns {string[]}
 */
function expectedRoleIds(categoryId, config, { versionId = "" } = {}) {
    const cat = String(categoryId || "").trim();
    if (!cat) return [];
    const roster = rosterOfCategory(cat, { versionId, config: config && typeof config === "object" ? config : undefined });
    if (roster) return roster.roleIds.map(String);
    const map = configOf(config).categoryRoles || {};
    return (Array.isArray(map[cat]) ? map[cat] : []).map(String).filter(Boolean);
}

const rolesIn = (map, categoryId) => (Array.isArray(map[categoryId]) ? map[categoryId] : []).map(String);

/**
 * A category without roster that got the role of an open roster without category and of its
 * version takes that roster: a Kader's takeover makes the roster before anybody can mark the
 * new Discord category as a raid category. Returns the ids of the rosters that moved.
 */
function adoptRosters(map, { actor, config, skip }) {
    const active = config && Array.isArray(config.categoryIds) ? config.categoryIds.map(String) : null;
    const moved = [];
    for (const categoryId of Object.keys(map)) {
        if (skip.has(categoryId) || (active && !active.includes(categoryId))) continue;
        const versionId = currentVersionOf(categoryId, { config });
        if (rosterStore.rosterForCategory(categoryId, versionId)) continue;
        const home = rosterStore.openRostersWithRole(rolesIn(map, categoryId)).find((r) => !r.categoryId && r.versionId === versionId);
        if (!home) continue;
        rosterStore.updateRoster(home.id, { categoryId }, { actor });
        moved.push(home.id);
    }
    return moved;
}

/**
 * What a save of config.categoryRoles would give a roster although another open roster holds it:
 * `[{ roleId, rosterName, otherName }]`, as the rosters would stand after the save - moving a
 * role from one category to another in one save is fine. A role the roster already holds is no
 * new conflict, so an old double never blocks a save. Empty for no map at all.
 * @param {Record<string, string[]>} categoryRoles
 * @param {{ config?: object, skip?: Set<string> }} [opts]  as syncRosterRoleIds
 */
function rolesOfOtherRosters(categoryRoles, { config, skip = new Set() } = {}) {
    if (!categoryRoles || typeof categoryRoles !== "object" || Array.isArray(categoryRoles)) return [];
    const open = rosterStore.listRosters("").filter((r) => !rosterStore.isClosed(r));
    const follows = (r) => isCurrentRoster(r, { config }) && !skip.has(r.categoryId);
    const rolesAfter = (r) => (follows(r) ? rolesIn(categoryRoles, r.categoryId) : r.roleIds);
    const found = [];
    for (const roster of open.filter(follows)) {
        for (const roleId of rolesAfter(roster).filter((id) => !roster.roleIds.includes(id))) {
            const other = open.find((r) => r.id !== roster.id && rolesAfter(r).includes(roleId));
            if (other) found.push({ roleId, rosterName: roster.name, otherName: other.name });
        }
    }
    return found;
}

/**
 * After the settings saved config.categoryRoles: a category without roster may
 * take its role's roster (adoptRosters), then the open roster of the
 * version each category plays now gets that category's roles (none = no
 * roles); a roster of another version or a closed one keeps its own (#739).
 * Returns the ids of the rosters that changed.
 * @param {Record<string, string[]>} categoryRoles  the saved, normalised map
 * @param {{ actor?: string, config?: object, skip?: Set<string> }} [opts]  `config`: the saved config (which
 *   version a category plays); `skip`: categories left alone (switched to another version in this save, #739)
 * @returns {string[]}
 */
function syncRosterRoleIds(categoryRoles, { actor = "", config, skip = new Set() } = {}) {
    // no map at all is no save of the roles - nothing to carry over
    if (!categoryRoles || typeof categoryRoles !== "object" || Array.isArray(categoryRoles)) return [];
    const map = categoryRoles;
    const changed = adoptRosters(map, { actor, config, skip });
    for (const roster of rosterStore.listRosters("")) {
        if (!isCurrentRoster(roster, { config }) || skip.has(roster.categoryId)) continue;
        const next = rolesIn(map, roster.categoryId);
        if (next.join(",") === roster.roleIds.join(",")) continue;
        rosterStore.updateRoster(roster.id, { roleIds: next }, { actor });
        if (!changed.includes(roster.id)) changed.push(roster.id);
    }
    return changed;
}

/**
 * The other direction (#657): the roster page changed a roster's roles, so the
 * settings value of its category follows - otherwise the next save of the
 * settings page (syncRosterRoleIds) would hand the roster the old roles back.
 * A roster without category touches nothing, and so does a closed one or one
 * of another version than the category plays now (#739) - the settings value
 * belongs to the current roster. A plain `{ categoryId, roleIds }` (no stored
 * roster) sets the value as given. Returns whether the config changed.
 * @param {{ categoryId?: string|null, roleIds?: string[], versionId?: string, closedAt?: string|null } | null} roster
 * @returns {boolean}
 */
function mirrorCategoryRoles(roster) {
    const cat = String((roster && roster.categoryId) || "").trim();
    if (!cat) return false;
    const configStore = require("../../stores/settings/configStore");
    const config = configStore.getConfig() || {};
    if (rosterStore.isClosed(roster)) return false;
    if (roster.versionId && roster.versionId !== currentVersionOf(cat, { config })) return false;
    const current = config.categoryRoles || {};
    const next = (roster.roleIds || []).map(String).filter(Boolean);
    if ((Array.isArray(current[cat]) ? current[cat] : []).map(String).join(",") === next.join(",")) return false;
    configStore.saveConfig({ categoryRoles: { ...current, [cat]: next } });
    return true;
}

module.exports = { expectedRoleIds, syncRosterRoleIds, rolesOfOtherRosters, mirrorCategoryRoles };
