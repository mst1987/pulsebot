// The caster loot council endpoints.
//
// Two speeds, deliberately split:
//   GET  /api/lootcouncil             — the whole picture from stored data, one
//                                       page load, no simulation. `?item=<id>`
//                                       narrows it to "this just dropped: who?"
//   GET  /api/lootcouncil/item-search — the picker behind that question
//   POST /api/lootcouncil/sim         — start the DPS simulation in the background
//   GET  /api/lootcouncil/sim         — poll it
//
// Everything the page shows works without the simulation; the sim only ever
// *replaces* the stat-weight estimate with a measured number. That split is the
// point — the binary is optional (see utils/wowsims/engine.js), and a council
// looking at last month's loot should never be blocked on a simulator.

const { ok, error: apiError } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const { userCan } = require("../../config/permissions");
const { councilRoster, bisGaps, candidatesForItem, filterOptions, resolveContentFilter, itemView } = require("../lootCouncil");
const { startCouncilSim, getJob } = require("../simStore");
const { searchItems } = require("../../config/wowsims");
const engine = require("../../utils/wowsims/engine");
const discord = require("../discord");
const { getConfig } = require("../settingsStore");

/** Comma-separated query params ("t5,t6") as a clean array. */
function listParam(url, name) {
    const raw = url.searchParams.get(name) || "";
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
 * GET /api/lootcouncil — roster, BiS gaps and filter options.
 *
 * Query: role, tiers, contents, category, bisTier, item (candidates for one item)
 */
async function getLootCouncil(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!userCan(user, "lootcouncil", "read")) return apiError(res, 403, "Kein Zugriff auf den Loot-Council.");

    const role = url.searchParams.get("role") || "";
    const tierIds = listParam(url, "tiers");
    const contentIds = listParam(url, "contents");
    const categoryId = url.searchParams.get("category") || "";
    const bisTier = url.searchParams.get("bisTier") || "";
    const guildId = activeGuildFor(req);

    const { rows, avgLootCount, bisTier: usedBisTier } = councilRoster({ role, tierIds, contentIds, categoryId, bisTier });
    const contentFilter = resolveContentFilter({ tierIds, contentIds });

    // One named item ("this just dropped") short-circuits the BiS list: the
    // council wants the candidates for that item, not the whole gap report.
    const itemId = Number(url.searchParams.get("item") || 0);
    const focus = itemId > 0
        // Against the tier that was actually used, so "BiS für …" names the same
        // lists the roster's BiS column is counted against.
        ? { item: itemView(itemId, usedBisTier), candidates: candidatesForItem(itemId, rows) }
        : null;

    ok(res, {
        roster: rows,
        avgLootCount,
        gaps: focus ? [] : bisGaps(rows, { contentIds: contentFilter }),
        focus,
        options: { ...filterOptions(), categories: categoryOptions(guildId) },
        // `bisTier` is what was actually used: the admin's pick, or — when they
        // made none — the tier derived from the guild's newest loot. The page
        // says which, so "12/16 BiS" is never read against the wrong list.
        filter: { role, tierIds, contentIds, categoryId, bisTier: usedBisTier, bisTierDerived: !bisTier },
        sim: {
            available: engine.isAvailable(),
            version: engine.WOWSIMS_VERSION,
            // What the page tells the reader when there is no binary: the
            // numbers are stat-weight estimates, not simulated DPS.
            hint: engine.isAvailable()
                ? ""
                : "Keine WoWSims-Simulation verfügbar (WOWSIMCLI_PATH nicht gesetzt) — die Upgrade-Werte sind Schätzungen aus Stat-Gewichten.",
        },
        activeGuildId: guildId,
    });
}

/**
 * POST /api/lootcouncil/sim — start simulating.
 * Body: { id, subjects: [{key, specKey}], items: [itemId] }
 */
async function postLootCouncilSim(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    // Running a simulation is work the server does on request, so it takes write
    // level — a read-only council member sees the stat-weight numbers.
    if (!userCan(user, "lootcouncil", "write")) return apiError(res, 403, "Kein Zugriff auf den Loot-Council.");
    if (!requireCsrf(req, res)) return;

    const body = await readJsonBody(req);
    const id = String(body.id || "").trim();
    if (!id) return apiError(res, 400, "Job-Id fehlt.");
    const subjects = (Array.isArray(body.subjects) ? body.subjects : [])
        .map((s) => ({ key: String((s && s.key) || "").trim(), specKey: String((s && s.specKey) || "").trim() }))
        .filter((s) => s.key && s.specKey);
    if (!subjects.length) return apiError(res, 400, "Keine Raider angegeben.");
    const items = (Array.isArray(body.items) ? body.items : []).map(Number).filter((n) => n > 0);

    if (!engine.isAvailable()) {
        return apiError(res, 503, "Keine WoWSims-Simulation verfügbar — WOWSIMCLI_PATH ist nicht gesetzt.");
    }
    const started = startCouncilSim(id, subjects, items);
    ok(res, { ...started, id });
}

/**
 * GET /api/lootcouncil/item-search?q=… — items for the "this just dropped"
 * picker, searched in the generated caster table (config/wowsims).
 */
async function getItemSearch(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!userCan(user, "lootcouncil", "read")) return apiError(res, 403, "Kein Zugriff auf den Loot-Council.");
    ok(res, { items: searchItems(url.searchParams.get("q") || "") });
}

/** GET /api/lootcouncil/sim?id=… — poll a running simulation. */
async function getLootCouncilSim(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!userCan(user, "lootcouncil", "read")) return apiError(res, 403, "Kein Zugriff auf den Loot-Council.");
    const job = getJob(url.searchParams.get("id") || "");
    if (!job) return ok(res, { status: "unknown" });
    ok(res, job);
}

module.exports = { getLootCouncil, postLootCouncilSim, getLootCouncilSim, getItemSearch };
