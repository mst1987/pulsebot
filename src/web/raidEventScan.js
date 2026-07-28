// Discovers Raid-Helper events that have already finished and snapshots them
// into raidEventStore, so the dashboard's "Latest Events" card keeps showing a
// raid once it has been seen — independent of Raid-Helper's own lookback window
// and of the bot's Discord channel cache. Runs both on-demand (every dashboard
// view, see server.js's loadRecentEvents) and on a background interval, so a
// finished raid shows up even if nobody opens the dashboard right after it ends.

const { createRaidhelperClient } = require("../utils/raidhelperClient");
const discord = require("./discord");
const { saveRaidEvents, getRaidEvent } = require("./raidEventStore");
const { RECENT_WINDOW_DAYS } = require("./recentEvents");

// A finished raid's raidplan costs one extra HTTP call, so only events without a
// setup snapshot are probed, and at most this many per scan — a backlog is worked
// off over a few sweeps instead of firing dozens of requests at once.
const MAX_SETUP_FETCHES_PER_SCAN = 3;

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
 * @returns {{ scanned: number, error: string|null }}
 */
async function scanRaidEvents(guildId, { windowDays = RECENT_WINDOW_DAYS } = {}) {
    if (!guildId) return { scanned: 0, error: null };
    try {
        const rh = createRaidhelperClient();
        const sinceSeconds = Math.floor(Date.now() / 1000) - windowDays * 86400;
        const events = await rh.getPastEvents(sinceSeconds);
        const catMap = discord.getChannelCategoryMap(guildId);
        const toSave = [];
        let setupFetches = 0;
        for (const ev of events || []) {
            const meta = catMap[ev.channelId];
            if (!meta) continue; // event channel not in this guild (or unknown to Discord)
            // Freeze the raidplan once; an event we already captured is never
            // re-fetched. saveRaidEvents keeps the stored setup when the incoming
            // one is empty, so passing nothing here is safe.
            let setup = [];
            const stored = getRaidEvent(ev.id);
            if (!(stored && (stored.setup || []).length) && setupFetches < MAX_SETUP_FETCHES_PER_SCAN) {
                setupFetches += 1;
                try {
                    const result = await rh.getSetup(ev.id);
                    setup = (result && result.setup) || [];
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
                signUps: (ev.signUps || []).map((s) => ({ userId: s.userId, specName: s.specName })),
                setup,
            });
        }
        saveRaidEvents(toSave);
        return { scanned: toSave.length, error: null };
    } catch (e) {
        return { scanned: 0, error: (e && e.message) || "Events konnten nicht gescannt werden (Raid-Helper API)." };
    }
}

/** Scan every guild the bot is currently a member of. Best-effort per guild. */
async function scanAllGuilds() {
    let scanned = 0;
    for (const g of discord.listGuilds()) {
        const result = await scanRaidEvents(g.id);
        if (result.error) console.error(`[raidEventScan] ${g.name || g.id}: ${result.error}`);
        scanned += result.scanned;
    }
    return scanned;
}

let timer = null;

/**
 * Start the periodic scan (idempotent). Scans once on boot, then on an
 * interval, so a finished raid is picked up even without anyone opening the
 * dashboard. The timer is unref'd so it never keeps the process alive on its own.
 */
function startRaidEventScan({ intervalMs = 5 * 60 * 1000 } = {}) {
    if (timer) return timer;
    const run = () => scanAllGuilds().catch((e) => console.error("[raidEventScan]", e.message));
    run();
    timer = setInterval(run, intervalMs);
    if (timer.unref) timer.unref();
    return timer;
}

module.exports = { scanRaidEvents, scanAllGuilds, startRaidEventScan };
