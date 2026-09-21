// Two calendar files, one set of rules:
//
//   · `GET /r/cal/<eventId>.ics` (#308) — one raid, public like the report
//     pages, the link under every signup message.
//   · `GET /r/cal/user/<token>.ics` (#312) — one raider's **subscription**: all
//     the raids they signed up for, so the link goes into Outlook/Google/Apple
//     once and every new raid turns up by itself.
//
// ⚠️ Both are reachable **without a login**, so nothing about anybody else goes
// in: title, description, time, the raid's channel link and the public event
// page — the things the event channel shows anyway — plus, in the raider's own
// feed, that raider's own status and nothing more. Never another raider's name,
// never a comment, never a setup, never a Discord user id. `buildIcs()` and
// `buildUserCalendar()` are pure and are what the tests read against an
// allowlist of property names (test/web/icsFeed.test.js).
//
// RFC 5545 in the three places it bites: every line is folded at 75 octets
// (continuation lines start with a space), text is escaped (`\` `;` `,` and
// newlines), and every time is UTC — a local time would need a VTIMEZONE block,
// and the store keeps unix seconds anyway.
//
// The end comes from the duration (#305, utils/eventTime.js); an event without
// a start has no VEVENT worth writing and answers "".
const { publicBaseUrl } = require("../config/variables");
const { eventEndTime } = require("../utils/eventTime");

const PRODID = "-//EventHelper//Raid-Kalender//DE";
// The raider's own status, in the words the bot uses in Discord (English, like
// every raider-facing text; the calendar client renders the times itself).
const STATUS_LABELS = {
    signed: "Signed up", tentative: "Tentative", late: "Late", bench: "Bench", absence: "Absence",
};
// A description longer than this is clipped — a calendar entry is a reminder,
// not the event page; the URL below it leads to the whole text.
const MAX_DESCRIPTION = 400;
// SEQUENCE must be an integer that only ever grows. Seconds since 2020 stay far
// inside the 32-bit range a calendar client may assume, where unix seconds
// would not (they pass 2^31 in 2038).
const SEQUENCE_EPOCH = Date.UTC(2020, 0, 1);

const baseUrl = () => String(publicBaseUrl || "").replace(/\/+$/, "");

/** The public calendar url of an event, "" without a configured base url. */
function icsUrlFor(eventId) {
    const base = baseUrl();
    return base && eventId ? `${base}/r/cal/${encodeURIComponent(eventId)}.ics` : "";
}

/** The public event page of an event, "" without a configured base url. */
function publicEventUrl(eventId) {
    const base = baseUrl();
    return base && eventId ? `${base}/e/${encodeURIComponent(eventId)}` : "";
}

/** RFC 5545 text escaping: backslash, semicolon, comma and newlines. */
function escapeText(value) {
    return String(value === null || value === undefined ? "" : value)
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\r\n|[\r\n]/g, "\\n");
}

/**
 * One content line folded to at most 75 octets (RFC 5545 §3.1). Counting is in
 * UTF-8 bytes and never splits a character; continuation lines start with one
 * space, which is part of their 75.
 */
function foldLine(line) {
    const parts = [];
    let current = "";
    let bytes = 0;
    for (const ch of String(line === null || line === undefined ? "" : line)) {
        const size = Buffer.byteLength(ch, "utf8");
        const limit = parts.length ? 74 : 75;
        if (bytes + size > limit) {
            parts.push(current);
            current = "";
            bytes = 0;
        }
        current += ch;
        bytes += size;
    }
    parts.push(current);
    return parts.map((part, i) => (i ? ` ${part}` : part)).join("\r\n");
}

/** Unix seconds as an iCalendar UTC stamp, "20260924T173000Z". */
function icsTime(seconds) {
    const d = new Date((Number(seconds) || 0) * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T`
        + `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** The Discord link of the event's channel, "" without both ids. */
function channelUrl(event) {
    const guildId = String((event && event.guildId) || "");
    const channelId = String((event && event.channelId) || "");
    return guildId && channelId ? `https://discord.com/channels/${guildId}/${channelId}` : "";
}

const clip = (text, max) => {
    const s = String(text || "").trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/**
 * One VEVENT for an event, as an array of unfolded content lines. Empty for an
 * event without an id or without a start — a calendar entry without a time is
 * not one.
 *
 * ⚠️ This is the one place a property is added, and every property it can emit
 * is in the allowlist the tests walk. `status` is the *reader's own* signup
 * status and the only personal thing that may be here; nothing about another
 * raider (name, comment, setup, user id) ever enters.
 *
 * @param {object} event an eventStore event
 * @param {{ now?: number, status?: string, changedAt?: number }} [opts]
 *   `status` = the reader's own signup status (raider feed only),
 *   `changedAt` = a later change (ms) than the event's own, e.g. that signup's
 */
function vevent(event, { now = Date.now(), status = "", changedAt = 0 } = {}) {
    const id = String((event && event.id) || "");
    const start = Number(event && event.startTime) || 0;
    if (!id || !start) return [];
    const cancelled = event.status === "cancelled";
    // An own absence is written as CANCELLED rather than dropped: a client that
    // already has the entry strikes it, where a silently missing VEVENT leaves
    // a stale raid standing in the calendar of everyone who imported the file.
    const off = status === "absence";
    const changed = Math.max(
        Number(event.updatedAt) || Number(event.createdAt) || now,
        Number(changedAt) || 0,
    );
    const url = publicEventUrl(id);
    const where = channelUrl(event);

    const description = [];
    const text = clip(event.description, MAX_DESCRIPTION);
    if (cancelled) {
        const reason = (event.cancel && event.cancel.reason) || "";
        description.push(`Cancelled${reason ? `: ${clip(reason, 200)}` : "."}`);
    }
    if (status && STATUS_LABELS[status]) description.push(`Your signup: ${STATUS_LABELS[status]}`);
    if (text) description.push(text);
    if (url) description.push(url);

    const prefix = cancelled ? "Cancelled: " : (off ? "Signed off: " : "");
    return [
        "BEGIN:VEVENT",
        `UID:${escapeText(id)}@eventhelper`,
        `DTSTAMP:${icsTime(Math.floor(changed / 1000))}`,
        `SEQUENCE:${Math.max(0, Math.floor((changed - SEQUENCE_EPOCH) / 1000))}`,
        `DTSTART:${icsTime(start)}`,
        `DTEND:${icsTime(eventEndTime(event) || start)}`,
        `SUMMARY:${escapeText(`${prefix}${event.title || "Raid"}`)}`,
        ...(description.length ? [`DESCRIPTION:${escapeText(description.join("\n"))}`] : []),
        ...(where ? [`LOCATION:${escapeText(where)}`] : []),
        ...(url ? [`URL:${escapeText(url)}`] : []),
        `STATUS:${cancelled || off ? "CANCELLED" : "CONFIRMED"}`,
        // A raid one is only "tentative" at, benched for or signed off from
        // should not block the day in anyone's free/busy view.
        `TRANSP:${cancelled || off || status === "tentative" || status === "bench" ? "TRANSPARENT" : "OPAQUE"}`,
        "END:VEVENT",
    ];
}

/** The VCALENDAR wrapper around already-built VEVENT lines. */
function wrapCalendar(eventLines, { name = "" } = {}) {
    const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        `PRODID:${PRODID}`,
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        // What Outlook/Google/Apple show as the subscribed calendar's name.
        ...(name ? [`X-WR-CALNAME:${escapeText(name)}`, `NAME:${escapeText(name)}`] : []),
        ...eventLines,
        "END:VCALENDAR",
    ];
    return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/**
 * The event as an iCalendar file — pure, CRLF line endings, one VEVENT.
 * "" for an event without an id or without a start time.
 * @param {object} event an eventStore event
 * @param {{ now?: number }} [opts] `now` stands in when the event carries no change time
 */
function buildIcs(event, { now = Date.now() } = {}) {
    const lines = vevent(event, { now });
    return lines.length ? wrapCalendar(lines) : "";
}

/**
 * The raider's subscription calendar (#312) — pure. One VEVENT per raid the
 * raider has a signup for, soonest first.
 *
 * @param {{ event: object, status?: string, changedAt?: number }[]} entries
 * @param {{ name?: string, now?: number }} [opts]
 * @returns {string} always a valid VCALENDAR, empty of events when there are none
 */
function buildUserCalendar(entries, { name = "My raids", now = Date.now() } = {}) {
    const lines = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || !entry.event) continue;
        lines.push(...vevent(entry.event, { now, status: entry.status || "", changedAt: entry.changedAt || 0 }));
    }
    return wrapCalendar(lines, { name });
}

/** The file name a calendar client sees, e.g. "raid-eh-abc.ics". */
function icsFileName(eventId) {
    return `raid-${String(eventId || "event").replace(/[^a-zA-Z0-9_-]/g, "")}.ics`;
}

/** The subscription url of a calendar token, "" without a configured base url. */
function userIcsUrl(token) {
    const base = baseUrl();
    return base && token ? `${base}/r/cal/user/${encodeURIComponent(token)}.ics` : "";
}

module.exports = {
    buildIcs, buildUserCalendar, vevent, wrapCalendar,
    foldLine, escapeText, icsTime, icsUrlFor, publicEventUrl, userIcsUrl, icsFileName,
    STATUS_LABELS,
};
