// Admin UI for the manual raider->character-per-category assignment (see
// raiderCharactersStore.js) consumed by apiRoutes/events/raidDetail.js's attendance
// enrichment.
const { ok, error } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const { activeGuildFor } = require("../../http/activeGuild");
const { getConfig } = require("../../../stores/settingsStore");
const { getCategoryAssignments, setCategoryAssignments } = require("../../../stores/raiderCharactersStore");
const { listCharacters } = require("../../../stores/characterStore");
const discord = require("../../../services/discord/discord");
const { expectedRoleIds } = require("../../../services/roster/categoryRoles");
const { mainVersionFor } = require("../../../services/versions/mainVersion");
const { buildVersionContext, versionsOfCharacter } = require("../../../services/characters/characterVersions");

/**
 * GET /api/raider-characters?category=<id> — the category's expected raiders
 * (members holding its configured attendance roles, same universe as the
 * detail page's "missing" list), their current assignments, and the known
 * character names for autocomplete - only those of the version the category
 * plays (#741: Forever = Forever characters; characterVersions.versionsOfCharacter:
 * the profiles first, a name no profile knows counts as the category's).
 */
const getRaiderCharacters = withUser({}, async ({ req, res, url }) => {
    const guildId = activeGuildFor(req);
    const categoryId = (url.searchParams.get("category") || "").trim();
    if (!categoryId) return error(res, 400, "missing_category", "Kategorie fehlt.");
    const roleIds = expectedRoleIds(categoryId, getConfig());
    let members = [];
    let membersError = null;
    if (roleIds.length) {
        const result = await discord.listMembersWithRoles(guildId, roleIds);
        members = result.members;
        membersError = result.error;
    }
    const config = getConfig();
    // the version the category plays now - the roster a save writes into (#739)
    const versionId = mainVersionFor({ categoryId, config });
    const versions = buildVersionContext({ config });
    ok(res, {
        members,
        membersError,
        roleIds,
        assignments: getCategoryAssignments(categoryId, { versionId }),
        knownCharacters: listCharacters()
            .filter((c) => versionsOfCharacter(versions, { name: c.character, categoryIds: [categoryId] }).includes(versionId))
            .map((c) => c.character),
    });
});

/**
 * POST /api/raider-characters — replace a category's whole raider->character
 * map in one call. Body: { categoryId, assignments: { [userId]: characterName } }.
 * A blank characterName removes that raider's assignment. A name is taken as
 * typed and keyed in the version the category plays now (#741, like
 * rosterMembers keeps a typed name in the roster's version) - the autocomplete
 * above offers only that version's characters, a name is never refused for
 * being known in another version too (one name may live in both).
 */
const saveRaiderCharacters = withUser({ csrf: true, body: true }, async ({ body, res, user }) => {
    const categoryId = String(body.categoryId || "").trim();
    if (!categoryId) return error(res, 400, "missing_category", "Kategorie fehlt.");
    if (!body.assignments || typeof body.assignments !== "object") {
        return error(res, 400, "invalid", "Zuordnungen fehlen.");
    }
    ok(res, { assignments: setCategoryAssignments(categoryId, body.assignments, { actor: String((user && user.id) || "") }) });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/raider-characters", handler: getRaiderCharacters, area: "settings" },
    { method: "POST", path: "/api/raider-characters", handler: saveRaiderCharacters, area: "settings" },
];

module.exports = { getRaiderCharacters, saveRaiderCharacters, routes };
