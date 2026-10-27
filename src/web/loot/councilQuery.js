// How a request's query string becomes the options of councilRoster(), shared by
// the council page (GET /api/lootcouncil) and the sync tool's token endpoint
// (GET /api/ingest/council) so both answer from the same roster.
const { getConfig } = require("../../stores/settingsStore");
const discord = require("../../services/discord/discord");
const { getRoster } = require("../../stores/rosterStore");
const { mainVersionFor, resolveVersionQuery, knownVersion } = require("../../services/events/mainVersion");
const { LEGACY_VERSION } = require("../../config/gameVersions");

/** Comma-separated query params ("t5,t6") as a clean array. */
function listParam(searchParams, name) {
    const raw = searchParams.get(name) || "";
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * The version a council pick plays: a roster its own stored one (#737/#739), a
 * category the one it plays (`categoryVersion`, else the main version).
 */
function pickVersion({ roster = null, categoryId = "", config } = {}) {
    if (roster) return knownVersion(roster.versionId) || LEGACY_VERSION;
    return mainVersionFor({ categoryId, config });
}

/**
 * The raid categories the filter can narrow to, named for the dropdown. With
 * `versionId` only the categories that play that version (#741: the page shows
 * one version, a TBC category is nothing to pick in the Forever council).
 */
function categoryOptions(guildId, { versionId = "", config } = {}) {
    const cfg = config || getConfig();
    const ids = cfg.categoryIds || [];
    const known = new Map(discord.listCategories(guildId).map((c) => [c.id, c.name]));
    return ids
        .filter((id) => !versionId || pickVersion({ categoryId: id, config: cfg }) === versionId)
        .map((id) => ({ id, name: known.get(id) || id }));
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
 * @param {{ guildId?: string, allowAll?: boolean }} [ctx]  the active server - a roster of another one is ignored;
 *   `allowAll`: a stored view may still say "all" (#741: only the sync tool's views, never the page)
 */
function councilOptsFromQuery(searchParams, { guildId = "", allowAll = false } = {}) {
    const roster = queriedRoster(searchParams, guildId);
    const categoryId = roster ? (roster.categoryId || "") : (searchParams.get("category") || "");
    const config = getConfig();
    const { versionId: charVersion, mainVersion } = resolveVersionQuery(searchParams.get("version"), { config, allowAll });
    // Without a roster or a category of its own version, the content switch (an explicit
    // `version`) decides what the council looks at (#748): a Forever view gets no TBC content.
    const rawVersion = String(searchParams.get("version") || "").trim();
    const explicit = rawVersion && rawVersion !== "all" && charVersion === knownVersion(rawVersion) ? charVersion : "";
    const catMap = config.categoryVersion && typeof config.categoryVersion === "object" ? config.categoryVersion : {};
    const categoryOwn = categoryId ? knownVersion(catMap[categoryId]) : "";
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
        versionId: roster ? roster.versionId : (categoryOwn || explicit || mainVersionFor({ categoryId, config })),
        config,
        mainVersion,
        charVersion,
        // Only the loot of this Discord server counts (#919; undefined = every server, "" = none).
        guildId,
    };
}

/**
 * The council options of the page (GET /api/lootcouncil, its drop check and
 * POST /api/lootcouncil/sim): councilOptsFromQuery(), but the menu's version
 * comes first (#741, #563). A roster or a category of another version - a
 * stale pick from before the menu was switched, a link, a version hidden in
 * the settings - is no pick of this page: the answer is the version's "Alle
 * Raid-Kategorien", and `droppedPick` ({ kind, id, versionId }) names what was
 * asked, so the page can follow a link into its version or forget the pick.
 * The sync tool's stored views do not come through here (councilView.js).
 * @param {URLSearchParams} searchParams
 * @param {{ guildId?: string }} [ctx]
 */
function pageCouncilOpts(searchParams, { guildId = "" } = {}) {
    const opts = councilOptsFromQuery(searchParams, { guildId });
    if (!opts.rosterId && !opts.categoryId) return opts;
    const roster = opts.rosterId ? getRoster(opts.rosterId) : null;
    const versionId = pickVersion({ roster, categoryId: opts.categoryId, config: opts.config });
    if (versionId === opts.charVersion) return opts;
    return {
        ...opts,
        rosterId: "",
        categoryId: "",
        versionId: opts.charVersion,
        droppedPick: { kind: roster ? "roster" : "category", id: roster ? roster.id : opts.categoryId, versionId },
    };
}

module.exports = { listParam, categoryOptions, councilOptsFromQuery, pageCouncilOpts, pickVersion, queriedRoster };
