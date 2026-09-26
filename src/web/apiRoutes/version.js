const { ok } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { deployStatus } = require("../http/deployStatus");

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
const getVersion = withUser({}, async ({ res, url }) => {
    const force = String((url && url.searchParams.get("force")) || "") === "1";
    ok(res, await deployStatus({ force }));
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/version", handler: getVersion, area: "settings" },
];

module.exports = { getVersion, routes };
