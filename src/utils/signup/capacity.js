// What a raid does once its size is reached (#306, #516), and how the fill is
// written — one place for the event store, the raid templates, the signup rules
// and every counter (event message, public page, talk overview, bot overview).
//
// `overflow` of an event / a raid template:
//   "none"     no limit (default since #516): every signup stays "Dabei"/"Spät",
//              the 25 are picked in the setup;
//   "waitlist" a new seat-taking signup on a full raid becomes the bench;
//   "refuse"   a new seat-taking signup on a full raid is refused (409 `full`).
//
// Before #516 the two limited modes were stored as "bench" and "off". Those
// values are *legacy*: the read path treats them as "none", and the start
// migration (settingsMigration.js) writes "none" over them once and switches
// `lockAtLimit` off on the same record. Because the new names differ, the
// migration can tell an untouched old record from a deliberate new choice and
// runs only once per record — no marker needed.

const OVERFLOW_MODES = ["none", "waitlist", "refuse"];
const DEFAULT_OVERFLOW = "none";
const LEGACY_OVERFLOW = ["bench", "off"];

/** A stored or sent overflow value as one of OVERFLOW_MODES; anything else (legacy included) is "none". */
function normalizeOverflow(value) {
    return OVERFLOW_MODES.includes(value) ? value : DEFAULT_OVERFLOW;
}

/** Whether a stored overflow value is one from before #516 ("bench" / "off"). */
function isLegacyOverflow(value) {
    return LEGACY_OVERFLOW.includes(value);
}

/**
 * `lockAtLimit` as stored: a record still carrying a legacy overflow value reads
 * as "off" — the same answer the migration writes down.
 */
function normalizeLockAtLimit(record) {
    const src = record || {};
    return !isLegacyOverflow(src.overflow) && src.lockAtLimit === true;
}

/**
 * The fill in pieces: `shown` seats (never more than the size), the `size`
 * (0 = none) and `extra` signups beyond it — for a counter that styles them apart.
 */
function seatsParts(attending, size) {
    const n = Math.max(0, Number(attending) || 0);
    const cap = Number(size) > 0 ? Number(size) : 0;
    const extra = cap ? Math.max(0, n - cap) : 0;
    return { shown: extra ? cap : n, size: cap, extra };
}

/**
 * The fill as the counters write it: "22/25" below the size, "25/25 (+3)" when
 * more signed up than there are seats, just "12" without a size. `sep` is what
 * stands between the two numbers (the message puts spaces around the slash).
 */
function seatsText(attending, size, { sep = "/" } = {}) {
    const p = seatsParts(attending, size);
    if (!p.size) return String(p.shown);
    return `${p.shown}${sep}${p.size}${p.extra ? ` (+${p.extra})` : ""}`;
}

module.exports = {
    OVERFLOW_MODES, DEFAULT_OVERFLOW, normalizeOverflow, isLegacyOverflow, normalizeLockAtLimit, seatsParts, seatsText,
};
