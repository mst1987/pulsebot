// Channel names for the Kanäle page (issue #259): Discord's naming rules and the
// naming schema new event channels are created by ("{tag}-{dd}-{mm}-{raid}").
//
// Pure on purpose — the inline rename, the bulk "Umbenennen nach Schema" and the
// quick-create series all go through here, so the rules are tested once. The
// client keeps a twin of normalizeChannelName() in
// src/web-client/src/lib/channelNames.ts (the regex and the limit are held
// identical by test/utils/channelNames.test.js), so what the admin sees while
// typing is what Discord will store.

/** Discord's limit for a channel name. */
const CHANNEL_NAME_MAX = 100;

/**
 * What Discord removes from a text channel name: ASCII punctuation except "-"
 * and "_", and control characters. Emojis and every other Unicode symbol — "・",
 * "│", "┃", "【】", "⚔" — stay, because Discord keeps them: a channel like
 * "🔥・mi-17-09-ssc-tk" must not lose its design when it is renamed here.
 */
const NAME_STRIP_RE = /[!-,./:-@[-^`{-~\p{Cc}]+/gu;

/** The schema a category starts with until someone stores its own. */
const DEFAULT_SCHEMA = "{tag}-{dd}-{mm}-{raid}";

/** German weekday abbreviations, index = Date#getUTCDay(). */
const WEEKDAYS = ["so", "mo", "di", "mi", "do", "fr", "sa"];

/** The placeholders a schema understands, for the dialog's help text. */
const PLACEHOLDERS = [
    { key: "tag", hint: "Wochentag, kurz (mi)" },
    { key: "dd", hint: "Tag, zweistellig (24)" },
    { key: "mm", hint: "Monat, zweistellig (09)" },
    { key: "yy", hint: "Jahr, zweistellig (26)" },
    { key: "yyyy", hint: "Jahr (2026)" },
    { key: "raid", hint: "Raid-Kürzel (ssc-tk)" },
    { key: "name", hint: "bisheriger Name" },
    { key: "nr", hint: "laufende Nummer (1, 2, …)" },
];

/**
 * A name as Discord stores it for a text channel: lower case, "-" instead of
 * whitespace, no punctuation, no doubled dashes, at most 100 characters.
 *
 * `final: false` is the typing mode of the inline editor — it keeps a trailing
 * dash, because "mi-" is on its way to "mi-24", not a finished name.
 */
function normalizeChannelName(value, { final = true } = {}) {
    let name = String(value || "")
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(NAME_STRIP_RE, "")
        .replace(/-{2,}/g, "-")
        .replace(/^-+/, "");
    if (final) name = name.replace(/-+$/, "");
    return name.slice(0, CHANNEL_NAME_MAX);
}

/** Voice and stage channels keep case and spaces; only the length is Discord's. */
function normalizeForType(value, type) {
    const TEXT_LIKE = [0, 5, 15];
    if (TEXT_LIKE.includes(Number(type))) return normalizeChannelName(value);
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, CHANNEL_NAME_MAX);
}

/** "2026-09-24" → a UTC date, or null for anything that is not a real calendar day. */
function parseDay(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
    if (!match) return null;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date;
}

/** A UTC date as "2026-09-24". */
function formatDay(date) {
    return date.toISOString().slice(0, 10);
}

const pad = (n) => String(n).padStart(2, "0");

/**
 * Fill a schema and apply Discord's rules. Date placeholders stay empty without
 * a date, `{tag}` can be overridden (a raid night that is not named after its
 * weekday). Unknown placeholders are dropped rather than left as "{foo}".
 */
function renderChannelName(schema, { date, raid = "", tag = "", name = "", nr = "" } = {}) {
    const day = date ? parseDay(date) : null;
    const values = {
        tag: tag || (day ? WEEKDAYS[day.getUTCDay()] : ""),
        dd: day ? pad(day.getUTCDate()) : "",
        mm: day ? pad(day.getUTCMonth() + 1) : "",
        yy: day ? String(day.getUTCFullYear()).slice(-2) : "",
        yyyy: day ? String(day.getUTCFullYear()) : "",
        raid: String(raid || ""),
        name: String(name || ""),
        nr: nr === "" || nr === null || nr === undefined ? "" : String(nr),
    };
    const filled = String(schema || DEFAULT_SCHEMA).replace(/\{(\w+)\}/g, (_, key) => values[key.toLowerCase()] ?? "");
    return normalizeChannelName(filled);
}

/**
 * The days of a series: one day ("once"), or `count` days a week apart
 * ("weekly"). Capped at 12 — a quarter of raid nights is a plan, more is a typo.
 */
const MAX_SERIES = 12;
function seriesDays(from, count = 1, interval = "once") {
    const start = parseDay(from);
    if (!start) return [];
    const n = interval === "weekly" ? Math.max(1, Math.min(MAX_SERIES, Math.floor(Number(count) || 1))) : 1;
    const days = [];
    for (let i = 0; i < n; i++) days.push(formatDay(new Date(start.getTime() + i * 7 * 86400000)));
    return days;
}

/**
 * What quick-create would make: one row per day with the rendered name and
 * whether it `exists` already (on the server, or earlier in the same plan).
 * Existing names are skipped when the plan is carried out, never duplicated.
 */
function planChannels({ schema, raid = "", tag = "", from, count = 1, interval = "once", existingNames = [], render = null } = {}) {
    const taken = new Set((existingNames || []).map((n) => String(n || "").toLowerCase()));
    return seriesDays(from, count, interval).map((day, i) => {
        // `render(day, nr)` names a day another way — like the previous event channel (#285).
        const name = render ? render(day, i + 1) : renderChannelName(schema, { date: day, raid, tag, nr: i + 1 });
        const exists = !name || taken.has(name);
        if (name) taken.add(name);
        return { date: day, name, exists };
    });
}

// ---- a new event channel named like the previous one (#285) ----
//
// The previous event channel of a category is the best schema there is: it
// carries the guild's emojis, separators, prefix and order. So its name is
// taken apart into what belongs to *that* event — its date, its weekday, its
// raid — and the rest, which stays literally. Only parts that match the old
// event's own values are touched, so an arbitrary number in a name ("t6",
// "25er") is never mistaken for a date.

/** Weekday spellings, index = Date#getUTCDay(): German short/long, English short/long. */
const WEEKDAY_FORMS = {
    tag: WEEKDAYS,
    wochentag: ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"],
    wday: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
    weekday: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
};

/** The date spellings recognised, as small schemas; "." never survives Discord, so "17.09" is "1709". */
const DATE_FORMATS = (() => {
    const out = [];
    for (const sep of ["-", "_", ""]) {
        out.push(`{yyyy}${sep}{mm}${sep}{dd}`, `{dd}${sep}{mm}${sep}{yyyy}`, `{dd}${sep}{mm}${sep}{yy}`, `{dd}${sep}{mm}`);
    }
    for (const sep of ["-", "_"]) out.push(`{d}${sep}{m}${sep}{yyyy}`, `{d}${sep}{m}`);
    return out;
})();

const RAID_JOINERS = ["-", "_", ""];

/** Labels of the replaced parts, for the "abgeleitet aus" line. */
const PART_LABELS = { date: "Datum", weekday: "Wochentag", raid: "Raid" };

/** Fill a date format ("{dd}-{mm}") for a UTC day, without Discord's rules. */
function fillDate(format, day) {
    const values = {
        dd: pad(day.getUTCDate()), mm: pad(day.getUTCMonth() + 1), d: String(day.getUTCDate()), m: String(day.getUTCMonth() + 1),
        yy: String(day.getUTCFullYear()).slice(-2), yyyy: String(day.getUTCFullYear()),
    };
    for (const [key, names] of Object.entries(WEEKDAY_FORMS)) values[key] = names[day.getUTCDay()];
    return String(format).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
}

const notDigit = (ch) => !ch || !/\d/.test(ch);
const notLetter = (ch) => !ch || !/\p{L}/u.test(ch);
const notWordChar = (ch) => notDigit(ch) && notLetter(ch);

/** A raid given as "ssc-tk" or ["ssc", "tk"], spelled with a joiner. */
function joinRaid(raid, joiner) {
    if (Array.isArray(raid)) return raid.filter(Boolean).join(joiner);
    return String(raid || "").replace(/-/g, joiner);
}

/**
 * Take a channel name apart for the event it belongs to.
 *
 * `date` is that event's day ("2026-09-17"), `raidTags` the raid spellings it
 * may carry, each as its parts (`[["ssc", "tk"], ["t5"]]`). Returns
 * `{ segments, recognized }`: literal `{ text }` segments and replaceable
 * `{ part, from, format | joiner }` ones; `recognized` only when a date was
 * found — a weekday alone would make next week's name the same as this one's.
 */
function derivePatternFromName(name, { date, raidTags = [] } = {}) {
    const text = normalizeChannelName(name);
    const day = parseDay(date);
    const found = [];
    const overlaps = (start, end) => found.some((f) => start < f.end && end > f.start);
    const scan = (literal, boundary, entry) => {
        if (!literal) return;
        let at = text.indexOf(literal);
        while (at !== -1) {
            const end = at + literal.length;
            if (!overlaps(at, end) && boundary(text[at - 1]) && boundary(text[end])) found.push({ start: at, end, from: literal, ...entry });
            at = text.indexOf(literal, at + 1);
        }
    };
    const longestFirst = (list) => list.sort((a, b) => b.literal.length - a.literal.length);

    if (day) {
        const seen = new Set();
        const dates = DATE_FORMATS.map((format) => ({ format, literal: fillDate(format, day) }))
            .filter((d) => !seen.has(d.literal) && seen.add(d.literal));
        for (const d of longestFirst(dates)) scan(d.literal, notDigit, { part: "date", format: d.format });
        const weekdays = Object.keys(WEEKDAY_FORMS).map((key) => ({ format: `{${key}}`, literal: fillDate(`{${key}}`, day) }));
        for (const w of longestFirst(weekdays)) scan(w.literal, notLetter, { part: "weekday", format: w.format });
    }
    const raids = [];
    for (const tag of raidTags || []) {
        const parts = (Array.isArray(tag) ? tag : [tag]).map((p) => normalizeChannelName(p)).filter(Boolean);
        if (!parts.length) continue;
        for (const joiner of parts.length > 1 ? RAID_JOINERS : ["-"]) raids.push({ joiner, literal: parts.join(joiner) });
    }
    for (const r of longestFirst(raids)) scan(r.literal, notWordChar, { part: "raid", joiner: r.joiner });

    found.sort((a, b) => a.start - b.start);
    const segments = [];
    let cursor = 0;
    for (const f of found) {
        if (f.start > cursor) segments.push({ text: text.slice(cursor, f.start) });
        const segment = { part: f.part, from: f.from };
        if (f.format) segment.format = f.format;
        if (f.joiner !== undefined) segment.joiner = f.joiner;
        segments.push(segment);
        cursor = f.end;
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor) });
    return { segments, recognized: found.some((f) => f.part === "date") };
}

/**
 * A derived pattern filled for a new day and raid: `{ name, replaced }` with
 * `replaced = [{ part, from, to }]`. Without a day the date parts keep their
 * old value; without a raid the old raid stays — nothing is guessed empty.
 */
function applyPattern(pattern, { date, raid } = {}) {
    const day = date ? parseDay(date) : null;
    const hasRaid = Array.isArray(raid) ? raid.some(Boolean) : !!String(raid || "").trim();
    let out = "";
    const replaced = [];
    for (const seg of (pattern && pattern.segments) || []) {
        if (seg.text !== undefined) {
            out += seg.text;
            continue;
        }
        let to = seg.from;
        if (seg.part === "raid") to = hasRaid ? normalizeChannelName(joinRaid(raid, seg.joiner)) || seg.from : seg.from;
        else if (day) to = fillDate(seg.format, day);
        out += to;
        if (!replaced.some((r) => r.part === seg.part && r.from === seg.from)) replaced.push({ part: seg.part, from: seg.from, to });
    }
    return { name: normalizeChannelName(out), replaced };
}

/** The parts a pattern would replace, in reading order ("Wochentag", "Datum", "Raid"). */
function patternParts(pattern) {
    const parts = [];
    for (const seg of (pattern && pattern.segments) || []) {
        if (seg.part && !parts.includes(seg.part)) parts.push(seg.part);
    }
    return parts;
}

/** "🔥・" of "🔥・mi-17-09": the leading symbols of a name, only when they carry more than ASCII. */
function prefixOf(name) {
    const lead = (/^[^\p{L}\p{N}]+/u.exec(normalizeChannelName(name)) || [""])[0];
    return /[^\x20-\x7e]/.test(lead) ? lead : "";
}

/** "Datum 17-09 → 24-09, Raid ssc-tk → hyjal-bt" — only what actually changes. */
function describeReplaced(replaced = []) {
    return (replaced || [])
        .filter((r) => r.from !== r.to)
        .map((r) => `${PART_LABELS[r.part] || r.part} ${r.from} → ${r.to}`)
        .join(", ");
}

/** "Datum und Raid", "Wochentag, Datum und Raid". */
function listParts(parts = []) {
    const labels = parts.map((p) => PART_LABELS[p] || p);
    return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} und ${labels[labels.length - 1]}` : labels.join("");
}

/**
 * Where a new channel for `day` belongs among a category's event channels
 * (`[{ day, channelId }]`): right after the latest one on or before that day,
 * else right before the earliest later one. {} when there is none.
 */
function placementFor(eventChannels = [], day = "") {
    if (!parseDay(day)) return {};
    const rows = (eventChannels || []).filter((r) => r && r.channelId && parseDay(r.day));
    const earlier = rows.filter((r) => r.day <= day).sort((a, b) => (a.day < b.day ? 1 : -1))[0];
    if (earlier) return { afterChannelId: earlier.channelId };
    const later = rows.filter((r) => r.day > day).sort((a, b) => (a.day < b.day ? -1 : 1))[0];
    return later ? { beforeChannelId: later.channelId } : {};
}

module.exports = {
    CHANNEL_NAME_MAX, NAME_STRIP_RE, DEFAULT_SCHEMA, WEEKDAYS, WEEKDAY_FORMS, DATE_FORMATS, PART_LABELS, PLACEHOLDERS, MAX_SERIES,
    normalizeChannelName, normalizeForType, parseDay, formatDay, renderChannelName, seriesDays, planChannels,
    derivePatternFromName, applyPattern, patternParts, prefixOf, describeReplaced, listParts, placementFor,
};
