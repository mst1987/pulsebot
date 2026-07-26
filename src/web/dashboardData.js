// Data assembly shared by the dashboard's SSR route (server.js) and its JSON
// counterpart (apiRouter.js) — moved out of server.js so both can require it
// without a circular dependency (server.js requires apiRouter.js).
const { listRaidEvents } = require("./raidEventStore");
const { scanRaidEvents } = require("./raidEventScan");
const { listByEvent: listLootByEvent } = require("./lootStore");
const { getEventSheet } = require("./eventSheetStore");
const { getEventSoftres } = require("./eventSoftresStore");
const { listLogs } = require("./logStore");
const { buildRecentEvents, matchLogsForEvent } = require("./recentEvents");
const { logPostedAt } = require("./reportList");
const Raidhelper = require("../classes/raidhelper");
const discord = require("./discord");

// Find the next few upcoming events that already have a Raid-Helper setup
// (raidplan) built, annotated with whether their sheet was filled via the admin
// tool. Events without a setup are skipped. `getSetup` is one HTTP call per
// event, so `maxChecks` caps how deep we probe to keep the dashboard snappy.
async function loadUpcomingSetups(guildId, limit = 3, maxChecks = 8) {
    if (!guildId) return { events: [], error: null };
    try {
        const rh = new Raidhelper();
        const events = await rh.getAllEvents(); // sorted ascending by startTime
        const catMap = discord.getChannelCategoryMap(guildId);
        const inGuild = events.filter((ev) => catMap[ev.channelId]);
        const out = [];
        let checked = 0;
        for (const ev of inGuild) {
            if (out.length >= limit || checked >= maxChecks) break;
            checked += 1;
            const result = await rh.getSetup(ev.id);
            if (!result || !result.setup || !result.setup.length) continue;
            const meta = catMap[ev.channelId] || {};
            out.push({
                id: ev.id,
                title: ev.title,
                startTime: ev.startTime,
                channelId: ev.channelId,
                channelName: meta.name || "",
                signupCount: (ev.signUps || []).filter((s) => s.specName !== "Absence").length,
                playerCount: result.setup.filter((s) => s && s.name).length,
                sheet: getEventSheet(ev.id),
            });
        }
        return { events: out, error: null };
    } catch (e) {
        return { events: [], error: (e && e.message) || "Events konnten nicht geladen werden (Raid-Helper API)." };
    }
}

// Find the raids that already took place, annotated with everything the
// dashboard links to: their Warcraft-Logs (matched by post time, see
// recentEvents.js), the CLA evaluation of those logs, imported loot and the
// soft-reserve list.
//
// Reads from the locally persisted raidEventStore (see raidEventScan.js)
// instead of a live, windowed Raid-Helper call, so a raid stays listed once it
// has been scanned — even after Raid-Helper stops returning it or its channel
// is renamed/deleted. A scan runs first to pick up anything new since the last
// background sweep (every dashboard view is effectively an on-demand rescan);
// if that scan fails but the store already has events for this guild, they are
// shown regardless — only a guild with nothing stored yet surfaces the error.
async function loadRecentEvents(guildId, limit = 5) {
    if (!guildId) return { events: [], error: null };
    const { error: scanError } = await scanRaidEvents(guildId);
    const stored = listRaidEvents(guildId);
    // Only logs from this guild can belong to one of its raids.
    const logs = listLogs()
        .filter((l) => !l.guildId || l.guildId === guildId)
        .map((l) => ({ ...l, postedAt: logPostedAt(l) }));
    const recent = buildRecentEvents(stored, { logs, limit, windowDays: Infinity });
    return {
        events: recent.map((ev) => ({
            id: ev.id,
            title: ev.title,
            startTime: ev.startTime,
            channelId: ev.channelId,
            channelName: ev.channelName || "",
            categoryName: ev.categoryName || "",
            logs: ev.logs,
            lootCount: listLootByEvent(ev.id).length,
            softres: getEventSoftres(ev.id),
        })),
        error: stored.length ? null : scanError,
    };
}

// Annotate upcoming Raid-Helper events the same way loadRecentEvents() does for
// past ones (matched Warcraft-Logs, imported-loot count, softres list), so the
// History page's "Kommende Raids" table can use the same row rendering as
// "Vergangene Raids". Upcoming events don't go through the persisted
// raidEventStore — they come straight from the live Raid-Helper event list.
function annotateUpcomingExtras(events, guildId) {
    const logs = listLogs()
        .filter((l) => !l.guildId || l.guildId === guildId)
        .map((l) => ({ ...l, postedAt: logPostedAt(l) }));
    return (events || []).map((ev) => ({
        ...ev,
        logs: matchLogsForEvent(ev, logs),
        lootCount: listLootByEvent(ev.id).length,
        softres: getEventSoftres(ev.id),
    }));
}

module.exports = { loadUpcomingSetups, loadRecentEvents, annotateUpcomingExtras };
