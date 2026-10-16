// How many addon downloads one account may start (#818): at most LIMIT within
// a rolling WINDOW_MS. In memory on purpose — a restart forgets the counts,
// which is fine for a guard against a script hammering the route (every
// download goes through the bot's own bandwidth and the GitHub token).
const LIMIT = 30;
const WINDOW_MS = 60 * 60 * 1000;

/** userId -> start times (ms) inside the window, oldest first */
const starts = new Map();

/**
 * Counts one download for `userId` when the window allows it.
 * @returns {{ ok: true, left: number } | { ok: false, retryAfterSec: number }}
 */
function takeDownload(userId, now = Date.now(), { limit = LIMIT, windowMs = WINDOW_MS } = {}) {
    const key = String(userId || "");
    const recent = (starts.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
        starts.set(key, recent);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
    }
    recent.push(now);
    starts.set(key, recent);
    return { ok: true, left: limit - recent.length };
}

/** Tests only: forget every count. */
function resetDownloadLimit() {
    starts.clear();
}

module.exports = { takeDownload, resetDownloadLimit, LIMIT, WINDOW_MS };
