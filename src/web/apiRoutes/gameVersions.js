const { ok } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { publicVersions } = require("../../config/gameVersions");
const { mainVersionFor } = require("../../services/events/mainVersion");
const { getConfig } = require("../../stores/settingsStore");

/**
 * GET /api/game-versions — the rule set of every game version (classes, specs
 * and roles, instances with sizes, bosses and suggested tanks/healers, party
 * and raid buffs). Static data from config/gameVersions; nothing is stored.
 * `defaultVersion` is the main version from the settings (#541), the one of
 * `?categoryId=` when the category plays another.
 */
const getGameVersions = withUser({}, async ({ res, url }) => {
    const categoryId = url ? String(url.searchParams.get("categoryId") || "").trim() : "";
    ok(res, { versions: publicVersions(), defaultVersion: mainVersionFor({ categoryId, config: getConfig() }) });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/game-versions", handler: getGameVersions, area: "raids" },
];

module.exports = { getGameVersions, routes };
