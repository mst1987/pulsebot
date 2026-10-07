// How a request's query string becomes the options of councilRoster(), shared by
// the council page (GET /api/lootcouncil) and the sync tool's token endpoint
// (GET /api/ingest/council) so both answer from the same roster.
const { getConfig } = require("../../stores/settingsStore");
const discord = require("../../services/discord/discord");
const { mainVersionFor, resolveVersionQuery } = require("../../services/events/mainVersion");

/** Comma-separated query params ("t5,t6") as a clean array. */
function listParam(searchParams, name) {
    const raw = searchParams.get(name) || "";
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** The raid categories the filter can narrow to, named for the dropdown. */
function categoryOptions(guildId) {
    const config = getConfig();
    const ids = config.categoryIds || [];
    const known = new Map(discord.listCategories(guildId).map((c) => [c.id, c.name]));
    return ids.map((id) => ({ id, name: known.get(id) || id }));
}

/**
 * The councilRoster() options for a query: role, tiers, contents, category,
 * bisTier, version. `versionId` is the one the council looks at (#542: the
 * category's, else the main version - links, gear realm, Wowhead path);
 * `charVersion` is the character filter (#545), separate from it.
 * @param {URLSearchParams} searchParams
 */
function councilOptsFromQuery(searchParams) {
    const categoryId = searchParams.get("category") || "";
    const config = getConfig();
    const { versionId: charVersion, mainVersion } = resolveVersionQuery(searchParams.get("version"), { config });
    return {
        role: searchParams.get("role") || "",
        tierIds: listParam(searchParams, "tiers"),
        contentIds: listParam(searchParams, "contents"),
        categoryId,
        bisTier: searchParams.get("bisTier") || "",
        versionId: mainVersionFor({ categoryId, config }),
        config,
        mainVersion,
        charVersion,
    };
}

module.exports = { listParam, categoryOptions, councilOptsFromQuery };
