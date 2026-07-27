// Discovers Raid-Helper events that have already finished and snapshots them
// into raidEventStore, so the dashboard's "Latest Events" card keeps showing a
// raid once it has been seen — independent of Raid-Helper's own lookback window
// and of the bot's Discord channel cache. Runs both on-demand (every dashboard
// view, see server.js's loadRecentEvents) and on a background interval, so a
// finished raid shows up even if nobody opens the dashboard right after it ends.

const { createRaidhelperClient } = require("../utils/raidhelperClient");
const discord = require("./discord");
const { saveRaidEvents } = require("./raidEventStore");
const { RECENT_WINDOW_DAYS } = require("./recentEvents");

/**
 * Scan one guild's recently finished events and upsert them into the store.
 * Best-effort: a Raid-Helper failure is reported, never thrown, so neither the
 * dashboard request nor the background timer ever crash on it.
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
        for (const ev of events || []) {
            const meta = catMap[ev.channelId];
            if (!meta) continue; // event channel not in this guild (or unknown to Discord)
            toSave.push({
                id: ev.id,
                guildId,
                title: ev.title,
                channelId: ev.channelId,
                channelName: meta.name || "",
                categoryId: meta.categoryId || "",
                categoryName: meta.categoryName || "",
                startTime: ev.startTime,
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
