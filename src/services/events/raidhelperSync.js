// The one place that asks Raid-Helper for the event list (#606).
//
// Raid-Helper allows 1000 requests per API key and day (utils/raidhelper/
// budget.js). Pages, bot commands and the other jobs used to ask on every view
// and every tick and used them up by the afternoon; now this job fetches the
// list once every SYNC_INTERVAL_MS — every event that starts within the last
// EVENT_LOOKBACK_DAYS or later, signups included, ONE request — and stores it
// (stores/raidhelperEventsStore.js). Every other reader gets a client whose
// list reads answer from that store (utils/raidhelper/client.js). 288 requests
// a day at most, plus the few raidplans the snapshot scan picks up.
//
// After each sync the snapshot scan (raidEventScan.js) runs over every guild,
// so a finished raid's roster and raidplan are kept once Raid-Helper drops them.
// "Jetzt aktualisieren" in the settings calls refreshNow(), and a successful
// write through a client (create an event, sign up) asks for a sync a few
// seconds later, so its result shows up without waiting for the next tick.
//
// A failed sync keeps the last list and records the reason; Raid-Helper being
// switched off (#291) skips the job entirely.

const { createRaidhelperClient, raidhelperDisabled, setAfterWrite } = require("../../utils/raidhelper/client");
const { readSnapshot, saveSnapshot, saveSyncError } = require("../../stores/raidhelperEventsStore");
const budget = require("../../utils/raidhelper/budget");
const { scanAllGuilds } = require("./raidEventScan");
const { EVENT_LOOKBACK_DAYS } = require("./raidEventGroups");
const logger = require("../../logger").child("raidhelperSync");

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
// "Jetzt aktualisieren" at most this often, however often it is clicked.
const MANUAL_MIN_GAP_MS = 30 * 1000;
// A write is followed by a sync this much later (several writes share one).
const AFTER_WRITE_DELAY_MS = 5 * 1000;

let running = null;

/**
 * Fetch the event list once and store it, then snapshot the past raids.
 * Concurrent calls share one run. Never throws.
 * @returns {Promise<{ ok: boolean, error?: string, disabled?: boolean }>}
 */
function syncRaidhelperEvents() {
    if (raidhelperDisabled()) return Promise.resolve({ ok: false, disabled: true });
    if (running) return running;
    running = runSync().finally(() => {
        running = null;
    });
    return running;
}

async function runSync() {
    const since = Math.floor(Date.now() / 1000) - EVENT_LOOKBACK_DAYS * 86400;
    try {
        const events = await createRaidhelperClient({ live: true }).fetchEvents(since);
        saveSnapshot({ syncedAt: Date.now(), since, events });
    } catch (e) {
        const message = (e && e.message) || "Raid-Helper ist nicht erreichbar.";
        saveSyncError(message, Date.now());
        // a refusal of the budget is the budget working, not news
        if (!budget.isBudgetError(e)) logger.warn(`sync failed: ${message}`);
        return { ok: false, error: message };
    }
    try {
        await scanAllGuilds({ probeSetups: true });
    } catch (e) {
        logger.warn(`snapshot scan failed: ${e.message}`);
    }
    return { ok: true };
}

/** What the settings page shows: last sync, its events, its error, and the budget. */
function syncStatus() {
    const snap = readSnapshot();
    return {
        syncedAt: snap.syncedAt,
        events: snap.events.length,
        error: snap.error,
        errorAt: snap.errorAt,
        intervalMs: SYNC_INTERVAL_MS,
        disabled: raidhelperDisabled(),
        budget: budget.status(),
    };
}

/**
 * "Jetzt aktualisieren": a sync now, unless the last attempt is younger than
 * MANUAL_MIN_GAP_MS (then `throttled` and nothing is sent).
 */
async function refreshNow() {
    const snap = readSnapshot();
    const last = Math.max(snap.syncedAt, snap.errorAt);
    if (Date.now() - last < MANUAL_MIN_GAP_MS) return { ...syncStatus(), throttled: true };
    const result = await syncRaidhelperEvents();
    return { ...syncStatus(), throttled: false, ok: result.ok };
}

let writeTimer = null;

/** A write went through: sync a few seconds later (debounced). */
function syncSoon() {
    if (writeTimer) return;
    writeTimer = setTimeout(() => {
        writeTimer = null;
        syncRaidhelperEvents();
    }, AFTER_WRITE_DELAY_MS);
    if (writeTimer.unref) writeTimer.unref();
}

let timer = null;

/**
 * Start the job (idempotent): one sync right away, then every SYNC_INTERVAL_MS.
 * The timer is unref'd so it never keeps the process alive on its own.
 */
function startRaidhelperSync({ intervalMs = SYNC_INTERVAL_MS } = {}) {
    if (timer) return timer;
    setAfterWrite(syncSoon);
    syncRaidhelperEvents();
    timer = setInterval(syncRaidhelperEvents, intervalMs);
    if (timer.unref) timer.unref();
    return timer;
}

/** Stop the job (idempotent); a later start begins afresh. */
function stopRaidhelperSync() {
    if (timer) clearInterval(timer);
    if (writeTimer) clearTimeout(writeTimer);
    timer = null;
    writeTimer = null;
    setAfterWrite(null);
}

module.exports = {
    syncRaidhelperEvents, syncStatus, refreshNow, syncSoon, startRaidhelperSync, stopRaidhelperSync,
    SYNC_INTERVAL_MS, MANUAL_MIN_GAP_MS,
};
