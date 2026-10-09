// Title and raids of a Warcraft-Log for the log lists (Log-Auswertung, raid
// detail), read from one WCL request per log (report/fights). Split out of
// logChannel.js so logAutoLink's background sweep can call it without a
// require cycle (logChannel requires logAutoLink).
const logStore = require("../../stores/logStore");
const WarcraftLogs = require("../../classes/warcraftlogs");
const { analyzeRaidProgress, raidSummary } = require("../../utils/logcheck/raidProgress");

// A log whose raid was not finished when its fight list was read is read again —
// it may have been a live log — but only while the post is fresh: a raid that was
// called off stays unfinished forever and must not cost a request on every view.
const RAIDS_REFRESH_MS = 10 * 60 * 1000;
const RAIDS_LIVE_WINDOW_MS = 12 * 60 * 60 * 1000;

// How many WCL requests one page view may wait for, how many one background
// sweep makes, and how long a report that failed is left alone (in memory: a
// restart retries it once).
const BACKFILL_PAGE_LIMIT = 3;
const BACKFILL_SWEEP_LIMIT = 20;
const BACKFILL_RETRY_MS = 30 * 60 * 1000;
const backfillFailedAt = new Map(); // reportId -> ms of the failed attempt

function recentlyFailed(reportId, now) {
    const at = backfillFailedAt.get(reportId);
    if (at === undefined) return false;
    if (now - at < BACKFILL_RETRY_MS) return true;
    backfillFailedAt.delete(reportId);
    return false;
}

function needsRaids(l, now) {
    if (!Array.isArray(l.raids)) return true;
    if (logStore.evaluatedSections(l).length) return false; // the report's own progress takes over
    const unfinished = l.raids.some((r) => !r.finalKilled);
    const posted = l.postedAt || l.detectedAt || 0;
    return unfinished && now - posted < RAIDS_LIVE_WINDOW_MS && now - (l.raidsAt || 0) > RAIDS_REFRESH_MS;
}

/**
 * Backfill what the log list shows before a log is evaluated, from one
 * Warcraft-Logs request per log (report/fights): the display title (the report
 * name instead of the raw code) and the raids it covers with their boss count
 * ("Hyjal 3/5", raidProgress.raidSummary). Mutates each log in place and persists
 * both. Best-effort: a missing API key or a failed/rate-limited request is
 * ignored (the row keeps what it had). Only the given logs (i.e. the current
 * page) are looked at, and of those at most `limit` (in the given order) are
 * fetched, in parallel — a page with 40 untitled logs used to wait for 40 WCL
 * requests on every view. A report that failed (or came back without a title)
 * is not asked again for BACKFILL_RETRY_MS. The rest is filled by the
 * background sweep (backfillAllLogTitles, run by logAutoLink's timer).
 * Returns how many titles were filled.
 */
async function backfillLogTitles(logs, now = Date.now(), { limit = BACKFILL_PAGE_LIMIT } = {}) {
    const missing = (logs || [])
        .filter((l) => l && l.reportId && (!l.title || needsRaids(l, now)) && !recentlyFailed(l.reportId, now))
        .slice(0, Math.max(0, limit));
    if (!missing.length) return 0;
    let wcl;
    try {
        wcl = new WarcraftLogs();
    } catch {
        return 0; // no WARCRAFTLOGS_API_KEY — skip silently
    }
    let filled = 0;
    await Promise.all(missing.map(async (l) => {
        try {
            const data = await wcl.getFights(l.reportId);
            const title = data && data.title ? String(data.title).trim() : "";
            if (title && !l.title) {
                logStore.setLogTitle(l.id, title);
                l.title = title; // reflect in the in-memory page items
                filled += 1;
            }
            if (data && Array.isArray(data.fights)) {
                const raids = raidSummary(analyzeRaidProgress(data));
                logStore.setLogRaids(l.id, raids);
                l.raids = raids;
                l.raidsAt = now;
            }
            if (!l.title) backfillFailedAt.set(l.reportId, now); // answered, but nothing to show: not again soon
        } catch {
            // report deleted / rate-limited — leave the code, retry after BACKFILL_RETRY_MS
            backfillFailedAt.set(l.reportId, now);
        }
    }));
    return filled;
}

/**
 * The background half of backfillLogTitles: every stored log, newest first, at
 * most `limit` WCL requests per run. Run by logAutoLink's 10-minute sweep, so a
 * page only ever waits for its first few logs. Never throws.
 */
async function backfillAllLogTitles({ limit = BACKFILL_SWEEP_LIMIT, now = Date.now() } = {}) {
    try {
        const newestFirst = [...logStore.listLogs()]
            .sort((a, b) => (b.postedAt || b.detectedAt || 0) - (a.postedAt || a.detectedAt || 0));
        return await backfillLogTitles(newestFirst, now, { limit });
    } catch (e) {
        console.error("[logTitles] title backfill failed:", (e && e.message) || e);
        return 0;
    }
}

/** Test-only: forget the failed reports. */
function _resetBackfillForTests() {
    backfillFailedAt.clear();
}

module.exports = {
    backfillLogTitles, backfillAllLogTitles, BACKFILL_PAGE_LIMIT, BACKFILL_SWEEP_LIMIT, BACKFILL_RETRY_MS, _resetBackfillForTests,
};
