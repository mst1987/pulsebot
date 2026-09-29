// The raid plan follows the raid (#534): which bosses of an event's plan are down, which one is being
// fought and which one comes next, read from the Warcraft Log linked to the event.
//
// - The report is the one the log store links to the event (services/logcheck/logAutoLink.js links a posted
//   log automatically, an admin can correct it) — the newest linked log that has a report id.
// - Its fights come from the WCL **v1** API (report/fights): the key the bot needs anyway, no OAuth client
//   (v2 is optional, see classes/warcraftlogs.js). One request per report and minute at most, however many
//   pages ask (`CACHE_MS`, one promise per report so parallel requests share it); a failed request is cached
//   as "no data" for the same minute, so a private report or WCL's rate limit is not hammered.
// - Only inside the raid window (start − 30 min to start + 6 h): outside it no request is made and the
//   answer is empty, so a plan opened the day after shows nothing of the night before.
// The derivation itself is pure: utils/logcheck/bossProgress.js.

const logStore = require("../../stores/logStore");
const raidplanStore = require("../../stores/raidplanStore");
const WarcraftLogs = require("../../classes/warcraftlogs");
const { eventStartMs } = require("../logcheck/logEventMatch");
const { deriveProgress } = require("../../utils/logcheck/bossProgress");

const MINUTE_MS = 60 * 1000;
const WINDOW_BEFORE_MS = 30 * MINUTE_MS;
const WINDOW_AFTER_MS = 6 * 60 * MINUTE_MS;
const CACHE_MS = MINUTE_MS;

/** The raid window of an event as epoch ms, null without a start time. */
function raidWindow(event) {
    const start = eventStartMs(event);
    if (!start) return null;
    return { from: start - WINDOW_BEFORE_MS, to: start + WINDOW_AFTER_MS };
}

/** Whether `now` lies in the event's raid window. */
function inRaidWindow(event, now = Date.now()) {
    const w = raidWindow(event);
    return !!w && now >= w.from && now <= w.to;
}

/** The WCL report id of the log linked to an event (the newest post with one), or "". */
function reportIdForEvent(eventId) {
    const log = logStore.listLogsForEvent(eventId).find((l) => l && l.reportId);
    return log ? String(log.reportId) : "";
}

/** The plan's bosses in the order of its sections (no "Allgemein", no trash): `{ key, name, instanceId }`. */
function planBosses(event) {
    return raidplanStore.bossesForInstances(event && event.instanceIds)
        .filter((b) => !b.general && !b.trash)
        .map((b) => ({ key: b.key, name: b.name, instanceId: b.instanceId }));
}

// reportId -> { at, promise } ; the promise resolves to the fights answer or null
const cache = new Map();

/** The fights of a report, at most one WCL request per report and `CACHE_MS`. Resolves to `{ fights, at }`. */
function fightsFor(reportId, { now = Date.now(), client } = {}) {
    const hit = cache.get(reportId);
    if (hit && now - hit.at < CACHE_MS) return hit.promise;
    const promise = (async () => {
        try {
            const wcl = client || new WarcraftLogs();
            return { fights: await wcl.getFights(reportId), at: now };
        } catch (e) {
            console.error(`[raidplanProgress] fights of ${reportId}: ${e.message}`);
            return { fights: null, at: now };
        }
    })();
    cache.set(reportId, { at: now, promise });
    // a finished raid's reports would pile up otherwise
    for (const [id, entry] of cache) if (now - entry.at > WINDOW_AFTER_MS) cache.delete(id);
    return promise;
}

const EMPTY = Object.freeze({ live: false, killed: [], current: null, next: null, updatedAt: null });

/**
 * The progress of an event's plan: `{ live, killed, current, next, updatedAt }`. `live` is true when a linked
 * log was read inside the raid window; otherwise everything is empty (`killed: []`, `current`/`next` null).
 * @param {object} event   `{ id, startTime, instanceIds }`
 * @param {{ now?: number, client?: object }} [opts]   `client`: a WarcraftLogs stand-in (tests)
 */
async function progressFor(event, { now = Date.now(), client } = {}) {
    if (!event || !inRaidWindow(event, now)) return { ...EMPTY, killed: [] };
    const reportId = reportIdForEvent(event.id);
    if (!reportId) return { ...EMPTY, killed: [] };
    const { fights, at } = await fightsFor(reportId, { now, client });
    if (!fights) return { ...EMPTY, killed: [] };
    return { live: true, ...deriveProgress(fights, planBosses(event)), updatedAt: at };
}

/** Test-only: forget every cached report. */
function _resetCache() {
    cache.clear();
}

module.exports = {
    progressFor, fightsFor, inRaidWindow, raidWindow, reportIdForEvent, planBosses, _resetCache,
    WINDOW_BEFORE_MS, WINDOW_AFTER_MS, CACHE_MS,
};
