// Assigning detected Warcraft-Logs to the Raid-Helper event they belong to,
// purely by time: a log link is posted in the log channel when the raid starts
// (live logging) or shortly after it ends, so the raid that started closest
// before the post is the one the log belongs to. Only raids of the log's game
// version count, and the version of the log channel's category breaks a tie
// for a log of unknown version (#746, logVersion.js).
//
// Kept framework-free and side-effect-free (like reportList.js) so it is
// trivially unit-testable; the server route feeds it the tracked logs plus the
// events fetched from Raid-Helper.

const { logPostedAt } = require("./reportList");
const { LOG_WINDOW_BEFORE_MS, LOG_WINDOW_AFTER_MS } = require("../events/recentEvents");
const { knownLogVersion, categoryVersion } = require("./logVersion");
const { knownVersion } = require("../events/mainVersion");

const HOUR_MS = 60 * 60 * 1000;

// How far around an event start a log post may fall to still count as that raid's
// log — the same window the dashboard's "Latest Events" card uses, so a suggested
// assignment never contradicts what the dashboard already shows.
const DEFAULT_BEFORE_MS = LOG_WINDOW_BEFORE_MS;
const DEFAULT_AFTER_MS = LOG_WINDOW_AFTER_MS;
// When the two best candidates are this close to each other (two raids the same
// evening), the assignment is a coin flip — never guess, ask the admin.
const DEFAULT_AMBIGUOUS_MS = 2 * HOUR_MS;

/**
 * An event's start as epoch ms. Raid-Helper reports `startTime` in seconds;
 * values that are already milliseconds (>= year 2001 in ms) are passed through so
 * callers may hand in either. Returns 0 when unusable.
 */
function eventStartMs(event) {
    const raw = Number(event && event.startTime);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return raw > 1e11 ? raw : raw * 1000;
}

function windowFrom(opts = {}) {
    const num = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback);
    return {
        beforeMs: num(opts.beforeMs, DEFAULT_BEFORE_MS),
        afterMs: num(opts.afterMs, DEFAULT_AFTER_MS),
        ambiguousMs: num(opts.ambiguousMs, DEFAULT_AMBIGUOUS_MS),
    };
}

/**
 * All events a log could plausibly belong to, best first.
 * @param {object} log     tracked log (postedAt / messageId / detectedAt, categoryId)
 * @param {object[]} events  [{ id, title, startTime, categoryId, ... }]
 * @param {object} [opts]  { beforeMs, afterMs }
 * @returns {{event: object, diffMs: number, sameCategory: boolean, sameVersion: boolean}[]}
 *   diffMs is the log post time minus the event start (positive = posted after).
 *   Only raids of the log's game version when its host told one (#746,
 *   logVersion.knownLogVersion); an event without a version stays in.
 *   Ranked by category match first (a log posted in a channel of the event's
 *   category is a stronger signal than a few minutes of time difference), then,
 *   for a log of unknown version, by whether the raid plays the version of the
 *   log channel's category (sameVersion), then by absolute time distance.
 */
function candidatesFor(log, events, opts = {}) {
    const posted = logPostedAt(log || {});
    if (!posted) return [];
    const { beforeMs, afterMs } = windowFrom(opts);
    const logCategory = String((log && log.categoryId) || "");
    const logVersion = knownLogVersion(log);
    const tieVersion = logVersion ? "" : categoryVersion(log);
    const out = [];
    for (const event of events || []) {
        const start = eventStartMs(event);
        if (!start) continue;
        const diffMs = posted - start;
        if (diffMs < -beforeMs || diffMs > afterMs) continue;
        const eventVersion = knownVersion(event && event.versionId);
        if (logVersion && eventVersion && eventVersion !== logVersion) continue;
        const eventCategory = String((event && event.categoryId) || "");
        out.push({
            event,
            diffMs,
            sameCategory: !!(logCategory && eventCategory && logCategory === eventCategory),
            sameVersion: !!(tieVersion && eventVersion === tieVersion),
        });
    }
    return out.sort((a, b) => {
        if (a.sameCategory !== b.sameCategory) return a.sameCategory ? -1 : 1;
        if (a.sameVersion !== b.sameVersion) return a.sameVersion ? -1 : 1;
        return Math.abs(a.diffMs) - Math.abs(b.diffMs);
    });
}

/**
 * The raid number a log's title names — "Zul'Aman 2", "ZA #2", "Raid 2 Kara" —
 * or 0. Only 1–9: a raid group never has more raids.
 */
function raidNumberOf(title) {
    const text = String(title || "");
    const m = text.match(/\braid\s*#?\s*([1-9])\b/i) || text.match(/(?:^|[\s#(-])#?([1-9])\s*\)?\s*$/);
    return m ? Number(m[1]) : 0;
}

/**
 * The raids of a raid group (#811) start together, so time and category can
 * never tell them apart — their logs land as "ambiguous" and the matching offers
 * every raid of the group. One sign decides it: the log's title names the raid's
 * number ("Zul'Aman 2" → Raid 2). Returns that candidate, null when the top
 * candidates are no group or the title names none of them.
 */
function siblingPick(log, candidates) {
    const [best, second] = candidates || [];
    const group = best && best.event && best.event.raidGroupId;
    if (!group || !second || !second.event || second.event.raidGroupId !== group) return null;
    const number = raidNumberOf(log && log.title);
    if (!number) return null;
    const hits = candidates.filter((c) => c.event && c.event.raidGroupId === group && Number(c.event.raidGroupIndex) === number);
    return hits.length === 1 ? hits[0] : null;
}

/**
 * The single best event for a log, plus whether that pick is safe to apply
 * automatically.
 * @returns {{match: object|null, candidates: object[], ambiguous: boolean}}
 *   `match` is the top candidate (null when nothing is in the window).
 *   `ambiguous` is true when a second candidate is nearly as plausible; the
 *   automatic assignment skips those so an admin can decide.
 */
function bestMatch(log, events, opts = {}) {
    const candidates = candidatesFor(log, events, opts);
    if (!candidates.length) return { match: null, candidates, ambiguous: false };
    const { ambiguousMs } = windowFrom(opts);
    // a raid group (#811): the title's raid number picks among raids that start together;
    // only another raid outside the group can still make it a coin flip
    const picked = siblingPick(log, candidates);
    if (picked) {
        const other = candidates.find((c) => c.event.raidGroupId !== picked.event.raidGroupId);
        const close = other && other.sameCategory === picked.sameCategory
            && Math.abs(Math.abs(other.diffMs) - Math.abs(picked.diffMs)) < ambiguousMs;
        return { match: picked, candidates: [picked, ...candidates.filter((c) => c !== picked)], ambiguous: !!close };
    }
    const [best, second] = candidates;
    let ambiguous = false;
    if (second) {
        // A unique category hit decides it, then a unique hit on the version of
        // the log channel's category (#746); otherwise compare time distances.
        const decidedByCategory = best.sameCategory && !second.sameCategory;
        const decidedByVersion = best.sameCategory === second.sameCategory && best.sameVersion && !second.sameVersion;
        const gap = Math.abs(Math.abs(second.diffMs) - Math.abs(best.diffMs));
        ambiguous = !decidedByCategory && !decidedByVersion && gap < ambiguousMs;
    }
    return { match: best, candidates, ambiguous };
}

/** True when the log already carries an event assignment. */
function isLinked(log) {
    return !!(log && String(log.eventId || "").trim());
}

/**
 * Annotate logs with their match result for rendering. Mutates the items in
 * place (render-only, never persisted) and returns them. Already linked logs are
 * left alone.
 */
function annotateMatches(logs, events, opts = {}) {
    for (const log of logs || []) {
        if (!log || isLinked(log)) continue;
        const { candidates, ambiguous } = bestMatch(log, events, opts);
        log.candidates = candidates.map((c) => ({
            eventId: c.event.id,
            title: c.event.title || "",
            startTime: c.event.startTime || 0,
            categoryName: c.event.categoryName || "",
            diffMs: c.diffMs,
            sameCategory: c.sameCategory,
            versionId: c.event.versionId || "",
            // #811: which raid of a raid group ("Raid 2"), 0 outside one
            raidGroupIndex: c.event.raidGroupId ? Number(c.event.raidGroupIndex) || 0 : 0,
        }));
        log.matchAmbiguous = ambiguous;
    }
    return logs || [];
}

/**
 * Every unambiguous assignment for the not-yet-linked logs — what the
 * "automatisch zuordnen" button applies.
 * @returns {{log: object, event: object, diffMs: number}[]}
 */
function autoMatches(logs, events, opts = {}) {
    const out = [];
    for (const log of logs || []) {
        if (!log || isLinked(log)) continue;
        const { match, ambiguous } = bestMatch(log, events, opts);
        if (!match || ambiguous) continue;
        out.push({ log, event: match.event, diffMs: match.diffMs });
    }
    return out;
}

module.exports = {
    candidatesFor, bestMatch, autoMatches, annotateMatches, isLinked, eventStartMs, siblingPick, raidNumberOf,
    HOUR_MS, DEFAULT_BEFORE_MS, DEFAULT_AFTER_MS, DEFAULT_AMBIGUOUS_MS,
};
