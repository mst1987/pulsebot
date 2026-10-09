// One council view, built the same way for every reader: the council page
// (GET /api/lootcouncil) and the sync tool's token endpoint
// (GET /api/ingest/council?v=2 and ?v=3), so what the addon shows in game is exactly
// what the page shows - same filters, same armory step, same numbers.
//
// A council's filters (role, tiers, raids, BiS list, version) are the view of
// its Loot-Council profile (#676: the roster's profile, else the category's,
// else the default - services/loot/councilProfiles.js). The page edits them,
// the ingest endpoint reads them for every category whose loot system is
// "lootcouncil" (services/loot/lootSystem.js).
const { councilRoster } = require("./lootCouncil");
const { councilOptsFromQuery } = require("./councilQuery");
const { primeArmoryGear } = require("../../services/loot/armoryGear");
const { categoryLootSystem } = require("../../services/loot/lootSystem");
const councilProfiles = require("../../services/loot/councilProfiles");
const { getRaidTemplate } = require("../../stores/raidTemplateStore");
const { instanceById } = require("../../config/gameVersions");

/**
 * councilRoster() for these options, plus the armory step of the page: a set
 * that still holds a boss-specific piece is the one case the logs cannot
 * answer, so only those names are asked (cached in armoryGear.js) and the
 * roster is built again when the armory answered. A failing armory never
 * fails the view.
 * @param {object} opts  councilOptsFromQuery()'s answer
 */
async function buildCouncilView(opts) {
    let built = councilRoster(opts);
    const needArmory = built.rows.filter((r) => r.gear && r.gear.dropped && r.gear.dropped.length).map((r) => r.character);
    if (needArmory.length) {
        try {
            const primed = await primeArmoryGear(needArmory, { versionId: opts.versionId });
            if (primed && primed.answered) built = councilRoster(opts);
        } catch (e) {
            console.error("armory gear failed:", e.message);
        }
    }
    return built;
}

/**
 * The query the page sends for this stored view of a category - built the way
 * api/lootcouncil.ts' getLootCouncil() builds it, so both go through the very
 * same councilOptsFromQuery().
 */
function viewQuery(categoryId, view) {
    const params = new URLSearchParams();
    if (view.role) params.set("role", view.role);
    if (view.tiers && view.tiers.length) params.set("tiers", view.tiers.join(","));
    if (view.contents && view.contents.length) params.set("contents", view.contents.join(","));
    if (categoryId) params.set("category", categoryId);
    if (view.bisTier) params.set("bisTier", view.bisTier);
    if (view.version) params.set("version", view.version);
    return params;
}

/** The configured categories whose raids run as Loot-Council, in settings order. */
function councilCategoryIds(config) {
    return ((config && config.categoryIds) || [])
        .map(String)
        .filter((id) => categoryLootSystem(config, id).system === "lootcouncil");
}

/**
 * The raids a category plays, from its default raid template
 * (config.categoryRaidTemplate) - a hint for the addon to pick the category
 * by GetInstanceInfo(). [] when the category has no template or the template
 * names no instance.
 */
function categoryInstances(config, categoryId) {
    const tplId = ((config && config.categoryRaidTemplate) || {})[categoryId];
    const tpl = tplId ? getRaidTemplate(tplId) : null;
    const ids = (tpl && Array.isArray(tpl.instanceIds)) ? tpl.instanceIds : [];
    return ids.map((id) => instanceById(id)).filter(Boolean).map((i) => ({
        id: i.id,
        name: i.name || i.id,
        short: i.short || "",
        zoneNames: Array.isArray(i.zoneNames) ? i.zoneNames.slice() : [],
    }));
}

/**
 * One category's council exactly as the page shows it for that category:
 * its profile's view (#676: the profile of the category's roster, else the
 * category's own, else the default), the options the page's query would give,
 * and the built roster. `profile` and `roster` name where the values came from.
 */
async function categoryCouncil(categoryId) {
    const { profile, roster, source } = councilProfiles.resolveProfile({ categoryId });
    const view = councilProfiles.viewFor({ categoryId });
    const opts = councilOptsFromQuery(viewQuery(categoryId, view));
    const built = await buildCouncilView(opts);
    return {
        view, opts, built,
        profile: councilProfiles.profileHead(profile, source),
        roster: roster ? { id: roster.id, name: roster.name } : null,
    };
}

module.exports = { buildCouncilView, viewQuery, councilCategoryIds, categoryInstances, categoryCouncil };
