const { ok } = require("../apiResponse");
const { requireAdmin } = require("../apiMiddleware");
const { activeGuildFor } = require("../activeGuild");
const { loadEventGroups } = require("../raidEventGroups");

/** GET /api/raids — all upcoming Raid-Helper events of the active guild, grouped by Discord category. */
async function getRaids(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    const { groups, error } = await loadEventGroups(guildId);
    ok(res, { groups, error, activeGuildId: guildId });
}

module.exports = { getRaids };
