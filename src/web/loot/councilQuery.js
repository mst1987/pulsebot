// How a request's query string becomes the options of councilRoster(), shared by
// the council page (GET /api/lootcouncil) and the sync tool's token endpoint
// (GET /api/ingest/council) so both answer from the same roster.
const { getConfig } = require("../../stores/settingsStore");
const discord = require("../../services/discord/discord");
const { getRoster } = require("../../stores/rosterStore");
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
 * The roster a `roster` query names (#676), or null: unknown, or of another
 * server than `guildId` (when both are known).
 */
function queriedRoster(searchParams, guildId = "") {
    const id = String(searchParams.get("roster") || "").trim();
    const roster = id ? getRoster(id) : null;
    if (!roster) return null;
    return guildId && roster.guildId && roster.guildId !== guildId ? null : roster;
}

/**
 * The councilRoster() options for a query: roster, role, tiers, contents,
 * category, bisTier, version, bench. A `roster` (#676) wins over `category`:
 * its category (or none) and its game version count. `versionId` is the one the
 * council looks at (#542: the roster's, else the category's, else the main
 * version - links, gear realm, Wowhead path); `charVersion` is the character
 * filter (#545), separate from it.
 * @param {URLSearchParams} searchParams
 * @param {{ guildId?: string }} [ctx]  the active server - a roster of another one is ignored
 */
function councilOptsFromQuery(searchParams, { guildId = "" } = {}) {
    const roster = queriedRoster(searchParams, guildId);
    const categoryId = roster ? (roster.categoryId || "") : (searchParams.get("category") || "");
    const config = getConfig();
    const { versionId: charVersion, mainVersion } = resolveVersionQuery(searchParams.get("version"), { config });
    return {
        role: searchParams.get("role") || "",
        tierIds: listParam(searchParams, "tiers"),
        contentIds: listParam(searchParams, "contents"),
        categoryId,
        rosterId: roster ? roster.id : "",
        bisTier: searchParams.get("bisTier") || "",
        // With a roster: Ersatz shown as candidates too (#667). Only the page
        // asks for it; a stored category view (and so the addon) never does.
        showBench: searchParams.get("bench") === "1",
        versionId: roster ? roster.versionId : mainVersionFor({ categoryId, config }),
        config,
        mainVersion,
        charVersion,
    };
}

module.exports = { listParam, categoryOptions, councilOptsFromQuery, queriedRoster };
