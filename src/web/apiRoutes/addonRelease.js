const { ok } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { latestRelease, RELEASES_URL } = require("../../classes/addonRelease");

/**
 * GET /api/addon-release - the newest release of the sync tool + addon repo for
 * the page "Sync-Tool & Addon". Cached for an hour in classes/addonRelease.js, so
 * viewing the page never hits GitHub; the downloads are GitHub's own links, the
 * 70 MB exe is never proxied. `release` is null when GitHub is unreachable and
 * nothing is cached: the page then shows `fallbackUrl`.
 *
 * Area "history" (read): the people who import loot are the ones who run the
 * sync tool (apiAccess.js, docs/loot-import.md).
 */
const getAddonRelease = withUser({}, async ({ res }) => {
    ok(res, { release: await latestRelease(), fallbackUrl: RELEASES_URL });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/addon-release", handler: getAddonRelease, area: "history" },
];

module.exports = { getAddonRelease, routes };
