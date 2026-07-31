const { ok } = require("../apiResponse");
const { requireAdmin } = require("../apiMiddleware");
const { activeGuildFor } = require("../activeGuild");
const { buildRoster } = require("../roster");
const { rosterStats } = require("../rosterStats");
const { repairItemNames: repairLootItemNames } = require("../lootStore");

/** GET /api/roster — every character grouped by raid category (see roster.js). */
async function getRoster(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    // Same one-time backfill the loot pages run, so the hover panel never shows
    // "Item <id>" for rows imported before icon enrichment existed.
    await repairLootItemNames();
    const guildId = activeGuildFor(req);
    const { chars, categories } = buildRoster(guildId);
    // Aggregated server-side so the header band and the table can never
    // disagree, and so the numbers are covered by the test suite.
    ok(res, { chars, categories, stats: rosterStats(chars), activeGuildId: guildId });
}

module.exports = { getRoster };
