const { ok } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const { publicVersions } = require("../../../config/gameVersions");
const { mainVersionFor, visibleVersions } = require("../../../services/versions/mainVersion");
const { getConfig } = require("../../../stores/settings/settingsStore");

/**
 * GET /api/game-versions — the rule set of every game version (classes, specs
 * and roles, instances with sizes, bosses and suggested tanks/healers, party
 * and raid buffs). Static data from config/gameVersions; nothing is stored.
 * `defaultVersion` is the main version from the settings (#541), the one of
 * `?categoryId=` when the category plays another. `visible` names the versions a
 * picker may offer (#563: only the main one while the others are hidden); the rule
 * sets themselves stay complete, a stored record of a hidden version still needs them.
 */
const getGameVersions = withUser({}, async ({ res, url }) => {
    const categoryId = url ? String(url.searchParams.get("categoryId") || "").trim() : "";
    const config = getConfig();
    ok(res, { versions: publicVersions(), defaultVersion: mainVersionFor({ categoryId, config }), visible: visibleVersions(config) });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    // The raid plan's templates and catalog show one version at a time, so "raidplan" reads the list too.
    { method: "GET", path: "/api/game-versions", handler: getGameVersions, area: ["raids", "raidplan"] },
];

module.exports = { getGameVersions, routes };
