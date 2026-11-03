// The Discord message of a stream (docs/twitch.md): a card in Twitch's violet while
// live (ping line, own text, title, game, viewers, preview, link button), grey and
// without button or picture once it ended.
//
// Everything Twitch sends is foreign input a streamer controls: it is escaped here and
// stays one line. The card itself never allows a ping (`allowedMentions: { parse: [] }`);
// only the first post names the one role (discord.postPayload `pingRoleId`), every edit
// goes through editPayload with `parse: []`, so the mention line never pings again.
//
// `display` is what Twitch last said ({ name, title, game, viewers, thumbnail }), kept in
// the state store: the "ended" card is drawn when Twitch no longer answers for the stream.
const { ButtonBuilder, ButtonStyle } = require("discord.js");
const { card } = require("../../utils/discord/card");
const { tr } = require("../../utils/i18n/botText");

/** Twitch's own violet: carries a meaning here (design rules allow it for this card). */
const TWITCH_COLOR = 0x9146ff;
/** Discord's grey for a stream that is over. */
const ENDED_COLOR = 0x80848e;
const PREVIEW_WIDTH = 1280;
const PREVIEW_HEIGHT = 720;
/** Twitch renews a preview about every 5 minutes; a new query per window beats Discord's image cache. */
const PREVIEW_WINDOW_MS = 5 * 60 * 1000;

const MINUTE_MS = 60 * 1000;
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

const str = (v) => (v === undefined || v === null ? "" : String(v));

/**
 * Foreign text as plain text in one line: no markdown, no links, no mention, no
 * heading or list at its start. Never used inside a masked link (there a backslash
 * would show), and the card has none.
 */
function escapeText(text) {
    return str(text)
        .replace(/\s+/g, " ")
        .trim()
        .replace(/([\\*_~`|>[\]()<#:-])/g, "\\$1")
        .replace(/@/g, `@${ZERO_WIDTH_SPACE}`);
}

const channelUrl = (login) => `https://www.twitch.tv/${login}`;

/** The preview in a real size, with a query that changes every 5 minutes. */
function previewUrl(thumbnail, now = Date.now()) {
    const url = str(thumbnail).replace("{width}", String(PREVIEW_WIDTH)).replace("{height}", String(PREVIEW_HEIGHT));
    if (!url) return "";
    return `${url}${url.includes("?") ? "&" : "?"}t=${Math.floor(now / PREVIEW_WINDOW_MS)}`;
}

/**
 * The orga's text with {streamer} {title} {game} {url} filled in one pass, so a title
 * holding "{url}" stays as it is. The orga's own markdown stays; the values are escaped.
 */
function fillText(text, { login, display }) {
    const values = {
        streamer: escapeText(display.name || login),
        title: escapeText(display.title),
        game: escapeText(display.game),
        url: channelUrl(login),
    };
    return str(text).replace(/\{(streamer|title|game|url)\}/g, (all, key) => values[key]);
}

const numberOf = (lang, n) => Number(n || 0).toLocaleString(lang === "en" ? "en-US" : "de-DE");

/** The card of a running stream. `entry`: { login, roleId, text }. */
function liveCard({ lang, entry, display, now = Date.now() }) {
    const button = new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(tr(lang, "Watch stream"))
        .setURL(channelUrl(entry.login));
    return card({
        color: TWITCH_COLOR,
        mentions: entry.roleId ? `<@&${entry.roleId}>` : "",
        allowedMentions: { parse: [] },
        kicker: tr(lang, "Live on Twitch"),
        title: escapeText(display.name || entry.login),
        text: [fillText(entry.text, { login: entry.login, display }), escapeText(display.title)].filter(Boolean),
        facts: [
            [tr(lang, "Game"), escapeText(display.game)],
            [tr(lang, "Viewers"), numberOf(lang, display.viewers)],
        ],
        image: previewUrl(display.thumbnail, now),
        buttons: [button],
    });
}

/** "2 h 5 min" / "2 Std. 5 Min.", at least a minute. */
function durationText(lang, ms) {
    const minutes = Math.max(1, Math.round((Number(ms) || 0) / MINUTE_MS));
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours
        ? tr(lang, "{hours} h {minutes} min", { hours, minutes: rest })
        : tr(lang, "{minutes} min", { minutes });
}

/** The card of a stream that is over: no ping line, no button, no picture. */
function endedCard({ lang, login, display, durationMs }) {
    return card({
        color: ENDED_COLOR,
        allowedMentions: { parse: [] },
        kicker: tr(lang, "Stream ended"),
        title: escapeText((display && display.name) || login),
        text: escapeText(display && display.title),
        facts: [
            [tr(lang, "Game"), escapeText(display && display.game)],
            [tr(lang, "Duration"), durationText(lang, durationMs)],
        ],
    });
}

module.exports = { TWITCH_COLOR, ENDED_COLOR, escapeText, previewUrl, fillText, durationText, liveCard, endedCard };
