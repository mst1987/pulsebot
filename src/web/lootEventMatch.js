// Matching an imported loot export to the Raid-Helper event it belongs to.
// Loot addons never carry the event id, only a date (Gargul, no time-of-day)
// or a servertime (RCLootcouncil) from during the raid — so the event whose
// start falls on the same calendar day (Europe/Berlin) is the match. Two raids
// on the same day are a coin flip, so that case is reported as ambiguous
// instead of guessed (mirrors the log→event matching in logEventMatch.js).
//
// Kept framework-free and side-effect-free so it is trivially unit-testable.

const { DateTime } = require("luxon");
const { eventStartMs } = require("./logEventMatch");

const ZONE = "Europe/Berlin";

/** "yyyy-MM-dd" in Europe/Berlin for a ms timestamp, or "" when unusable. */
function dayKey(ms) {
    if (!ms) return "";
    return DateTime.fromMillis(ms, { zone: ZONE }).toFormat("yyyy-MM-dd");
}

/** Events whose Raid-Helper start falls on the same calendar day as `detectedMs`. */
function candidatesForDay(detectedMs, events) {
    const day = dayKey(detectedMs);
    if (!day) return [];
    return (events || []).filter((e) => dayKey(eventStartMs(e)) === day);
}

/**
 * The single event a detected loot-import date belongs to.
 * @returns {{match: object|null, candidates: object[], ambiguous: boolean}}
 *   `match` is null both when nothing matches and when the day is ambiguous
 *   (more than one event that day) — callers must check `ambiguous` to tell
 *   the two apart.
 */
function bestDayMatch(detectedMs, events) {
    const candidates = candidatesForDay(detectedMs, events);
    if (!candidates.length) return { match: null, candidates, ambiguous: false };
    if (candidates.length > 1) return { match: null, candidates, ambiguous: true };
    return { match: candidates[0], candidates, ambiguous: false };
}

/** "12.07.2026" in Europe/Berlin, for messages shown to the admin. */
function formatDayDisplay(ms) {
    if (!ms) return "";
    return DateTime.fromMillis(ms, { zone: ZONE }).toFormat("dd.MM.yyyy");
}

module.exports = { dayKey, candidatesForDay, bestDayMatch, formatDayDisplay };
