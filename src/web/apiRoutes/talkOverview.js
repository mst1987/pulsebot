// Einstellungen → Verbindungen → Discord-Server: the raid overview on the talk
// server (#257, web/talkOverview.js). Full admins only, like the rest of that
// section.
const { ok, error } = require("../apiResponse");
const { requireFullAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const talkOverview = require("../talkOverview");

/**
 * GET /api/settings/talk-overview — where the overview sits and when it was
 * posted/edited, plus `preview`: the message exactly as a sync would post it
 * now (a dry run, nothing is sent). `?preview=0` skips building it.
 */
async function getTalkOverview(req, res, url) {
    if (!requireFullAdmin(req, res)) return;
    const status = talkOverview.overviewStatus();
    let preview = null;
    let previewError = null;
    if (!url || url.searchParams.get("preview") !== "0") {
        try {
            const built = await talkOverview.currentPayload();
            preview = built.payload;
            previewError = built.error || null;
        } catch (e) {
            previewError = e.message;
        }
    }
    ok(res, { status, preview, previewError });
}

/**
 * POST /api/settings/talk-overview — body: { repost?: boolean }. Syncs now;
 * `repost` deletes the old message and posts a fresh one at the channel's end.
 */
async function postTalkOverview(req, res) {
    if (!requireFullAdmin(req, res)) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const result = await talkOverview.syncOverview({ repost: body.repost === true });
    if (result.status === "unconfigured") {
        return error(res, 400, "unconfigured", "Kein Kommunikations-Discord oder kein Übersichts-Kanal eingestellt.");
    }
    ok(res, { result, status: talkOverview.overviewStatus() });
}

module.exports = { getTalkOverview, postTalkOverview };
