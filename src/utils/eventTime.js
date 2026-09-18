// How long a raid takes and when it is over (#305) — the one rule, kept apart
// from eventStore.js on purpose: the signup message, the Discord event and the
// setup all need it, and several of them mock the store in their tests. A rule
// that lives in the store would have to be mocked along with it, which is how a
// pure calculation quietly turns into four slightly different ones.
//
// The duration is a planning field: an event inherits it from its raid
// template, and without one it is DEFAULT_DURATION.

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

module.exports = { MIN_DURATION, MAX_DURATION, DEFAULT_DURATION, clampDuration, eventEndTime };
