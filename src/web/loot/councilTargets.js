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
const { currentRoster } = require("../../services/roster/categoryRoster");
const { kaderChoices } = require("../../services/roster/rosterCreate");
const { categoryOptions, pickVersion } = require("./councilQuery");

/**
 * The rosters of a server whose raids run as Loot-Council, by name. With
 * `versionId` only the rosters of that version (#741).
 */
function councilRosters(guildId, config, { versionId = "" } = {}) {
    return rosterStore.listRosters(guildId)
        .filter((r) => !versionId || pickVersion({ roster: r }) === versionId)
        .filter((r) => rosterLootSystem(config, r).system === "lootcouncil");
}

/**
 * The picker and the head of the council page.
 * @param {{ guildId: string, user: object, opts: object, config: object }} input
 *   `opts` = pageCouncilOpts()'s answer (rosterId, categoryId, charVersion, droppedPick)
 *
 * The picker offers only what plays the page's version (`opts.charVersion`,
 * the menu's, #741/#563): rosters of that version, categories that play it. A
 * pick of another version never reaches here (pageCouncilOpts drops it);
 * `dropped` tells the page which one it was.
 */
function councilHead({ guildId = "", user = null, opts = {}, config = {} } = {}) {
    const versionId = opts.charVersion || "";
    // every category for the names, only the version's to pick
    const allCategories = categoryOptions(guildId, { config });
    const categories = versionId ? categoryOptions(guildId, { versionId, config }) : allCategories;
    const catName = new Map(allCategories.map((c) => [c.id, c.name]));
    const canOpenKader = userCan(user, "kader", "read");
    const kaders = canOpenKader ? new Map(kaderChoices(guildId).map((k) => [k.id, k.name])) : new Map();
    const target = opts.rosterId ? { rosterId: opts.rosterId } : { categoryId: opts.categoryId || "" };
    const { profile, source, roster } = councilProfiles.resolveProfile(target);

    const listed = councilRosters(guildId, config, { versionId });
    // A roster picked through a link stays in the list even when it runs another system (never another version: see above).
    if (roster && opts.rosterId && !listed.some((r) => r.id === roster.id)) listed.push(roster);
    const rosters = listed.map((r) => {
        const p = councilProfiles.resolveProfile({ rosterId: r.id }).profile;
        return { id: r.id, name: r.name, categoryId: r.categoryId || "", categoryName: r.categoryId ? (catName.get(r.categoryId) || r.categoryId) : "", profileId: p.id, profileName: p.name };
    });
    // without a roster of the version the category plays now (#739)
    const withoutRoster = categories.filter((c) => !currentRoster(c.id, { config })).map((c) => {
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
        // The pick the page asked for that plays another version (pageCouncilOpts), else null.
        dropped: opts.droppedPick || null,
        canOpenRoster: userCan(user, "roster", "read"),
        canOpenKader,
        // View changes go into the profile - the whole orga's and the addon's.
        canEditProfile: userCan(user, "lootcouncil", "write"),
    };
}

module.exports = { councilHead, councilRosters };
