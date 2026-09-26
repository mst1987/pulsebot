// Einstellungen → Verbindungen → Discord-Server: each event server's own raid
// overview (#257, #361, services/talk/talkOverview.js). Full admins only, like the rest
// of that section.
const { ok, error } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const talkOverview = require("../../services/talk/talkOverview");

/**
 * GET /api/settings/talk-overview — without `guildId`: every configured event
 * server's overview state (`{ statuses }`), for the settings cards. With
 * `guildId`: that one server's state plus `preview` — the message exactly as
 * a sync would post it now (a dry run, nothing is sent). `?preview=0` skips
 * building it.
 */
const getTalkOverview = withUser({ full: true }, async ({ res, url }) => {
    const guildId = url ? String(url.searchParams.get("guildId") || "").trim() : "";
    if (!guildId) {
        ok(res, { statuses: talkOverview.overviewStatus() });
        return;
    }
    const status = talkOverview.overviewStatus().find((s) => s.guildId === guildId) || null;
    let preview = null;
    let previewError = null;
    if (!url || url.searchParams.get("preview") !== "0") {
        try {
            const built = await talkOverview.currentPayload({ guildId });
            preview = built.payload;
            previewError = built.error || null;
        } catch (e) {
            previewError = e.message;
        }
    }
    ok(res, { status, preview, previewError });
});

/**
 * POST /api/settings/talk-overview — body: { guildId, repost?: boolean }.
 * Syncs the named event server's overview now; `repost` deletes the old
 * message and posts a fresh one at the channel's end.
 */
const postTalkOverview = withUser({ full: true, csrf: true, body: true }, async ({ body, res }) => {
    const guildId = String(body.guildId || "").trim();
    if (!guildId) return error(res, 400, "guildId", "Kein Event-Server angegeben.");
    const result = await talkOverview.syncOverview({ repost: body.repost === true, guildId });
    if (result.status === "unconfigured") {
        return error(res, 400, "unconfigured", "Für diesen Event-Server ist kein Übersichts-Ziel eingestellt.");
    }
    const status = talkOverview.overviewStatus().find((s) => s.guildId === guildId) || null;
    ok(res, { result, status });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/settings/talk-overview", handler: getTalkOverview, area: "settings" },
    { method: "POST", path: "/api/settings/talk-overview", handler: postTalkOverview, area: "settings" },
];

module.exports = { getTalkOverview, postTalkOverview, routes };
