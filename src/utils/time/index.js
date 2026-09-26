// Every date and time rule of the bot in one place (#427): the German date
// formats and parsers of the orga side, the dates in the raider-facing
// Discord texts, and how long a raid takes. The zone itself is
// config/timezone.js.
const { DateTime } = require("luxon");
const { TIMEZONE } = require("../../config/timezone");

// ---------------------------------------------------------------------------
// German dates: formatting for orga texts, parsing what people type.
// ---------------------------------------------------------------------------

/** "24.07.2024 - 20:30" in server time. */
function formatTimestampToDateString(timestamp) {
    const dt = DateTime.fromMillis(timestamp, { zone: TIMEZONE });
    return dt.toFormat("dd.MM.yyyy") + " - " + dt.toFormat("HH:mm");
}

// A moment the way toLocaleString("de-DE") prints it — "7.9.2026, 20:15:03" —
// but always in the server's zone (TIMEZONE), never the machine's. Takes a
// timestamp, an ISO string or a Date; "" when it is no moment.
function formatGermanDateTime(value) {
    const dt = DateTime.fromJSDate(new Date(value), { zone: TIMEZONE });
    return dt.isValid ? dt.toFormat("d.M.yyyy, HH:mm:ss") : "";
}

// Normalize a date into the "dd-MM-yyyy" format the Raid-Helper create API
// expects. Accepts an ISO date from an <input type="date"> ("yyyy-MM-dd") and
// passes through an already-"dd-MM-yyyy" value unchanged. Returns "" for empty
// or unrecognised input so callers can validate/report cleanly.
function toRaidHelperDate(value) {
    const str = String(value || "").trim();
    if (!str) return "";
    const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
    // already dd-MM-yyyy (what the API wants) — accept as-is
    if (/^\d{2}-\d{2}-\d{4}$/.test(str)) return str;
    return "";
}

// A date as people type it in Discord — "24.09.2026", "24.09.26", "24.09.",
// "24.9." or "2026-09-24" — as "yyyy-MM-dd"; "" when it is no calendar day.
// Without a year the coming such day is meant: one more than 60 days back
// this year (planning January in December) is next year's, a closer one
// stays this year, so a typo'd yesterday is caught as past, not moved a year.
function parseGermanDate(value, now = Date.now()) {
    const str = String(value || "").trim();
    const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const de = str.match(/^(\d{1,2})\.(\d{1,2})\.(?:(\d{2}|\d{4}))?$/);
    if (!iso && !de) return "";
    const [day, month] = iso ? [Number(iso[3]), Number(iso[2])] : [Number(de[1]), Number(de[2])];
    const today = DateTime.fromMillis(Number(now), { zone: TIMEZONE }).startOf("day");
    let year = iso ? Number(iso[1]) : (de[3] ? Number(de[3]) : today.year);
    if (year < 100) year += 2000;
    let dt = DateTime.fromObject({ year, month, day }, { zone: TIMEZONE });
    if (!dt.isValid) return "";
    if (!iso && !de[3] && today.diff(dt, "days").days > 60) {
        dt = dt.plus({ years: 1 });
        if (dt.day !== day) return ""; // 29.02. has no next year
    }
    return dt.toFormat("yyyy-MM-dd");
}

// A time of day as typed — "19:30", "19.30", "1930", "930" or "19" — as
// "HH:mm"; "" when it is none.
function parseClockTime(value) {
    const str = String(value || "").trim().replace(/\s*uhr$/i, "");
    const match = str.match(/^(\d{1,2})(?:[:.]?(\d{2}))?$/);
    if (!match) return "";
    const hours = Number(match[1]);
    const minutes = match[2] === undefined ? 0 : Number(match[2]);
    if (hours > 23 || minutes > 59) return "";
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Dates in the raider-facing Discord texts.
//
// Wherever Discord renders markdown (message content, embed descriptions and
// field values) a date is a Discord timestamp `<t:UNIX:STYLE>`: every reader
// sees it in their own language and time zone. Where it does not (select
// options, modal labels, button labels) and outside Discord (the public event
// page, the calendar feed) it is written in English in server time — the
// realm's Europe/Berlin — and says so.
// ---------------------------------------------------------------------------

const SERVER_ZONE = TIMEZONE;
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

// ---------------------------------------------------------------------------
// How long a raid takes and when it is over (#305) — the one rule, kept apart
// from eventStore.js on purpose: the signup message, the Discord event and the
// setup all need it, and several of them mock the store in their tests. A rule
// that lives in the store would have to be mocked along with it, which is how a
// pure calculation quietly turns into four slightly different ones.
//
// The duration is a planning field: an event inherits it from its raid
// template, and without one it is DEFAULT_DURATION.
// ---------------------------------------------------------------------------

const MIN_DURATION = 30;
const MAX_DURATION = 600;
const DEFAULT_DURATION = 180;

/** A stored duration as minutes within bounds; anything missing or odd is the default. */
function clampDuration(raw) {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < MIN_DURATION || n > MAX_DURATION) return DEFAULT_DURATION;
    return n;
}

/** When the raid is planned to be over, in unix seconds (start + duration). 0 without a start. */
function eventEndTime(event) {
    const start = Number(event && event.startTime) || 0;
    return start ? start + clampDuration(event && event.durationMinutes) * 60 : 0;
}

module.exports = {
    // German dates
    formatTimestampToDateString, formatGermanDateTime, toRaidHelperDate, parseGermanDate, parseClockTime,
    // Discord texts
    SERVER_ZONE, STYLES, toSeconds, discordTimestamp, serverDateTime, shortServerTime, shortServerDate, longServerTime,
    // raid duration
    MIN_DURATION, MAX_DURATION, DEFAULT_DURATION, clampDuration, eventEndTime,
};
