// Einstellungen → Verbindungen → Discord-Server: the raid list of each link
// (#257, #361, #892, services/talk/talkOverview.js). Full admins only, like
// the rest of that section. A list is named by its link's `key` ("from:to");
// `guildId` (the source server) still works and means its first link.
const { ok, error } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const talkOverview = require("../../services/talk/talkOverview");

/** The status of the list named by `key`, else of the first link of `guildId`. */
function findStatus(key, guildId) {
    const statuses = talkOverview.overviewStatus();
    if (key) return statuses.find((s) => s.key === key) || null;
    return statuses.find((s) => s.guildId === guildId) || null;
}

/**
 * GET /api/settings/talk-overview — without `key`/`guildId`: every link's
 * list state (`{ statuses }`), for the settings cards. With one of them: that
 * list's state plus `preview` — the message exactly as a sync would post it
 * now (a dry run, nothing is sent). `?preview=0` skips building it.
 */
const getTalkOverview = withUser({ full: true }, async ({ res, url }) => {
    const key = url ? String(url.searchParams.get("key") || "").trim() : "";
    const guildId = url ? String(url.searchParams.get("guildId") || "").trim() : "";
    if (!key && !guildId) {
        ok(res, { statuses: talkOverview.overviewStatus() });
        return;
    }
    const status = findStatus(key, guildId);
    // A key names exactly one link: an unknown one previews nothing (never another link of its source).
    if (key && !status) return error(res, 400, "unconfigured", "Für diese Verknüpfung ist keine Raid-Liste eingestellt.");
    let preview = null;
    let previewError = null;
    if (!url || url.searchParams.get("preview") !== "0") {
        try {
            const built = await talkOverview.currentPayload(key ? { key } : { guildId });
            preview = built.payload;
            previewError = built.error || null;
        } catch (e) {
            previewError = e.message;
        }
    }
    ok(res, { status, preview, previewError });
});

/**
 * POST /api/settings/talk-overview — body: { key | guildId, repost?: boolean }.
 * Syncs the named list now; `repost` deletes the old message and posts a
 * fresh one at the channel's end.
 */
const postTalkOverview = withUser({ full: true, csrf: true, body: true }, async ({ body, res }) => {
    const key = String(body.key || "").trim();
    const guildId = String(body.guildId || "").trim();
    if (!key && !guildId) return error(res, 400, "guildId", "Keine Verknüpfung angegeben.");
    const result = await talkOverview.syncOverview({ repost: body.repost === true, ...(key ? { key } : { guildId }) });
    if (result.status === "unconfigured") {
        return error(res, 400, "unconfigured", "Für diese Verknüpfung ist keine Raid-Liste eingestellt.");
    }
    ok(res, { result, status: findStatus(key, guildId) });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/settings/talk-overview", handler: getTalkOverview, area: "settings" },
    { method: "POST", path: "/api/settings/talk-overview", handler: postTalkOverview, area: "settings" },
];

module.exports = { getTalkOverview, postTalkOverview, routes };
