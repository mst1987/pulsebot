const { ok } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { q } = require("../http/apiParams");
const systemStatus = require("../../services/system/systemStatus");

/**
 * GET /api/system/status — the "Systemstatus" page (docs/system-status.md): host and process figures with their
 * history, the route statistics, the disk and the verdict.
 *
 * Full admins only (`adminOnly`, and `full` in the handler): the page shows host details - the processes running next
 * to the bot, the files under data/ - that are nobody else's business, and no area grant should hand them out.
 *
 * ?processes=1 measures the top processes of the host anew (takes a second; the page asks when it opens and on its
 * refresh button, not on every poll). ?disk=1 walks data/ again instead of using the five-minute cache.
 */
const getStatus = withUser({ full: true }, async ({ res, query }) => {
    ok(res, await systemStatus.build({
        processes: q.bool(query, "processes"),
        forceDisk: q.bool(query, "disk"),
    }));
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/system/status", handler: getStatus, adminOnly: true },
];

module.exports = { getStatus, routes };
