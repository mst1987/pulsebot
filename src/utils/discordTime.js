// Dates in the raider-facing Discord texts.
//
// Wherever Discord renders markdown (message content, embed descriptions and
// field values) a date is a Discord timestamp `<t:UNIX:STYLE>`: every reader
// sees it in their own language and time zone. Where it does not (select
// options, modal labels, button labels) and outside Discord (the public event
// page, the calendar feed) it is written in English in server time — the
// realm's Europe/Berlin — and says so.
const { DateTime } = require("luxon");

const SERVER_ZONE = "Europe/Berlin";
// t 19:30 · T 19:30:00 · d 17/09/2026 · D 17 September 2026 · f D + t · F weekday + f · R "in 2 days"
const STYLES = ["t", "T", "d", "D", "f", "F", "R"];

/** Unix seconds from seconds or milliseconds; 0 for anything unreadable. */
function toSeconds(value) {
    const n = Number(value) || 0;
    if (n <= 0) return 0;
    return Math.floor(n < 1e12 ? n : n / 1000);
}

/** `<t:1758130200:F>`, "" without a time. An unknown style falls back to F. */
function discordTimestamp(value, style = "F") {
    const s = toSeconds(value);
    if (!s) return "";
    return `<t:${s}:${STYLES.includes(style) ? style : "F"}>`;
}

/** The moment in server time as a luxon DateTime (English), null without a time. */
function serverDateTime(value) {
    const s = toSeconds(value);
    return s ? DateTime.fromSeconds(s, { zone: SERVER_ZONE }).setLocale("en-US") : null;
}

/** "Wed 17 Sep 19:30" — short, for select options; "" without a time. */
function shortServerTime(value) {
    const dt = serverDateTime(value);
    return dt ? dt.toFormat("ccc d LLL HH:mm") : "";
}

/** "Wed 17 Sep" — the day alone; "" without a time. */
function shortServerDate(value) {
    const dt = serverDateTime(value);
    return dt ? dt.toFormat("ccc d LLL") : "";
}

/** "Wednesday, 17 September 2026 · 19:30 server time" — the long form for pages; "" without a time. */
function longServerTime(value) {
    const dt = serverDateTime(value);
    return dt ? `${dt.toFormat("cccc, d LLLL yyyy · HH:mm")} server time` : "";
}

module.exports = {
    SERVER_ZONE, STYLES, toSeconds, discordTimestamp, serverDateTime, shortServerTime, shortServerDate, longServerTime,
};
