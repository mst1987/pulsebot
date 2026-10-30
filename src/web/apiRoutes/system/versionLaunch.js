// Einstellungen → Spielversion → "Neue Version starten" (#745): the checklist
// for the switch day, computed from the real data (services/versions/versionLaunch.js),
// and the marks of the items nothing can check. Area `settings` (read for the
// list, write for a mark); the backup state only for full admins, like the
// overview's backup task.
const { ok, error } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const versionLaunch = require("../../../services/versions/versionLaunch");

/** GET /api/settings/version-launch?version=<id> — the checklist of a target version (none = the likely one). */
const getVersionLaunch = withUser({}, async ({ user, res, url }) => {
    const versionId = String(url.searchParams.get("version") || "").trim();
    ok(res, { checklist: versionLaunch.loadChecklist(versionId, { withBackup: !!user.isAdmin }) });
});

/**
 * POST /api/settings/version-launch — body: { version, item, done }. Marks a
 * manual item (backup without a backup on this instance, archive export, loot
 * addon, talk overview and reminders) done or open again; a computed item
 * answers 400. Answers the fresh checklist.
 */
const postVersionLaunch = withUser({ write: "settings", csrf: true, body: true }, async ({ user, body, res }) => {
    const versionId = String(body.version || "").trim();
    const result = versionLaunch.setManualMark(versionId, String(body.item || "").trim(), body.done === true, { byName: user.name || user.id || "" });
    if (result.error) return error(res, 400, result.code || "invalid", result.error);
    ok(res, { checklist: versionLaunch.loadChecklist(versionId, { config: result.config, withBackup: !!user.isAdmin }) });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/settings/version-launch", handler: getVersionLaunch, area: "settings" },
    { method: "POST", path: "/api/settings/version-launch", handler: postVersionLaunch, area: "settings" },
];

module.exports = { getVersionLaunch, postVersionLaunch, routes };
