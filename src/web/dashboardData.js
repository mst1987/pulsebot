// Data assembly shared by the dashboard's SSR route (server.js) and its JSON
// counterpart (apiRouter.js) — moved out of server.js so both can require it
// without a circular dependency (server.js requires apiRouter.js).
const { listRaidEvents } = require("./raidEventStore");
const { scanRaidEvents } = require("./raidEventScan");
const { listByEvent: listLootByEvent, listAll: listAllLoot, charLootPreview } = require("./lootStore");
const { getConfig } = require("./settingsStore");
const { getEventSheet } = require("./eventSheetStore");
const { getEventSoftres } = require("./eventSoftresStore");
const { listLogs } = require("./logStore");
const { buildRecentEvents, matchLogsForEvent, pendingLogsForEvent } = require("./recentEvents");
const { autoLinkLogs } = require("./logAutoLink");
const { logPostedAt } = require("./reportList");
const { characterMap } = require("./characterStore");
const { characterProfile } = require("../utils/setupView");
const { createRaidhelperClient } = require("../utils/raidhelperClient");
const discord = require("./discord");

// Find the next few upcoming events that already have a Raid-Helper setup
// (raidplan) built, annotated with whether their sheet was filled via the admin
// tool. Events without a setup are skipped. `getSetup` is one HTTP call per
// event, so `maxChecks` caps how deep we probe to keep the dashboard snappy.
async function loadUpcomingSetups(guildId, limit = 3, maxChecks = 8) {
    if (!guildId) return { events: [], error: null };
    try {
        const rh = createRaidhelperClient();
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
// dashboard links to: their Warcraft-Logs (the ones assigned to them, see
// logAutoLink.js/recentEvents.js), the CLA evaluation of those logs, imported
// loot and the soft-reserve list.
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
    // Assign freshly detected logs to their raid before reading them back, so a
    // log posted since the last sweep already shows up under its event here (and,
    // because the assignment is persisted, on that event's detail page too).
    await autoLinkLogs(guildId);
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
            pendingLogCount: ev.pendingLogs.length,
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
        pendingLogCount: pendingLogsForEvent(ev, logs).length,
        lootCount: listLootByEvent(ev.id).length,
        softres: getEventSoftres(ev.id),
    }));
}

/**
 * The most recently awarded *top items* — the drops the guild flagged as big in
 * Einstellungen → Loot (config.topItems), matched against imported loot by item
 * id. Newest award first, capped at `limit`.
 *
 * Matching is by id only: the name on a loot row comes from whatever the export
 * (or the Wowhead backfill) produced and may be missing entirely, the id never
 * is. `configured` is how many top items are defined at all, so the dashboard
 * can tell "nothing configured yet" from "configured, but none dropped yet".
 *
 * Every row carries the winner's class/spec look (colour + spec icon) from the
 * character store — resolved server-side like every other class colour in the
 * app (see ClassSpec.tsx), so the client never owns a second palette. A
 * character whose class nobody has resolved yet simply has empty fields and
 * renders uncoloured.
 *
 * Not guild-scoped: imported loot carries no guild id (see lootStore.js), the
 * same reason the Historie pages show it unfiltered.
 */
function loadTopLoot(limit = 5) {
    const topItems = getConfig().topItems || [];
    const ids = new Set(topItems.map((it) => Number(it.id)).filter(Boolean));
    if (!ids.size) return { items: [], configured: 0 };
    const awards = listAllLoot().filter((it) => ids.has(Number(it.itemId))).slice(0, limit);
    if (!awards.length) return { items: [], configured: ids.size };
    const known = characterMap();
    return {
        items: awards.map((it) => {
            const info = known[it.characterKey] || null;
            const look = info ? characterProfile(info.className, info.spec) : null;
            return {
                // charLootPreview() is the trimmed loot shape the history pages
                // already use; the dashboard row adds who won it and how they play.
                ...charLootPreview(it),
                character: it.character,
                realm: it.realm || "",
                boss: it.boss || "",
                className: (look && look.className) || "",
                spec: (info && info.spec) || "",
                classColor: (look && look.classColor) || "",
                specIconUrl: (look && look.iconUrl) || "",
            };
        }),
        configured: ids.size,
    };
}

module.exports = { loadUpcomingSetups, loadRecentEvents, annotateUpcomingExtras, loadTopLoot };
