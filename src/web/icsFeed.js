// The calendar file of an own event (#308): `GET /r/cal/<eventId>.ics`, public
// like the report pages, so a raider can put the raid into their calendar with
// one click from the signup message.
//
// ⚠️ The route is reachable **without a login**, so nothing personal goes in:
// title, description, time, the raid's channel link and the public event page —
// the same things the event channel shows anyway. No signups, no names, no
// Discord user ids. `buildIcs()` is pure and is what the test reads.
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
 * The event as an iCalendar file — pure, CRLF line endings, one VEVENT.
 * "" for an event without an id or without a start time.
 * @param {object} event an eventStore event
 * @param {{ now?: number }} [opts] `now` stands in when the event carries no change time
 */
function buildIcs(event, { now = Date.now() } = {}) {
    const id = String((event && event.id) || "");
    const start = Number(event && event.startTime) || 0;
    if (!id || !start) return "";
    const cancelled = event.status === "cancelled";
    const changedAt = Number(event.updatedAt) || Number(event.createdAt) || now;
    const url = publicEventUrl(id);
    const where = channelUrl(event);

    const description = [];
    const text = clip(event.description, MAX_DESCRIPTION);
    if (cancelled) {
        const reason = (event.cancel && event.cancel.reason) || "";
        description.push(`Abgesagt${reason ? `: ${clip(reason, 200)}` : "."}`);
    }
    if (text) description.push(text);
    if (url) description.push(url);

    const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        `PRODID:${PRODID}`,
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        `UID:${escapeText(id)}@eventhelper`,
        `DTSTAMP:${icsTime(Math.floor(changedAt / 1000))}`,
        `SEQUENCE:${Math.max(0, Math.floor((changedAt - SEQUENCE_EPOCH) / 1000))}`,
        `DTSTART:${icsTime(start)}`,
        `DTEND:${icsTime(eventEndTime(event) || start)}`,
        `SUMMARY:${escapeText(`${cancelled ? "Abgesagt: " : ""}${event.title || "Raid"}`)}`,
        ...(description.length ? [`DESCRIPTION:${escapeText(description.join("\n"))}`] : []),
        ...(where ? [`LOCATION:${escapeText(where)}`] : []),
        ...(url ? [`URL:${escapeText(url)}`] : []),
        `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
        "TRANSP:OPAQUE",
        "END:VEVENT",
        "END:VCALENDAR",
    ];
    return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/** The file name a calendar client sees, e.g. "raid-eh-abc.ics". */
function icsFileName(eventId) {
    return `raid-${String(eventId || "event").replace(/[^a-zA-Z0-9_-]/g, "")}.ics`;
}

module.exports = { buildIcs, foldLine, escapeText, icsTime, icsUrlFor, publicEventUrl, icsFileName };
