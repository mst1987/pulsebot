// The WCL guild fetch (#922): every minute, the due entries of every server's
// wclGuilds list (wclGuildSettings.js) are asked one after another for their
// new reports. A new report becomes a log of that server and version exactly
// like a link posted in a log channel (logStore.saveLog + autoLinkLogs, no
// evaluation); a report the bot already knows creates nothing.
//
// One run at a time (a run still going when the next minute comes is joined,
// not doubled), one fetch per entry at a time (the page's "Jetzt abrufen" joins
// a fetch of the same entry that is already running). lastRunAt/lastResult are
// written from a fresh config right after the await, for that one entry only,
// so an edit of the list while WCL answered is never overwritten.
//
// Errors land in lastResult and the log and never stop the run: 400 (unknown
// guild/realm/region), network errors, and 429 — which pauses only that WCL
// site for a while; the other sites go on.
const logStore = require("../../stores/loot/logStore");
const { wclClientFor, wclApiSite, reportLink } = require("./logVersion");
const { allWclGuilds, wclGuildsOf, entryKey, normalizeWclGuilds } = require("./wclGuildSettings");
const { isLiveInstance } = require("../../config/runMode");
const logger = require("../../logger").child("wclGuildSync");

const TICK_MS = 60 * 1000;
// how far back the first fetch of an entry looks
const FIRST_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
// WCL v1 reports/guild filters `start` by the START time of a report, not by its
// upload: a raid from 20:00 uploaded at 23:30 starts long before the last fetch.
// So later fetches look this far back from the last SUCCESSFUL fetch (a failed
// one never moves the window) and logStore.getByReportId drops the repeats.
const LOOKBACK_MS = 48 * 60 * 60 * 1000;
// a site that answered 429 is left alone this long
const RATE_LIMIT_PAUSE_MS = 15 * 60 * 1000;

let timer = null;
let running = null;
const inFlight = new Map(); // `${guildId}#${key}` -> promise
const pausedSites = new Map(); // site -> paused until (ms)

function settingsStore() {
    return require("../../stores/settings/settingsStore");
}

/** Whether an entry is due at `now`: never with interval 0, else once per interval. */
function isDue(entry, now = Date.now()) {
    const interval = Number(entry && entry.interval) || 0;
    if (interval <= 0) return false;
    const last = Number(entry.lastRunAt) || 0;
    return now - last >= interval * 60 * 1000;
}

/** A short, key-free message of a failed fetch. */
function errorMessage(e) {
    const status = e && (e.status || (e.response && e.response.status));
    if (status === 400) return "Gilde, Realm oder Region bei Warcraft Logs nicht gefunden.";
    if (status === 401 || status === 403) return "Warcraft Logs lehnt den API-Schlüssel ab.";
    if (status === 429) return "Warcraft Logs drosselt die Abfragen gerade (429), später erneut.";
    if (status) return `Warcraft Logs antwortete mit HTTP ${status}.`;
    if (e && e.code === "no_key") return "Kein Warcraft-Logs-API-Schlüssel eingerichtet.";
    if (e && e.code === "no_site") return "Für diese Spielversion ist keine Warcraft-Logs-Seite eingerichtet.";
    return "Warcraft Logs nicht erreichbar.";
}

/**
 * Write lastRunAt/lastResult onto the one entry `key` of `guildId`, from a fresh
 * config; lastSuccessAt (the start of the next window) only when WCL answered.
 */
function writeResult(guildId, key, result) {
    const { getConfig, saveConfig } = settingsStore();
    const list = wclGuildsOf(guildId, { config: getConfig() });
    const idx = list.findIndex((e) => entryKey(e) === key);
    if (idx < 0) return null; // removed while WCL answered: nothing to note
    list[idx] = {
        ...list[idx],
        lastRunAt: result.at,
        ...(result.error ? {} : { lastSuccessAt: result.at }),
        lastResult: result,
    };
    saveConfig({ serverSettings: { [guildId]: { wclGuilds: normalizeWclGuilds(list) } } });
    return list[idx];
}

/**
 * Where the fetch window of an entry starts: LOOKBACK_MS before its last
 * successful fetch, FIRST_LOOKBACK_MS back on its first (or after only failures),
 * never further back than FIRST_LOOKBACK_MS.
 */
function windowStart(entry, now) {
    const first = now - FIRST_LOOKBACK_MS;
    const last = Number(entry && entry.lastSuccessAt) || 0;
    return last > 0 ? Math.max(first, last - LOOKBACK_MS) : first;
}

async function fetchAndStore(guildId, entry, now) {
    const site = wclApiSite(entry.versionId);
    if (!site) { const e = new Error("no site"); e.code = "no_site"; throw e; }
    const until = pausedSites.get(site) || 0;
    if (until > now) { const e = new Error("rate limited"); e.status = 429; throw e; }
    let client;
    try {
        client = wclClientFor(entry.versionId);
    } catch {
        const e = new Error("no key"); e.code = "no_key"; throw e;
    }
    if (!client) { const e = new Error("no site"); e.code = "no_site"; throw e; }
    const start = windowStart(entry, now);
    let reports;
    try {
        reports = await client.getGuildReports(entry.guildName, entry.realm, entry.region, { start });
    } catch (e) {
        const status = e && (e.status || (e.response && e.response.status));
        if (status === 429) pausedSites.set(site, Date.now() + RATE_LIMIT_PAUSE_MS);
        throw e;
    }
    let found = 0;
    for (const r of Array.isArray(reports) ? reports : []) {
        const reportId = String((r && r.id) || "");
        if (!/^[A-Za-z0-9]+$/.test(reportId) || logStore.getByReportId(reportId)) continue;
        const log = logStore.saveLog({
            guildId,
            reportId,
            link: reportLink({ reportId, versionId: entry.versionId }),
            title: String(r.title || ""),
            source: "guild",
            postedAt: Number(r.start) || now,
            channelVersionId: entry.versionId,
        });
        if (!log) continue;
        if (Number(r.start) > 0) logStore.setReportStart(log.id, r.start);
        // saveLog runs synchronously right after getByReportId, so this is a new log
        found++;
    }
    if (found) {
        try {
            await require("./logAutoLink").autoLinkLogs(guildId);
        } catch (e) {
            logger.warn(`auto link after the guild fetch failed for server ${guildId}: ${e.message}`);
        }
    }
    return found;
}

/**
 * Fetch one entry now and note the result. Joins a fetch of the same entry
 * that is already running. Resolves to { found, error, at } (never throws),
 * or null when the server has no such entry.
 */
function fetchEntry(guildId, key) {
    const id = `${guildId}#${key}`;
    if (inFlight.has(id)) return inFlight.get(id);
    const p = (async () => {
        const entry = wclGuildsOf(guildId, { config: settingsStore().getConfig() }).find((e) => entryKey(e) === key);
        if (!entry) return null;
        const now = Date.now();
        let result;
        try {
            const found = await fetchAndStore(guildId, entry, now);
            result = { found, error: "", at: now };
            if (found) logger.info(`server ${guildId}: ${found} new log(s) of WCL guild "${entry.guildName}" (${entry.versionId})`);
        } catch (e) {
            result = { found: 0, error: errorMessage(e), at: now };
            logger.warn(`server ${guildId}: WCL guild "${entry.guildName}" (${entry.versionId}) failed: ${result.error}`);
        }
        writeResult(guildId, key, result);
        return result;
    })().finally(() => inFlight.delete(id));
    inFlight.set(id, p);
    return p;
}

async function runDueNow(now) {
    let fetched = 0;
    for (const entry of allWclGuilds({ config: settingsStore().getConfig() })) {
        if (!isDue(entry, now)) continue;
        await fetchEntry(entry.guildId, entry.key);
        fetched++;
    }
    return fetched;
}

/** One pass over all due entries; a pass still running is joined, not doubled. */
function runDue(now = Date.now()) {
    if (running) return running;
    running = runDueNow(now)
        .catch((e) => { logger.warn(`run failed: ${e.message}`); return 0; })
        .finally(() => { running = null; });
    return running;
}

/** Whether a fetch of that entry (or a whole pass) is going on. */
function isFetching(guildId, key) {
    return inFlight.has(`${guildId}#${key}`);
}

/**
 * Start the minute tick (idempotent; the timer is unref'd). Only on the live
 * bot: a test instance shares the WCL key and its copied settings would fetch
 * the same guilds again; there "Jetzt abrufen" (fetchEntry) still works.
 */
function startWclGuildSync({ intervalMs = TICK_MS, live = isLiveInstance() } = {}) {
    if (timer) return;
    if (!live) {
        logger.info("not the live bot: no automatic guild fetch (Jetzt abrufen still works)");
        return;
    }
    timer = setInterval(() => { runDue(); }, intervalMs);
    if (timer.unref) timer.unref();
}

function stopWclGuildSync() {
    if (timer) clearInterval(timer);
    timer = null;
}

function _resetForTests() {
    stopWclGuildSync();
    running = null;
    inFlight.clear();
    pausedSites.clear();
}

module.exports = {
    isDue, errorMessage, windowStart, fetchEntry, runDue, isFetching, startWclGuildSync, stopWclGuildSync,
    RATE_LIMIT_PAUSE_MS, FIRST_LOOKBACK_MS, LOOKBACK_MS, _resetForTests,
};
