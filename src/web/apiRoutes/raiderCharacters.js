// Admin UI for the manual raider->character-per-category assignment (see
// raiderCharactersStore.js) consumed by apiRoutes/raidDetail.js's attendance
// enrichment.
const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const { getConfig } = require("../settingsStore");
const { getCategoryAssignments, setCategoryAssignments } = require("../raiderCharactersStore");
const { listCharacters } = require("../characterStore");
const discord = require("../discord");

/**
 * GET /api/raider-characters?category=<id> — the category's expected raiders
 * (members holding its configured attendance roles, same universe as the
 * detail page's "missing" list), their current assignments, and the known
 * character names for autocomplete.
 */
async function getRaiderCharacters(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    const categoryId = (url.searchParams.get("category") || "").trim();
    if (!categoryId) return error(res, 400, "missing_category", "Kategorie fehlt.");
    const roleIds = (getConfig().categoryRoles || {})[categoryId] || [];
    let members = [];
    let membersError = null;
    if (roleIds.length) {
        const result = await discord.listMembersWithRoles(guildId, roleIds);
        members = result.members;
        membersError = result.error;
    }
    ok(res, {
        members,
        membersError,
        roleIds,
        assignments: getCategoryAssignments(categoryId),
        knownCharacters: listCharacters().map((c) => c.character),
    });
}

/**
 * POST /api/raider-characters — replace a category's whole raider->character
 * map in one call. Body: { categoryId, assignments: { [userId]: characterName } }.
 * A blank characterName removes that raider's assignment.
 */
async function saveRaiderCharacters(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const categoryId = String(body.categoryId || "").trim();
    if (!categoryId) return error(res, 400, "missing_category", "Kategorie fehlt.");
    if (!body.assignments || typeof body.assignments !== "object") {
        return error(res, 400, "invalid", "Zuordnungen fehlen.");
    }
    ok(res, { assignments: setCategoryAssignments(categoryId, body.assignments) });
}

module.exports = { getRaiderCharacters, saveRaiderCharacters };
