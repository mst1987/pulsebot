// Which Loot-Council profile applies (#676, docs/loot-council.md "Profile je
// Roster"): the council's weighting and view come from a profile
// (stores/councilProfilesStore.js), picked per roster:
//
//   1. the roster's own (`roster.lootProfileId`, set in the roster settings),
//   2. else the profile its category keeps (a category without roster, or one
//      the migration could not hand to a roster - `categories` in the store),
//   3. else the default profile ("Standard").
//
// A target is `{ rosterId }` (a roster picked on the council page, with or
// without category) or `{ categoryId }` (the category's roster when it has one,
// else the category itself) or nothing ("Alle Raid-Kategorien" = the default).
// Every reader goes through here - the page, the drop check, the addon's sync
// (web/loot/councilView.js) - so they can never disagree.
const profilesStore = require("../../stores/councilProfilesStore");
const rosterStore = require("../../stores/rosterStore");
const { rosterLootSystem } = require("./lootSystem");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** The roster a target means: the named one, else the category's, else null. */
function rosterOfTarget({ rosterId = "", categoryId = "" } = {}) {
    if (str(rosterId)) return rosterStore.getRoster(str(rosterId));
    return str(categoryId) ? rosterStore.rosterForCategory(str(categoryId)) : null;
}

/**
 * The profile of a target and where it came from.
 * @param {{ rosterId?: string, categoryId?: string }} [target]
 * @returns {{ profile: object, source: "roster" | "category" | "default", roster: object|null, categoryId: string }}
 */
function resolveProfile(target = {}) {
    const roster = rosterOfTarget(target);
    const categoryId = (roster && roster.categoryId) || (roster ? "" : str(target.categoryId));
    const own = roster && roster.lootProfileId ? profilesStore.getProfile(roster.lootProfileId) : null;
    if (own) return { profile: own, source: "roster", roster, categoryId };
    const mapped = categoryId ? profilesStore.getProfile(profilesStore.categoryProfileId(categoryId)) : null;
    if (mapped) return { profile: mapped, source: "category", roster, categoryId };
    return { profile: profilesStore.defaultProfile(), source: "default", roster, categoryId };
}

/** The profile's name and id as a reader shows it. */
function profileHead(profile, source = "") {
    return { id: profile.id, name: profile.name, isDefault: profile.id === profilesStore.defaultProfileId(), ...(source ? { source } : {}) };
}

/**
 * The weighting the council uses for a target, in councilWeightsStore's shape
 * plus `scope` ("global" for the default profile, else "profile") and the
 * profile's id and name.
 */
function weightsFor(target = {}) {
    const { profile } = resolveProfile(target);
    const isDefault = profile.id === profilesStore.defaultProfileId();
    return { ...profile.weights, at: profile.at, by: profile.by, scope: isDefault ? "global" : "profile", profileId: profile.id, profileName: profile.name };
}

/** The view (role, tiers, contents, bisTier, version) of a target's profile. `stored` = the profile is on disk. */
function viewFor(target = {}) {
    const { profile } = resolveProfile(target);
    const { role, tiers, contents, bisTier, version } = profile.view;
    return { role, tiers: [...tiers], contents: [...contents], bisTier, version, stored: profile.stored !== false, profileId: profile.id };
}

/** Whether a roster or a category entry names the profile - such a profile cannot be deleted. */
function profileInUse(profileId) {
    const id = str(profileId);
    if (!id) return false;
    return rosterStore.listRosters("").some((r) => r.lootProfileId === id)
        || Object.values(profilesStore.categoryProfiles()).includes(id);
}

/**
 * Who uses which profile: per profile the Loot-Council rosters it applies to
 * (by their own choice, by their category or as the default), the rosters that
 * name it while running another loot system (`otherRosters` - they still keep
 * it from being deleted) and the categories without roster that keep it.
 * @param {{ config: object, guildId?: string }} opts
 * @returns {Map<string, { rosters: { id, name }[], otherRosters: { id, name }[], categories: string[] }>}
 */
function profileUsage({ config = {}, guildId = "" } = {}) {
    const usage = new Map();
    const slot = (id) => {
        if (!usage.has(id)) usage.set(id, { rosters: [], otherRosters: [], categories: [] });
        return usage.get(id);
    };
    for (const roster of rosterStore.listRosters(guildId)) {
        const council = rosterLootSystem(config, roster).system === "lootcouncil";
        if (council) slot(resolveProfile({ rosterId: roster.id }).profile.id).rosters.push({ id: roster.id, name: roster.name });
        else if (roster.lootProfileId) slot(roster.lootProfileId).otherRosters.push({ id: roster.id, name: roster.name });
    }
    for (const [categoryId, profileId] of Object.entries(profilesStore.categoryProfiles())) {
        if (!rosterStore.rosterForCategory(categoryId)) slot(profileId).categories.push(categoryId);
    }
    return usage;
}

module.exports = { resolveProfile, profileHead, weightsFor, viewFor, profileInUse, profileUsage, rosterOfTarget };
