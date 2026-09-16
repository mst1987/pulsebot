// The Raid-Events page's two lists — coming and past raids — in one row shape.
//
// Each row carries what the list draws beyond Raid-Helper's own fields: the raid
// content(s) it is (for the boss icon), the raid size the signup bar is measured
// against, and for a past raid its logs and loot as counts plus the few names a
// tooltip shows. Derived on every read, never stored.
const { contentsForText, CONTENTS } = require("../config/tbcContent");
const { instanceById } = require("../config/gameVersions");
const { listRaidEvents } = require("./raidEventStore");
const { scanRaidEvents } = require("./raidEventScan");
const { autoLinkLogs } = require("./logAutoLink");
const { listByEvent: listLootByEvent } = require("./lootStore");
const { getEventSoftres } = require("./eventSoftresStore");
const { listLogs } = require("./logStore");
const { logPostedAt } = require("./reportList");
const { buildRecentEvents, pendingLogsForEvent } = require("./recentEvents");

// The size a night is measured against when no content was recognised.
const DEFAULT_RAID_SIZE = 25;
const CONTENT_ORDER = CONTENTS.map((c) => c.id);

// A content counts as "looted there" only from this many items on: a single
// stray bank item handed out on a BT night must not paint a Karazhan icon on it.
const MIN_LOOT_ITEMS = 2;

/**
 * Which raid content(s) an event is. The title is what people write ("SSC + TK",
 * "Hyjal/BT"); a title naming nothing falls back to the category, then to the
 * channel name. For a past raid, what actually happened — the zone of its logs
 * and where its loot dropped — is added on top, since it is fact rather than
 * wording. Nothing recognised gives [] (no icon), never a guess.
 *
 * @param {object} input { title, categoryName, channelName, zones: string[], lootContentIds: string[] }
 * @returns {{ contentIds: string[], sources: string[] }} ids in tbcContent order;
 *   sources: which of "title" | "category" | "channel" | "logs" | "loot" contributed
 */
function raidContentIds(input = {}) {
    const hits = new Set();
    const sources = [];
    const add = (ids, source) => {
        if (!ids.length) return false;
        ids.forEach((id) => hits.add(id));
        if (!sources.includes(source)) sources.push(source);
        return true;
    };

    if (!add(contentsForText(input.title), "title") && !add(contentsForText(input.categoryName), "category")) {
        add(contentsForText(input.channelName), "channel");
    }

    for (const zone of input.zones || []) add(contentsForText(zone), "logs");

    const lootCounts = new Map();
    for (const id of input.lootContentIds || []) {
        if (id) lootCounts.set(id, (lootCounts.get(id) || 0) + 1);
    }
    add([...lootCounts].filter(([, n]) => n >= MIN_LOOT_ITEMS).map(([id]) => id), "loot");

    // Same order as contentsForText() — a night reads "Hyjal + BT", not "BT + Hyjal".
    const contentIds = CONTENT_ORDER.filter((id) => hits.has(id));
    return { contentIds, sources };
}

/**
 * How many players the signup bar is measured against: the largest raid size
 * among the night's contents, read from the game version rule set
 * (config/gameVersions) — "Kara" alone is 10, "Kara + Gruul" 25. `known` is false when no content
 * was recognised and 25 is only the default — the tooltip says so.
 * @param {string[]} contentIds
 * @returns {{ size: number, known: boolean }}
 */
function raidSize(contentIds) {
    const ids = contentIds || [];
    if (!ids.length) return { size: DEFAULT_RAID_SIZE, known: false };
    const sizes = ids.map((id) => instanceById(id)).filter(Boolean).map((i) => i.defaultSize);
    if (!sizes.length) return { size: DEFAULT_RAID_SIZE, known: false };
    return { size: Math.max(...sizes), known: true };
}

/** The few fields of a log a row shows (title in the tooltip, a link, evaluated or not). */
function trimLog(l) {
    return {
        title: l.title || "",
        reportId: l.reportId || "",
        link: l.link || "",
        status: l.status || "",
        reportUrl: l.reportUrl || "",
        reportRefId: l.reportRefId || "",
        zone: l.zone || "",
    };
}

function softresOf(eventId) {
    const s = getEventSoftres(eventId);
    return s && s.url ? { url: s.url } : null;
}

/**
 * The coming raids as flat rows, from loadEventGroups()'s groups.
 * @param {object[]} groups
 */
function upcomingRows(groups) {
    return (groups || []).flatMap((g) => (g.events || []).map((ev) => {
        const { contentIds, sources } = raidContentIds({
            title: ev.title, categoryName: g.categoryName, channelName: ev.channelName,
        });
        const size = raidSize(contentIds);
        return {
            id: ev.id,
            title: ev.title || "",
            startTime: ev.startTime || 0,
            channelId: ev.channelId || "",
            channelName: ev.channelName || "",
            categoryId: g.categoryId || "",
            categoryName: g.categoryName || "",
            signupCount: ev.signupCount || 0,
            contentIds,
            contentSources: sources,
            raidSize: size.size,
            raidSizeKnown: size.known,
            softres: softresOf(ev.id),
        };
    }));
}

/**
 * The raids that took place, newest first, from the persisted event snapshot —
 * the same source and the same scan/auto-link pass as the history page's
 * "Vergangene Raids" (dashboardData.loadRecentEvents), plus content, category
 * and the pending logs' names with the other raids each one would also fit.
 * @param {string} guildId
 * @param {{ now?: number }} [opts]
 */
async function loadPastRaids(guildId, opts = {}) {
    if (!guildId) return { events: [], error: null };
    const { error: scanError } = await scanRaidEvents(guildId);
    await autoLinkLogs(guildId);
    const stored = listRaidEvents(guildId);
    const logs = listLogs()
        .filter((l) => !l.guildId || l.guildId === guildId)
        .map((l) => ({ ...l, postedAt: logPostedAt(l) }));
    const recent = buildRecentEvents(stored, { logs, limit: Infinity, windowDays: Infinity, now: opts.now });

    const events = recent.map((ev) => {
        const loot = listLootByEvent(ev.id);
        const { contentIds, sources } = raidContentIds({
            title: ev.title,
            categoryName: ev.categoryName,
            channelName: ev.channelName,
            zones: ev.logs.map((l) => l.zone).filter(Boolean),
            lootContentIds: loot.map((it) => it.contentId),
        });
        return {
            id: ev.id,
            title: ev.title || "",
            startTime: ev.startTime || 0,
            channelId: ev.channelId || "",
            channelName: ev.channelName || "",
            categoryId: ev.categoryId || "",
            categoryName: ev.categoryName || "",
            contentIds,
            contentSources: sources,
            logs: ev.logs.map(trimLog),
            pendingLogs: ev.pendingLogs.map((l) => ({
                title: l.title || l.reportId || "",
                // The other raids this log fits time-wise — why it stayed unassigned.
                alsoFits: stored
                    .filter((other) => other.id !== ev.id && pendingLogsForEvent(other, [l]).length)
                    .map((other) => other.title || ""),
            })),
            pendingLogCount: ev.pendingLogs.length,
            lootCount: loot.length,
            softres: softresOf(ev.id),
        };
    });
    return { events, error: stored.length ? null : scanError };
}

module.exports = { raidContentIds, raidSize, upcomingRows, loadPastRaids, DEFAULT_RAID_SIZE, MIN_LOOT_ITEMS };
