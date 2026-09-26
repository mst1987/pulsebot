// Einstellungen → Verbindungen → Raid-Helper (#291): the switch-over checklist,
// the spec-history import and the switch that stops asking Raid-Helper. Full
// admins only — switching a foreign system off is a decision about the whole bot.
const { ok, error } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const retirement = require("../events/raidhelperRetirement");
const historyImport = require("../events/raidhelperHistoryImport");
const guildRoles = require("../../services/discord/guildRoles");
const { getConfig } = require("../../stores/settingsStore");

/** GET /api/settings/raidhelper-retirement — the checklist, computed now. */
const getRetirement = withUser({ full: true }, async ({ res }) => {
    ok(res, { checklist: await retirement.loadChecklist() });
});

/**
 * POST /api/settings/raidhelper-retirement — body: { disabled: boolean }.
 * Switching off is refused (409 `not_ready`) while a required item is open;
 * switching back on always works.
 */
const postRetirement = withUser({ full: true, csrf: true, body: true }, async ({ user, body, res }) => {
    const result = await retirement.setRaidhelperDisabled(body.disabled === true, { byName: user.name || user.id || "" });
    if (result.error) return error(res, 409, result.code, result.error);
    ok(res, result);
});

/**
 * POST /api/settings/raidhelper-history-import — body: { perCategory?, dryRun? }.
 * `dryRun` defaults to true: the dialog shows what would be stored first.
 */
const postHistoryImport = withUser({ full: true, csrf: true, body: true }, async ({ user, body, req, res }) => {
    const guildId = guildRoles.eventGuildId(getConfig()) || activeGuildFor(req);
    const result = await historyImport.runImport({
        guildId,
        perCategory: body.perCategory,
        dryRun: body.dryRun !== false,
        byName: user.name || user.id || "",
    });
    ok(res, result);
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/settings/raidhelper-retirement", handler: getRetirement, area: "settings" },
    { method: "POST", path: "/api/settings/raidhelper-retirement", handler: postRetirement, area: "settings" },
    { method: "POST", path: "/api/settings/raidhelper-history-import", handler: postHistoryImport, area: "settings" },
];

module.exports = { getRetirement, postRetirement, postHistoryImport, routes };
