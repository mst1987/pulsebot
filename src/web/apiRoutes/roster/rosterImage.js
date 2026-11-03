// The roster as a picture ("Roster als Bild", docs/roster-profile.md): the PNG for the
// dialog's preview and download, what the dialog may offer, and posting the picture into a
// Discord channel. Area `roster` is the gate. Seeing and downloading the picture is open to
// everybody who may read the roster on its server (always the readers' view of the roster page,
// without trial dates - also when the orga makes it); posting needs the right to manage that
// one roster (rosterAccess.canManageRosterLive). The post is the picture and one short line,
// without a ping (postPayload). It is remembered and keeps itself current (rosterImageLive.js):
// a roster has one such picture, so a new post takes the old one's place and deletes it. A
// closed roster may be posted too, but nothing changes it any more: that post is not remembered.
// A picture from before the bot remembered its posts can be attached instead (attachRosterImage).
// The orga may set its own line above the picture; it stays through every update.
const { ok, error: apiError } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const { activeGuildFor } = require("../../http/activeGuild");
const { q } = require("../../http/apiParams");
const { mayUseChannel, OTHER_SERVER } = require("../../http/serverQuery");
const { getConfig } = require("../../../stores/settings/settingsStore");
const rosterStore = require("../../../stores/roster/rosterStore");
const discord = require("../../../services/discord/discord");
const linkCheck = require("../../../services/discord/linkCheck");
const { canManageRosterLive } = require("../../../services/roster/rosterAccess");
const { activeRoster } = require("../../roster/activeRoster");
const { PICTURE_FILE, rosterPicture, pictureLine } = require("../../roster/rosterImageView");
const logger = require("../../../logger").child("rosterImage");

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const flag = (v) => v === true || v === 1 || ["1", "true"].includes(str(v));

const NOT_FOUND = "Roster nicht gefunden.";
const NO_ID = "Kein Roster angegeben.";
const BOT_OFFLINE = "Der Bot ist gerade nicht verbunden.";
const NO_CHANNEL = "Kein Kanal gewählt.";
const NOT_MANAGER = "Nur die Orga dieses Rosters darf das Bild posten.";
const WRONG_GUILD = "Der Kanal liegt auf einem anderen Server.";
const IN_USE = "Diese Nachricht ist schon das Bild eines anderen Rosters.";
const CLOSED = "Das Roster ist geschlossen.";

const SNOWFLAKE = /^\d{5,25}$/;
const MESSAGE_LINK = /^https?:\/\/(?:(?:www|ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{5,25})\/(\d{5,25})\/(\d{5,25})\/?(?:[?#].*)?$/i;
const CHANNEL_AND_MESSAGE = /^(\d{5,25})-(\d{5,25})$/;
const UNKNOWN_MESSAGE = 10008;

/** The server of a roster; one from before rosters knew theirs belongs to the active server. */
const guildOf = (roster, req) => roster.guildId || activeGuildFor(req);

/**
 * What somebody pasted to name a message: Discord's link, Discord's "copy ID" with the shift key
 * (<channel>-<message>) or the bare message id. Null for anything else; fields it does not say stay "".
 */
function parseMessageRef(raw) {
    const value = str(raw).slice(0, 200);
    const link = MESSAGE_LINK.exec(value);
    if (link) return { guildId: link[1], channelId: link[2], messageId: link[3] };
    const pair = CHANNEL_AND_MESSAGE.exec(value);
    if (pair) return { guildId: "", channelId: pair[1], messageId: pair[2] };
    return SNOWFLAKE.test(value) ? { guildId: "", channelId: "", messageId: value } : null;
}

/** Whether another roster keeps this message current: the two would overwrite each other. Closed ones keep theirs. */
const usedByOtherRoster = (rosterId, messageId) => rosterStore.listRosters()
    .some((r) => r.id !== rosterId && r.imagePost && r.imagePost.messageId === messageId);

/** A failed post as a code the client translates, with its HTTP status and a German line. */
function postFailure(err) {
    const code = err && err.code;
    if (code === "bot_offline") return [503, "bot_offline", BOT_OFFLINE];
    if (code === "wrong_guild") return [403, "wrong_guild", WRONG_GUILD];
    if (code === UNKNOWN_MESSAGE) return [404, "message_not_found", "Nachricht nicht gefunden."];
    if (code === "channel_not_found" || code === 10003) return [404, "channel_not_found", "Kanal nicht gefunden oder kein Textkanal."];
    if (code === 50001 || code === 50013) return [403, "no_permission", "Der Bot darf in diesem Kanal nicht schreiben."];
    return [502, "post_failed", "Das Bild konnte nicht gepostet werden."];
}

/** What goes to Discord: the PNG already drawn (the server has one core), under the orga's text or the short line. */
const picturePayload = (picture, text) => ({
    content: text || pictureLine(picture.lang, picture.roster.name),
    files: [{ attachment: picture.png, name: PICTURE_FILE }],
    attachments: [],
});

/**
 * The picture keeping itself current as the `info` answer shows it: without the message id and
 * hash (the roster's own create/update answers to its managers still carry them raw). Only a
 * picture on this server: a roster without a server of its own belongs to whichever is active.
 */
function livePost(roster, guildId) {
    const post = roster.imagePost;
    if (!post || rosterStore.isClosed(roster) || post.guildId !== guildId) return null;
    return {
        channelId: post.channelId,
        url: linkCheck.messageLink(post.guildId, post.channelId, post.messageId),
        reserve: post.reserve,
        chars: post.chars,
        text: post.text,
    };
}

/**
 * GET /api/rosters/image?id=<rosterId>[&reserve=1][&chars=1] — the roster as a PNG:
 * `reserve` adds bench and pause, `chars` the further characters. 400 without id, 404 for
 * an unknown roster or one of another server.
 */
const getRosterImage = withUser({}, async ({ req, res, query }) => {
    const id = q.str(query, "id", { max: 64 });
    if (!id) return apiError(res, 400, "bad_request", NO_ID);
    const picture = await rosterPicture({
        guildId: activeGuildFor(req), id, config: getConfig(),
        showReserve: flag(query.get("reserve")), showMoreChars: flag(query.get("chars")),
    });
    if (!picture) return apiError(res, 404, "not_found", NOT_FOUND);
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    return res.end(picture.png);
});

/**
 * GET /api/rosters/image/info?id=<rosterId> — what the dialog offers:
 * { canPost, channelId (the channel of the last post), channels (the roster server's text
 * channels the bot may write in), live (the picture keeping itself current: { channelId, url,
 * reserve, chars, text }, url "" while the bot cannot tell; null when there is none on this server or
 * the roster is closed) }; all but canPost only for somebody who may post.
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
        channels: canPost ? discord.listTextChannels(guildOf(roster, req)) : [],
        live: canPost ? livePost(roster, guildOf(roster, req)) : null,
    });
});

/**
 * POST /api/rosters/image — post the picture into a channel of the roster's server.
 * Body: { id, channelId, reserve?, chars?, text? }. Answer: { url, channelId }; the channel is kept
 * as the roster's next suggestion and the post remembered, then the roster's previous picture
 * is deleted if it is on the same server - in this order, so a failed post costs nothing. `text`
 * replaces the short line, also at every update; a closed roster's post uses it once. A
 * roster deleted during the post takes the new message with it. 404 roster, 403 not_manager /
 * other_server / wrong_guild / no_permission, 400 no channel, 503 bot offline, 502 anything else
 * Discord refused.
 */
const postRosterImage = withUser({ write: "roster", csrf: true, body: true }, async ({ req, res, user, body }) => {
    const id = str(body && body.id).slice(0, 64);
    const channelId = str(body && body.channelId).slice(0, 32);
    if (!id) return apiError(res, 400, "bad_request", NO_ID);
    const roster = activeRoster(req, id);
    if (!roster) return apiError(res, 404, "not_found", NOT_FOUND);
    if (!(await canManageRosterLive(user, roster))) return apiError(res, 403, "not_manager", NOT_MANAGER);
    if (!SNOWFLAKE.test(channelId)) return apiError(res, 400, "no_channel", NO_CHANNEL);
    // offline the bot knows no channel, so the server check below would wrongly say "other server"
    if (!discord.isOnline()) return apiError(res, 503, "bot_offline", BOT_OFFLINE);
    if (!mayUseChannel(user, req, channelId)) return apiError(res, 403, "other_server", OTHER_SERVER);

    const reserve = flag(body.reserve);
    const chars = flag(body.chars);
    const text = rosterStore.imagePostText(body.text);
    const picture = await rosterPicture({
        guildId: activeGuildFor(req), id, config: getConfig(),
        showReserve: reserve, showMoreChars: chars, text,
    });
    if (!picture) return apiError(res, 404, "not_found", NOT_FOUND);
    let posted;
    try {
        posted = await discord.postPayload(channelId, picturePayload(picture, text), { guildId: guildOf(roster, req) });
    } catch (err) {
        const [status, code, message] = postFailure(err);
        logger.warn(`Roster picture ${roster.id} -> ${channelId}: ${err && err.message}`);
        return apiError(res, status, code, message);
    }
    const current = rosterStore.getRoster(roster.id);
    if (!current) {
        // deleted while posting: nothing would ever update or find this message again
        await discord.deleteMessage(posted.channelId, posted.messageId);
        return apiError(res, 404, "not_found", NOT_FOUND);
    }
    rosterStore.setImageChannel(roster.id, channelId);
    if (!rosterStore.isClosed(current)) {
        const previous = current.imagePost;
        const guildId = posted.guildId || guildOf(roster, req);
        rosterStore.setImagePost(roster.id, {
            guildId,
            channelId: posted.channelId,
            messageId: posted.messageId,
            reserve,
            chars,
            hash: picture.hash,
            text,
        });
        // never throws; left standing it would only be an image nothing updates any more. A
        // roster without a server of its own may have its old picture on another one: not ours to delete
        if (previous && previous.guildId === guildId) await discord.deleteMessage(previous.channelId, previous.messageId);
    }
    return ok(res, { url: posted.url, channelId: posted.channelId });
});

/**
 * POST /api/rosters/image/attach — make a picture already in Discord the roster's running one
 * (posted before the bot remembered its posts, or on a closed roster). Body: { id, channelId,
 * message, reserve?, chars?, text? }; `message` as parseMessageRef reads it, `channelId` counts when
 * it names no channel. Answer: { url, channelId }. Only a message of the bot with the picture's file
 * name: a manager must not be able to overwrite the event post, the setup or a panel with this. The
 * picture is replaced at once, so a refusal shows here and not a minute later; then it is remembered
 * and a previous picture of this roster on the same server deleted. The same message again takes new
 * switches and a new text. The message is never deleted here: it is not from this request.
 * 400 bad_message / no_channel / not_roster_picture, 403 not_manager / other_server / wrong_guild /
 * no_permission / not_own_message, 404 roster / message_not_found / channel_not_found,
 * 409 roster_closed / in_use, 503 bot offline, 502 anything else Discord refused.
 */
const attachRosterImage = withUser({ write: "roster", csrf: true, body: true }, async ({ req, res, user, body }) => {
    const id = str(body && body.id).slice(0, 64);
    if (!id) return apiError(res, 400, "bad_request", NO_ID);
    const roster = activeRoster(req, id);
    if (!roster) return apiError(res, 404, "not_found", NOT_FOUND);
    if (!(await canManageRosterLive(user, roster))) return apiError(res, 403, "not_manager", NOT_MANAGER);
    // nothing would keep it current
    if (rosterStore.isClosed(roster)) return apiError(res, 409, "roster_closed", CLOSED);
    const ref = parseMessageRef(body.message);
    if (!ref) return apiError(res, 400, "bad_message", "Das ist keine Nachrichten-ID und kein Nachrichtenlink.");
    const channelId = ref.channelId || str(body.channelId).slice(0, 32);
    if (!SNOWFLAKE.test(channelId)) return apiError(res, 400, "no_channel", NO_CHANNEL);
    // offline the bot knows no channel, so the server check below would wrongly say "other server"
    if (!discord.isOnline()) return apiError(res, 503, "bot_offline", BOT_OFFLINE);
    const guildId = guildOf(roster, req);
    if (ref.guildId && ref.guildId !== guildId) return apiError(res, 403, "wrong_guild", WRONG_GUILD);
    if (!mayUseChannel(user, req, channelId)) return apiError(res, 403, "other_server", OTHER_SERVER);

    const refuse = (err) => {
        const [status, code, message] = postFailure(err);
        logger.warn(`Roster picture ${roster.id}, attaching ${channelId}/${ref.messageId}: ${err && err.message}`);
        return apiError(res, status, code, message);
    };
    let message;
    try {
        message = await discord.readMessage(channelId, ref.messageId, { guildId });
    } catch (err) {
        return refuse(err);
    }
    if (!message.own) return apiError(res, 403, "not_own_message", "Diese Nachricht stammt nicht vom Bot.");
    if (!message.attachments.includes(PICTURE_FILE)) return apiError(res, 400, "not_roster_picture", "Diese Nachricht ist kein Roster-Bild.");
    if (usedByOtherRoster(roster.id, message.messageId)) return apiError(res, 409, "in_use", IN_USE);

    const reserve = flag(body.reserve);
    const chars = flag(body.chars);
    const text = rosterStore.imagePostText(body.text);
    const picture = await rosterPicture({
        guildId: activeGuildFor(req), id, config: getConfig(),
        showReserve: reserve, showMoreChars: chars, text,
    });
    if (!picture) return apiError(res, 404, "not_found", NOT_FOUND);
    let edited;
    try {
        edited = await discord.editPayload(message.channelId, message.messageId, picturePayload(picture, text));
    } catch (err) {
        return refuse(err);
    }

    // everything may have changed during the edit; the picture stays replaced, but nothing keeps it
    const current = rosterStore.getRoster(roster.id);
    if (!current) return apiError(res, 404, "not_found", NOT_FOUND);
    if (rosterStore.isClosed(current)) return apiError(res, 409, "roster_closed", CLOSED);
    if (usedByOtherRoster(roster.id, message.messageId)) return apiError(res, 409, "in_use", IN_USE);
    const previous = current.imagePost;
    rosterStore.setImageChannel(roster.id, message.channelId);
    rosterStore.setImagePost(roster.id, {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.messageId,
        reserve,
        chars,
        hash: picture.hash,
        text,
    });
    if (previous && previous.guildId === message.guildId && previous.messageId !== message.messageId) {
        await discord.deleteMessage(previous.channelId, previous.messageId);
    }
    return ok(res, { url: edited.url, channelId: message.channelId });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/rosters/image", handler: getRosterImage, area: "roster" },
    { method: "GET", path: "/api/rosters/image/info", handler: getRosterImageInfo, area: "roster" },
    { method: "POST", path: "/api/rosters/image", handler: postRosterImage, area: "roster" },
    { method: "POST", path: "/api/rosters/image/attach", handler: attachRosterImage, area: "roster" },
];

module.exports = { getRosterImage, getRosterImageInfo, postRosterImage, attachRosterImage, parseMessageRef, postFailure, routes };
