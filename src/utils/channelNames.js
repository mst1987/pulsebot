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

/** Everything a text channel name may not contain: all but letters, digits, "-" and "_". */
const NAME_STRIP_RE = /[^\p{L}\p{N}_-]+/gu;

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
function planChannels({ schema, raid = "", tag = "", from, count = 1, interval = "once", existingNames = [] } = {}) {
    const taken = new Set((existingNames || []).map((n) => String(n || "").toLowerCase()));
    return seriesDays(from, count, interval).map((day, i) => {
        const name = renderChannelName(schema, { date: day, raid, tag, nr: i + 1 });
        const exists = !name || taken.has(name);
        if (name) taken.add(name);
        return { date: day, name, exists };
    });
}

module.exports = {
    CHANNEL_NAME_MAX, NAME_STRIP_RE, DEFAULT_SCHEMA, WEEKDAYS, PLACEHOLDERS, MAX_SERIES,
    normalizeChannelName, normalizeForType, parseDay, formatDay, renderChannelName, seriesDays, planChannels,
};
