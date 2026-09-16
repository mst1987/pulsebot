// Einstellungen → Verbindungen → Raid-Helper (#291): the switch-over checklist,
// the spec-history import and the switch that stops asking Raid-Helper. Full
// admins only — switching a foreign system off is a decision about the whole bot.
const { ok, error } = require("../apiResponse");
const { requireFullAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const retirement = require("../raidhelperRetirement");
const historyImport = require("../raidhelperHistoryImport");
const guildRoles = require("../guildRoles");
const { getConfig } = require("../settingsStore");

/** GET /api/settings/raidhelper-retirement — the checklist, computed now. */
async function getRetirement(req, res) {
    if (!requireFullAdmin(req, res)) return;
    ok(res, { checklist: await retirement.loadChecklist() });
}

/**
 * POST /api/settings/raidhelper-retirement — body: { disabled: boolean }.
 * Switching off is refused (409 `not_ready`) while a required item is open;
 * switching back on always works.
 */
async function postRetirement(req, res) {
    const user = requireFullAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const result = await retirement.setRaidhelperDisabled(body.disabled === true, { byName: user.name || user.id || "" });
    if (result.error) return error(res, 409, result.code, result.error);
    ok(res, result);
}

/**
 * POST /api/settings/raidhelper-history-import — body: { perCategory?, dryRun? }.
 * `dryRun` defaults to true: the dialog shows what would be stored first.
 */
async function postHistoryImport(req, res) {
    const user = requireFullAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const guildId = guildRoles.eventGuildId(getConfig()) || activeGuildFor(req);
    const result = await historyImport.runImport({
        guildId,
        perCategory: body.perCategory,
        dryRun: body.dryRun !== false,
        byName: user.name || user.id || "",
    });
    ok(res, result);
}

module.exports = { getRetirement, postRetirement, postHistoryImport };
