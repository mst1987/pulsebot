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

// Month names as raiders type them, German and English, full or short.
const MONTH_NAMES = [
    ["januar", "january", "jan", "jän", "jaen"], ["februar", "february", "feb"], ["märz", "maerz", "march", "mär", "mrz", "mar"],
    ["april", "apr"], ["mai", "may"], ["juni", "june", "jun"], ["juli", "july", "jul"], ["august", "aug"],
    ["september", "sept", "sep"], ["oktober", "october", "okt", "oct"], ["november", "nov"], ["dezember", "december", "dez", "dec"],
];
// "heute", "morgen" … — days counted from today.
const RELATIVE_DAYS = { heute: 0, today: 0, morgen: 1, tomorrow: 1, "übermorgen": 2, uebermorgen: 2 };

/** 1–12 for a month name ("okt", "October", "Sept."), 0 when it is none. */
function monthOf(word) {
    const w = String(word || "").toLowerCase().replace(/\.$/, "");
    if (w.length < 3) return 0;
    const i = MONTH_NAMES.findIndex((names) => names.includes(w) || names.some((n) => n.length > 3 && n.startsWith(w)));
    return i + 1;
}

/**
 * The parts of a typed date: `{ day, month, year }` (year 0 = none typed), or
 * null. Reads "24.10.", "24.10", "24.10.2026", "24. 10. 26", "24/10", "24-10-2026",
 * "2026-10-24", "24. Okt", "24 October 2026", "Oct 24", "October 24th, 2026".
 * A "10/24" whose second number cannot be a month is read the American way.
 */
function dateParts(value) {
    const s = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
    const iso = s.match(/^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\.?$/);
    if (iso) return { day: Number(iso[3]), month: Number(iso[2]), year: Number(iso[1]) };
    const num = s.match(/^(\d{1,2})\s*[./-]\s*(\d{1,2})(?:\s*[./-]\s*(\d{4}|\d{2})?)?\s*\.?$/);
    if (num) {
        let [day, month] = [Number(num[1]), Number(num[2])];
        if (month > 12 && day <= 12) [day, month] = [month, day];
        return { day, month, year: num[3] ? Number(num[3]) : 0 };
    }
    const dayFirst = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\.? ?([a-zäöü]+)\.?,? ?(\d{4}|\d{2})?$/);
    if (dayFirst && monthOf(dayFirst[2])) return { day: Number(dayFirst[1]), month: monthOf(dayFirst[2]), year: dayFirst[3] ? Number(dayFirst[3]) : 0 };
    const monthFirst = s.match(/^([a-zäöü]+)\.? ?(\d{1,2})(?:st|nd|rd|th)?\.?,? ?(\d{4})?$/);
    if (monthFirst && monthOf(monthFirst[1])) return { day: Number(monthFirst[2]), month: monthOf(monthFirst[1]), year: monthFirst[3] ? Number(monthFirst[3]) : 0 };
    return null;
}

/** A typed date as a Luxon day plus whether a year was typed, or null. */
function typedDay(value, now = Date.now()) {
    const today = DateTime.fromMillis(Number(now), { zone: TIMEZONE }).startOf("day");
    const word = String(value || "").trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(RELATIVE_DAYS, word)) return { dt: today.plus({ days: RELATIVE_DAYS[word] }), hasYear: true };
    const parts = dateParts(value);
    if (!parts) return null;
    let year = parts.year || today.year;
    if (year < 100) year += 2000;
    let dt = DateTime.fromObject({ year, month: parts.month, day: parts.day }, { zone: TIMEZONE });
    if (!dt.isValid) return null;
    if (!parts.year && today.diff(dt, "days").days > 60) {
        dt = dt.plus({ years: 1 });
        if (dt.day !== parts.day) return null; // 29.02. has no next year
    }
    return { dt, hasYear: !!parts.year };
}

// A date as people type it in Discord — "24.09.2026", "24.09.26", "24.09.",
// "24.9", "24/9", "24. Sept", "Sep 24", "2026-09-24", "heute", "morgen" — as
// "yyyy-MM-dd"; "" when it is no calendar day. Without a year the coming such
// day is meant: one more than 60 days back this year (planning January in
// December) is next year's, a closer one stays this year, so a typo'd
// yesterday is caught as past, not moved a year.
function parseGermanDate(value, now = Date.now()) {
    const hit = typedDay(value, now);
    return hit ? hit.dt.toFormat("yyyy-MM-dd") : "";
}

// A period typed into one field — "24.10.-31.10.", "24.10. bis 31.10.",
// "24 Oct to 3 Nov", "28.12 – 3.1" — or a single day: `{ from, to }` as
// "yyyy-MM-dd", null when it is neither. An end without a year that would lie
// before the start is the next year's (28.12. – 3.1.).
function parseDayRange(value, now = Date.now()) {
    const text = String(value || "").trim();
    const single = typedDay(text, now);
    if (single) return { from: single.dt.toFormat("yyyy-MM-dd"), to: single.dt.toFormat("yyyy-MM-dd") };
    const separator = /\s*(?:bis|to|until|till|–|—|-)\s*/gi;
    let match;
    while ((match = separator.exec(text))) {
        const from = typedDay(text.slice(0, match.index), now);
        const to = typedDay(text.slice(match.index + match[0].length), now);
        if (!from || !to) continue;
        let end = to.dt;
        if (end < from.dt && !to.hasYear) end = end.plus({ years: 1 });
        return { from: from.dt.toFormat("yyyy-MM-dd"), to: end.toFormat("yyyy-MM-dd") };
    }
    return null;
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

/**
 * A start SHORT, as the bot writes it everywhere (Oct 2026: the long `:F` form — "Monday, October 5, 2026 9:00 PM" — reads
 * like a sentence nobody reads): `<t:…:d> <t:…:t>` ("05.10.2026 21:00" in the reader's language and zone), with
 * `relative` also " · <t:…:R>" ("in 3 hours"); "" without a time.
 */
function shortWhen(value, { relative = false } = {}) {
    const s = toSeconds(value);
    if (!s) return "";
    return `<t:${s}:d> <t:${s}:t>${relative ? ` · <t:${s}:R>` : ""}`;
}

/** The moment in server time as a luxon DateTime (English), null without a time. */
function serverDateTime(value) {
    const s = toSeconds(value);
    return s ? DateTime.fromSeconds(s, { zone: SERVER_ZONE }).setLocale("en-US") : null;
}

// ---------------------------------------------------------------------------
// How long a raid takes and when it is over (#305) — the one rule, kept apart
// from eventStore.js on purpose: the signup message, the Discord event and the
// setup all need it, and several of them mock the store in their tests. A rule
// that lives in the store would have to be mocked along with it, which is how a
// pure calculation quietly turns into four slightly different ones.
//
// The duration is an OPTIONAL planning field: an event inherits it from its
// raid template, somebody may set it in the dialog — and otherwise it is not
// set (null), and the event has no planned end. Only the two places that
// technically need an end (the Discord event, a calendar entry) fall back to
// DEFAULT_DURATION, through plannedEndOrDefault(); nothing else invents one.
// ---------------------------------------------------------------------------

const MIN_DURATION = 30;
const MAX_DURATION = 600;
const DEFAULT_DURATION = 180;

/** A stored duration as whole minutes within bounds; null when it is not set (missing, empty or out of bounds). */
function durationOf(raw) {
    if (raw === undefined || raw === null || raw === "") return null;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < MIN_DURATION || n > MAX_DURATION) return null;
    return n;
}

/**
 * When the raid is planned to be over, in unix seconds (start + duration).
 * 0 without a start or without a duration: "no planned end".
 */
function eventEndTime(event) {
    const start = Number(event && event.startTime) || 0;
    const minutes = durationOf(event && event.durationMinutes);
    return start && minutes ? start + minutes * 60 : 0;
}

/**
 * The end for the places that MUST have one — a Discord External event needs a
 * scheduledEndTime, a calendar entry a block: the planned end, else start +
 * DEFAULT_DURATION. 0 without a start. Nowhere else: a page shows no end then.
 */
function plannedEndOrDefault(event) {
    const start = Number(event && event.startTime) || 0;
    return start ? eventEndTime(event) || start + DEFAULT_DURATION * 60 : 0;
}

module.exports = {
    // German dates
    formatTimestampToDateString, formatGermanDateTime, toRaidHelperDate, parseGermanDate, parseDayRange, parseClockTime,
    // Discord texts
    SERVER_ZONE, STYLES, toSeconds, discordTimestamp, shortWhen, serverDateTime,
    // raid duration
    MIN_DURATION, MAX_DURATION, DEFAULT_DURATION, durationOf, eventEndTime, plannedEndOrDefault,
};
