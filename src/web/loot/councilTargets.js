// Who the council page works for (#676, docs/loot-council.md "Profile je
// Roster"): a roster with loot system Loot-Council (picked first), else a raid
// category without roster (the fallback), else every category ("Alle
// Raid-Kategorien"). The head names the roster, its Loot-Council profile and
// the linked Kader, with links the caller may follow.
//
// Only names and ids leave here - nothing of the Kader but its name, and that
// only for a reader of the area `kader`.
const { userCan } = require("../../config/permissions");
const rosterStore = require("../../stores/rosterStore");
const { rosterLootSystem } = require("../../services/loot/lootSystem");
const councilProfiles = require("../../services/loot/councilProfiles");
const { kaderChoices } = require("../../services/roster/rosterCreate");
const { categoryOptions } = require("./councilQuery");

/** The rosters of a server whose raids run as Loot-Council, by name. */
function councilRosters(guildId, config) {
    return rosterStore.listRosters(guildId).filter((r) => rosterLootSystem(config, r).system === "lootcouncil");
}

/**
 * The picker and the head of the council page.
 * @param {{ guildId: string, user: object, opts: object, config: object }} input
 *   `opts` = councilOptsFromQuery()'s answer (rosterId, categoryId)
 */
function councilHead({ guildId = "", user = null, opts = {}, config = {} } = {}) {
    const categories = categoryOptions(guildId);
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const canOpenKader = userCan(user, "kader", "read");
    const kaders = canOpenKader ? new Map(kaderChoices(guildId).map((k) => [k.id, k.name])) : new Map();
    const target = opts.rosterId ? { rosterId: opts.rosterId } : { categoryId: opts.categoryId || "" };
    const { profile, source, roster } = councilProfiles.resolveProfile(target);

    const listed = councilRosters(guildId, config);
    // A roster picked through a link stays in the list even when it runs another system.
    if (roster && opts.rosterId && !listed.some((r) => r.id === roster.id)) listed.push(roster);
    const rosters = listed.map((r) => {
        const p = councilProfiles.resolveProfile({ rosterId: r.id }).profile;
        return { id: r.id, name: r.name, categoryId: r.categoryId || "", categoryName: r.categoryId ? (catName.get(r.categoryId) || r.categoryId) : "", profileId: p.id, profileName: p.name };
    });
    const withoutRoster = categories.filter((c) => !rosterStore.rosterForCategory(c.id)).map((c) => {
        const p = councilProfiles.resolveProfile({ categoryId: c.id }).profile;
        return { id: c.id, name: c.name, profileId: p.id, profileName: p.name };
    });

    let headRoster = null;
    if (opts.rosterId && roster) {
        headRoster = {
            id: roster.id,
            name: roster.name,
            categoryId: roster.categoryId || "",
            categoryName: roster.categoryId ? (catName.get(roster.categoryId) || roster.categoryId) : "",
            versionId: roster.versionId,
            lootSystem: rosterLootSystem(config, roster).system,
            kaderId: roster.kaderId || null,
            kaderName: roster.kaderId && canOpenKader ? (kaders.get(roster.kaderId) || "") : "",
        };
    }
    return {
        target: opts.rosterId && roster ? "roster" : opts.categoryId ? "category" : "all",
        roster: headRoster,
        profile: councilProfiles.profileHead(profile, source),
        rosters,
        categories: withoutRoster,
        canOpenRoster: userCan(user, "roster", "read"),
        canOpenKader,
        // View changes go into the profile - the whole orga's and the addon's.
        canEditProfile: userCan(user, "lootcouncil", "write"),
    };
}

module.exports = { councilHead, councilRosters };
