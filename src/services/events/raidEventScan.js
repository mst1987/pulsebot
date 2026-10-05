// Discovers Raid-Helper events that have already finished and snapshots them
// into raidEventStore, so the dashboard's "Latest Events" card keeps showing a
// raid once it has been seen — independent of Raid-Helper's own lookback window
// and of the bot's Discord channel cache. Runs both on-demand (every dashboard
// view, see server.js's loadRecentEvents) and after every sync of the event
// list (raidhelperSync.js), so a finished raid shows up even if nobody opens
// the dashboard right after it ends. The event list comes from the synced
// store and costs no request; only the raidplan probe below asks Raid-Helper,
// and only from the sync (or a background job), never from a page view.

const { createRaidhelperClient, raidhelperDisabled } = require("../../utils/raidhelper/client");
const { isBackground } = require("../../utils/raidhelper/budget");
const discord = require("../discord/discord");
const { saveRaidEvents, getRaidEvent } = require("../../stores/raidEventStore");
const { RECENT_WINDOW_DAYS } = require("./recentEvents");
const { signupStatus } = require("../../utils/attendance");

// A finished raid's raidplan costs one extra HTTP call, so only events without a
// setup snapshot are probed, and at most this many per scan — a backlog is worked
// off over a few sweeps instead of firing dozens of requests at once.
const MAX_SETUP_FETCHES_PER_SCAN = 3;

// A raid without any raidplan answers "no setup" every time; without a memory
// of that it was probed again on every scan, for three weeks per raid. It is
// probed again only after this long (1000 requests a day, utils/raidhelper/budget.js).
const SETUP_REPROBE_MS = 6 * 60 * 60 * 1000;
const probedAt = new Map(); // event id -> ms of the last probe that found no setup

/**
 * Scan one guild's recently finished events and upsert them into the store.
 * Best-effort: a Raid-Helper failure is reported, never thrown, so neither the
 * dashboard request nor the background timer ever crash on it.
 *
 * Besides the event meta this captures the state that only exists WHILE
 * Raid-Helper still knows the event: its signup roster and its raidplan. Both
 * vanish from Raid-Helper's answers some time after the raid, and without a
 * snapshot a past raid's detail page falls back to "0 Anmeldungen" and counts
 * every expected raider as missing.
 *
 * `probeSetups` (default: only inside a background job) lets the scan ask
 * Raid-Helper for missing raidplans; a page view only stores what the synced
 * list already carries.
 * @returns {{ scanned: number, error: string|null }}
 */
async function scanRaidEvents(guildId, { windowDays = RECENT_WINDOW_DAYS, probeSetups = isBackground() } = {}) {
    if (!guildId) return { scanned: 0, error: null };
    // Switched off (#291): nothing is asked, the stored snapshots stay as they are.
    if (raidhelperDisabled()) return { scanned: 0, error: null, disabled: true };
    try {
        const rh = createRaidhelperClient();
        const sinceSeconds = Math.floor(Date.now() / 1000) - windowDays * 86400;
        const events = await rh.getPastEvents(sinceSeconds);
        const catMap = discord.getChannelCategoryMap(guildId);
        const toSave = [];
        const now = Date.now();
        let setupFetches = probeSetups ? 0 : MAX_SETUP_FETCHES_PER_SCAN;
        for (const ev of events || []) {
            const meta = catMap[ev.channelId];
            if (!meta) continue; // event channel not in this guild (or unknown to Discord)
            // Freeze the raidplan once; an event we already captured is never
            // re-fetched. saveRaidEvents keeps the stored setup when the incoming
            // one is empty, so passing nothing here is safe.
            let setup = [];
            const stored = getRaidEvent(ev.id);
            const recentlyProbed = now - (probedAt.get(ev.id) || 0) < SETUP_REPROBE_MS;
            if (!(stored && (stored.setup || []).length) && !recentlyProbed && setupFetches < MAX_SETUP_FETCHES_PER_SCAN) {
                setupFetches += 1;
                try {
                    const result = await rh.getSetup(ev.id);
                    setup = (result && result.setup) || [];
                    if (setup.length) probedAt.delete(ev.id);
                    else probedAt.set(ev.id, now);
                } catch {
                    // raidplan gone / API hiccup — retried on a later sweep
                }
            }
            toSave.push({
                id: ev.id,
                guildId,
                title: ev.title,
                channelId: ev.channelId,
                channelName: meta.name || "",
                categoryId: meta.categoryId || "",
                categoryName: meta.categoryName || "",
                startTime: ev.startTime,
                // The normalised status is kept alongside the spec: Raid-Helper
                // expresses a bench/absence through fields this reduction drops,
                // so deriving it later from `specName` alone would lose it.
                signUps: (ev.signUps || []).map((s) => ({
                    userId: s.userId, specName: s.specName, status: signupStatus(s),
                })),
                setup,
            });
        }
        saveRaidEvents(toSave);
        return { scanned: toSave.length, error: null };
    } catch (e) {
        return { scanned: 0, error: (e && e.message) || "Events konnten nicht gescannt werden (Raid-Helper API)." };
    }
}

/**
 * Scan every guild the bot is currently a member of. Best-effort per guild.
 * raidhelperSync.js calls it after each sync, with `probeSetups`.
 */
async function scanAllGuilds(opts = {}) {
    let scanned = 0;
    for (const g of discord.listGuilds()) {
        const result = await scanRaidEvents(g.id, opts);
        if (result.error) console.error(`[raidEventScan] ${g.name || g.id}: ${result.error}`);
        scanned += result.scanned;
    }
    return scanned;
}

/** Test-only: forget which raids were probed without a setup. */
function _resetProbesForTests() {
    probedAt.clear();
}

module.exports = { scanRaidEvents, scanAllGuilds, _resetProbesForTests };
