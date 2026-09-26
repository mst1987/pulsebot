// In-memory state for the multi-step /apply flow (select -> spec -> modal).
// A pending entry is dropped after 30 minutes (the modal must be submitted
// promptly) by a periodic sweep, following the start()/stop() pattern of
// src/utils/sheetCleanup.js: idempotent, unref'd so it never keeps the
// process alive on its own, and started explicitly from bot.js rather than
// as a side effect of require() (#430).

const pendingApplications = new Map();

const { APPLICATION_STALE_AFTER_MS: STALE_AFTER_MS, APPLICATION_SWEEP_INTERVAL_MS: SWEEP_INTERVAL_MS } = require("../config/constants");

function sweepStaleApplications(now = Date.now()) {
    const cutoff = now - STALE_AFTER_MS;
    for (const [userId, data] of pendingApplications.entries()) {
        if (data.timestamp < cutoff) {
            pendingApplications.delete(userId);
        }
    }
}

let timer = null;

/** Start the periodic sweep (idempotent). The timer is unref'd so it never
 * keeps the process alive on its own. */
function start({ intervalMs = SWEEP_INTERVAL_MS } = {}) {
    if (timer) return timer;
    timer = setInterval(() => sweepStaleApplications(), intervalMs);
    if (timer.unref) timer.unref();
    return timer;
}

/** Stop the periodic sweep (idempotent). */
function stop() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

module.exports = { pendingApplications, sweepStaleApplications, start, stop };
