// Pure logic for the dashboard's "Latest Events" card: pick the raids that have
// already happened and attach the Warcraft-Logs that belong to them.
//
// Raid-Helper knows nothing about our log channels, so an event and a log can
// only be linked by time: a raid's logs are uploaded while the raid runs or
// shortly after it. We therefore match every tracked log whose CHANNEL POST time
// falls into a window around the event start. The window is deliberately
// generous on the late side (logs are often uploaded the next morning) and tight
// on the early side (so a log still belongs to the previous raid, not the next).
//
// Kept side-effect-free (no stores, no HTTP) so it is trivially unit-testable;
// the server route feeds it the already-loaded events and logs.

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

// How far before / after an event's start a log may have been posted to count as
// that event's log.
const LOG_WINDOW_BEFORE_MS = 2 * HOUR_MS;
const LOG_WINDOW_AFTER_MS = 18 * HOUR_MS;

// How far back the dashboard looks for finished raids.
const RECENT_WINDOW_DAYS = 21;

/**
 * Logs that belong to one event, newest post first. An explicit assignment (the
 * `eventId` set via the CLA logs list, see logEventMatch.js) always wins over the
 * time window: such a log shows up under ITS event only, never under a
 * neighbouring raid that merely happens to fit time-wise.
 * @param {object} event  { id, startTime } — Raid-Helper start time in SECONDS
 * @param {object[]} logs tracked logs, each annotated with a `postedAt` in ms
 */
function matchLogsForEvent(event, logs) {
    const startMs = Number(event && event.startTime) * 1000;
    if (!startMs) return [];
    const eventId = String((event && event.id) || "");
    const from = startMs - LOG_WINDOW_BEFORE_MS;
    const to = startMs + LOG_WINDOW_AFTER_MS;
    return (logs || [])
        .filter((l) => {
            if (!l) return false;
            const linked = String(l.eventId || "");
            if (linked) return linked === eventId;
            return l.postedAt >= from && l.postedAt <= to;
        })
        .sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
}

/**
 * The most recently finished events, newest first, each with its matched logs.
 * Events that are still upcoming (or that started less than `minAgeMs` ago, so a
 * running raid does not show up as "done") are dropped.
 *
 * @param {object[]} events raid-helper events ({ id, title, startTime, ... })
 * @param {object}   opts   { now, logs, limit, windowDays, minAgeMs }
 * @returns {object[]} events with an added `logs` array
 */
function buildRecentEvents(events, opts = {}) {
    const now = Number(opts.now) || Date.now();
    const logs = opts.logs || [];
    const limit = opts.limit > 0 ? opts.limit : 5;
    const windowDays = opts.windowDays > 0 ? opts.windowDays : RECENT_WINDOW_DAYS;
    const minAgeMs = Number.isFinite(opts.minAgeMs) ? opts.minAgeMs : 0;
    const oldest = now - windowDays * DAY_MS;

    return (events || [])
        .filter((ev) => {
            const startMs = Number(ev && ev.startTime) * 1000;
            return Boolean(startMs) && startMs <= now - minAgeMs && startMs >= oldest;
        })
        .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
        .slice(0, limit)
        .map((ev) => ({ ...ev, logs: matchLogsForEvent(ev, logs) }));
}

module.exports = {
    matchLogsForEvent, buildRecentEvents,
    LOG_WINDOW_BEFORE_MS, LOG_WINDOW_AFTER_MS, RECENT_WINDOW_DAYS,
};
