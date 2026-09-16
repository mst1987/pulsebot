const { ok } = require("../apiResponse");
const { requireAdmin } = require("../apiMiddleware");
const { publicVersions, DEFAULT_VERSION } = require("../../config/gameVersions");

/**
 * GET /api/game-versions — the rule set of every game version (classes, specs
 * and roles, instances with sizes, bosses and suggested tanks/healers, party
 * and raid buffs). Static data from config/gameVersions; nothing is stored.
 */
function getGameVersions(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    ok(res, { versions: publicVersions(), defaultVersion: DEFAULT_VERSION });
}

module.exports = { getGameVersions };
