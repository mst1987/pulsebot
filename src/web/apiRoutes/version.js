const { ok } = require("../apiResponse");
const { requireAdmin } = require("../apiMiddleware");
const { deployStatus } = require("../deployStatus");

/**
 * GET /api/version — which commit the server runs and how far behind main it is
 * (#314). The menu's footer line reads this; the same numbers feed the dashboard
 * task in dashboardOverview.js.
 *
 * Area "settings" (apiAccess.js): whoever can see the deploy state is whoever
 * would act on it, and it keeps a member's page load from triggering a GitHub
 * call. The commit itself is not secret — /health hands it to anyone — but the
 * comparison is an operational detail, so it stays with the settings readers.
 *
 * ?force=1 skips the ten-minute cache, for the reload after a deploy.
 */
async function getVersion(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const force = String((url && url.searchParams.get("force")) || "") === "1";
    ok(res, await deployStatus({ force }));
}

module.exports = { getVersion };
