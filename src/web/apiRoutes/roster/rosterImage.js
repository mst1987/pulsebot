// The roster as a picture ("Roster als Bild", docs/roster-profile.md): the PNG for the
// dialog's preview and download, what the dialog may offer, and posting the picture into a
// Discord channel. Area `roster` is the gate. Seeing and downloading the picture is open to
// everybody who may read the roster on its server (the same view as the roster page, so a
// reader gets no trial dates); posting needs the right to manage that one roster
// (rosterAccess.canManageRosterLive) - a snapshot changes nothing, so a closed roster may be
// posted too. The post is the picture and one short line, without a ping (postPayload).
const { ok, error: apiError } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const { activeGuildFor } = require("../../http/activeGuild");
const { q } = require("../../http/apiParams");
const { mayUseChannel, OTHER_SERVER } = require("../../http/serverQuery");
const { getConfig } = require("../../../stores/settingsStore");
const rosterStore = require("../../../stores/rosterStore");
const discord = require("../../../services/discord/discord");
const { withImages } = require("../../../services/discord/discordImage");
const { canManageRosterLive } = require("../../../services/roster/rosterAccess");
const { longDate } = require("../../../services/roster/rosterImage");
const { tr } = require("../../../utils/i18n/botText");
const { activeRoster } = require("../../roster/activeRoster");
const { rosterPicture } = require("../../roster/rosterImageView");
const logger = require("../../../logger").child("rosterImage");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const flag = (v) => v === true || v === 1 || ["1", "true"].includes(str(v));

const NOT_FOUND = "Roster nicht gefunden.";
const NO_ID = "Kein Roster angegeben.";

/** A failed post as a code the client translates, with its HTTP status and a German line. */
function postFailure(err) {
    const code = err && err.code;
    if (code === "bot_offline") return [503, "bot_offline", "Der Bot ist nicht verbunden."];
    if (code === "wrong_guild") return [403, "wrong_guild", "Der Kanal liegt auf einem anderen Server."];
    if (code === "channel_not_found" || code === 10003) return [404, "channel_not_found", "Kanal nicht gefunden oder kein Textkanal."];
    if (code === 50001 || code === 50013) return [403, "no_permission", "Der Bot darf in diesem Kanal nicht schreiben."];
    return [502, "post_failed", "Das Bild konnte nicht gepostet werden."];
}

/**
 * GET /api/rosters/image?id=<rosterId>[&reserve=1][&chars=1] — the roster as a PNG:
 * `reserve` adds bench and pause, `chars` the further characters. 400 without id, 404 for
 * an unknown roster or one of another server.
 */
const getRosterImage = withUser({}, async ({ req, res, user, query }) => {
    const id = q.str(query, "id", { max: 64 });
    if (!id) return apiError(res, 400, "bad_request", NO_ID);
    const picture = await rosterPicture({
        guildId: activeGuildFor(req), id, user, config: getConfig(),
        showReserve: flag(query.get("reserve")), showMoreChars: flag(query.get("chars")),
    });
    if (!picture) return apiError(res, 404, "not_found", NOT_FOUND);
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    return res.end(picture.png);
});

/**
 * GET /api/rosters/image/info?id=<rosterId> — what the dialog offers:
 * { canPost, channelId (the channel of the last post), channels (the roster server's text
 * channels the bot may write in; only for somebody who may post) }.
 */
const getRosterImageInfo = withUser({}, async ({ req, res, user, query }) => {
    const id = q.str(query, "id", { max: 64 });
    if (!id) return apiError(res, 400, "bad_request", NO_ID);
    const roster = activeRoster(req, id);
    if (!roster) return apiError(res, 404, "not_found", NOT_FOUND);
    const canPost = await canManageRosterLive(user, roster);
    return ok(res, {
        canPost,
        channelId: canPost ? roster.imageChannelId || null : null,
        channels: canPost ? discord.listTextChannels(roster.guildId) : [],
    });
});

/**
 * POST /api/rosters/image — post the picture into a channel of the roster's server.
 * Body: { id, channelId, reserve?, chars? }. Answer: { url, channelId }; the channel is kept
 * as the roster's next suggestion. 404 roster, 403 not_manager / other_server / wrong_guild /
 * no_permission, 400 no channel, 503 bot offline, 502 anything else Discord refused.
 */
const postRosterImage = withUser({ write: "roster", csrf: true, body: true }, async ({ req, res, user, body }) => {
    const id = str(body && body.id).slice(0, 64);
    const channelId = str(body && body.channelId).slice(0, 32);
    if (!id) return apiError(res, 400, "bad_request", NO_ID);
    const roster = activeRoster(req, id);
    if (!roster) return apiError(res, 404, "not_found", NOT_FOUND);
    if (!(await canManageRosterLive(user, roster))) return apiError(res, 403, "not_manager", "Nur die Orga dieses Rosters darf das Bild posten.");
    if (!/^\d{5,25}$/.test(channelId)) return apiError(res, 400, "no_channel", "Kein Kanal gewählt.");
    if (!mayUseChannel(user, req, channelId)) return apiError(res, 403, "other_server", OTHER_SERVER);

    const picture = await rosterPicture({
        guildId: activeGuildFor(req), id, user, config: getConfig(),
        showReserve: flag(body.reserve), showMoreChars: flag(body.chars),
    });
    if (!picture) return apiError(res, 404, "not_found", NOT_FOUND);
    const content = tr(picture.lang, "Roster {name} as of {date}", { name: picture.roster.name, date: longDate(Date.now(), picture.lang) });
    let posted;
    try {
        posted = await discord.postPayload(channelId, withImages({ content, images: [{ name: "roster.png", svg: picture.svg }] }), { guildId: roster.guildId });
    } catch (err) {
        const [status, code, message] = postFailure(err);
        logger.warn(`Roster picture ${roster.id} -> ${channelId}: ${err && err.message}`);
        return apiError(res, status, code, message);
    }
    rosterStore.setImageChannel(roster.id, channelId);
    return ok(res, { url: posted.url, channelId: posted.channelId });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/rosters/image", handler: getRosterImage, area: "roster" },
    { method: "GET", path: "/api/rosters/image/info", handler: getRosterImageInfo, area: "roster" },
    { method: "POST", path: "/api/rosters/image", handler: postRosterImage, area: "roster" },
];

module.exports = { getRosterImage, getRosterImageInfo, postRosterImage, postFailure, routes };
