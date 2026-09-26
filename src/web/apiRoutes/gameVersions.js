const { ok } = require("../apiResponse");
const { withUser } = require("../apiHandler");
const { publicVersions, DEFAULT_VERSION } = require("../../config/gameVersions");

/**
 * GET /api/game-versions — the rule set of every game version (classes, specs
 * and roles, instances with sizes, bosses and suggested tanks/healers, party
 * and raid buffs). Static data from config/gameVersions; nothing is stored.
 */
const getGameVersions = withUser({}, async ({ res }) => {
    ok(res, { versions: publicVersions(), defaultVersion: DEFAULT_VERSION });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/game-versions", handler: getGameVersions, area: "raids" },
];

module.exports = { getGameVersions, routes };
