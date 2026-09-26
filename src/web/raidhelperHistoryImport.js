// Import the last Raid-Helper signups as spec history (#291). When a guild moves
// its raids to the EventHelper's own events, the one-click signup and the profile
// suggestions start with nothing — every raider would have to pick their spec
// again. Raid-Helper already knows what each of them played, so for the last N
// Raid-Helper events per category every signup's className/specName is mapped to
// a rule-set spec key (eventSources.specKeyFromRaidHelper) and stored in
// specHistoryStore. No event is created or copied: the events stay Raid-Helper's.
//
// Split in two: `planImport()` is pure (events in, entries + summary out) and is
// what the dry run shows; `runImport()` collects the events, plans and — unless
// it is a dry run — stores. Idempotent per event (specHistoryStore).

const { specKeyFromRaidHelper } = require("./eventSources");
const specHistory = require("./specHistoryStore");
const { listRaidEvents } = require("./raidEventStore");
const { signupStatus } = require("../utils/attendance");
const { createRaidhelperClient } = require("../utils/raidhelper/client");
const discord = require("./discord");

const DEFAULT_PER_CATEGORY = 10;
const MAX_PER_CATEGORY = 50;
// How far back the live Raid-Helper list is asked (the snapshots reach further).
const LIVE_LOOKBACK_DAYS = 180;

/** 1…MAX_PER_CATEGORY, DEFAULT_PER_CATEGORY for anything unusable. */
function perCategoryOf(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) return DEFAULT_PER_CATEGORY;
    return Math.min(n, MAX_PER_CATEGORY);
}

/**
 * The plan: which events per category, which entries, what could not be read.
 * @param {object[]} events Raid-Helper events `{ id, title, startTime, categoryId,
 *   categoryName, signUps: [{ userId, className?, specName, status?, name? }] }`
 * @param {{ perCategory?: number, imported?: Set<string>, now?: number }} opts
 */
function planImport(events, { perCategory = DEFAULT_PER_CATEGORY, imported = new Set(), now = Date.now() } = {}) {
    const limit = perCategoryOf(perCategory);
    const nowSec = Math.floor(now / 1000);
    const byCategory = new Map();
    for (const ev of events || []) {
        if (!ev || !ev.id || String(ev.id).startsWith("eh-")) continue; // own events are not history to import
        if (!(Number(ev.startTime) > 0) || Number(ev.startTime) > nowSec) continue; // only raids that took place
        const key = String(ev.categoryId || "");
        if (!byCategory.has(key)) byCategory.set(key, { categoryId: key, categoryName: ev.categoryName || "", events: [] });
        const group = byCategory.get(key);
        if (!group.categoryName && ev.categoryName) group.categoryName = ev.categoryName;
        group.events.push(ev);
    }

    const entries = [];
    const eventIds = [];
    const users = new Set();
    const unmapped = {};
    let skippedEvents = 0;
    const categories = [];
    for (const group of byCategory.values()) {
        const picked = group.events.sort((a, b) => Number(b.startTime) - Number(a.startTime)).slice(0, limit);
        let groupEntries = 0;
        let groupSkipped = 0;
        for (const ev of picked) {
            const id = String(ev.id);
            if (imported.has(id)) {
                groupSkipped += 1;
                continue;
            }
            eventIds.push(id);
            const seen = new Set();
            for (const s of ev.signUps || []) {
                const userId = String((s && s.userId) || "");
                if (!userId || signupStatus(s) === "absence") continue;
                const spec = specKeyFromRaidHelper(s.className, s.specName);
                if (!spec) {
                    const name = String(s.specName || s.className || "?");
                    if (!["Bench", "Tentative", "Late"].includes(name)) unmapped[name] = (unmapped[name] || 0) + 1;
                    continue;
                }
                // Raid-Helper allows several reactions per person; one per spec per raid counts.
                if (seen.has(`${userId}|${spec}`)) continue;
                seen.add(`${userId}|${spec}`);
                entries.push({ userId, spec, eventId: id, at: Number(ev.startTime) * 1000, character: String(s.name || "") });
                users.add(userId);
                groupEntries += 1;
            }
        }
        skippedEvents += groupSkipped;
        categories.push({
            categoryId: group.categoryId,
            categoryName: group.categoryName || (group.categoryId ? "" : "Ohne Kategorie"),
            events: picked.length - groupSkipped,
            skipped: groupSkipped,
            entries: groupEntries,
            from: picked.length ? Number(picked[picked.length - 1].startTime) : 0,
            to: picked.length ? Number(picked[0].startTime) : 0,
        });
    }
    categories.sort((a, b) => (a.categoryName || a.categoryId).localeCompare(b.categoryName || b.categoryId));
    return {
        perCategory: limit,
        categories,
        eventIds,
        entries,
        summary: { events: eventIds.length, skippedEvents, entries: entries.length, users: users.size, unmapped },
    };
}

/**
 * Raid-Helper's past events of a guild: the snapshots raidEventScan.js took
 * (they reach back furthest, but only keep `specName`) merged with the live list
 * where Raid-Helper still answers (it carries `className` and the signup name).
 * A failing or switched-off Raid-Helper leaves the snapshots.
 * @returns {Promise<{ events: object[], liveError: string|null }>}
 */
async function collectRaidHelperEvents(guildId, { live = true, now = Date.now() } = {}) {
    const byId = new Map();
    for (const e of listRaidEvents(guildId)) byId.set(String(e.id), { ...e });
    let liveError = null;
    if (live) {
        try {
            const rh = createRaidhelperClient();
            if (!rh.disabled) {
                const since = Math.floor(now / 1000) - LIVE_LOOKBACK_DAYS * 86400;
                const catMap = (guildId && discord.getChannelCategoryMap(guildId)) || {};
                for (const ev of (await rh.getPastEvents(since)) || []) {
                    const id = String(ev.id);
                    const stored = byId.get(id);
                    const meta = catMap[ev.channelId];
                    if (!meta && !stored) continue; // not this guild's channel
                    byId.set(id, {
                        ...(stored || {}),
                        id,
                        title: ev.title || (stored && stored.title) || "",
                        startTime: Number(ev.startTime) || (stored && stored.startTime) || 0,
                        categoryId: meta ? meta.categoryId || "" : stored.categoryId || "",
                        categoryName: meta ? meta.categoryName || "" : stored.categoryName || "",
                        signUps: (ev.signUps || []).length ? ev.signUps : ((stored && stored.signUps) || []),
                    });
                }
            }
        } catch (e) {
            liveError = (e && e.message) || "Raid-Helper nicht erreichbar.";
        }
    }
    return { events: [...byId.values()], liveError };
}

/**
 * Collect, plan and (unless `dryRun`) store.
 * @returns {Promise<object>} the plan's `categories` and `summary`, `dryRun`,
 *   `stored` ({ events, entries, users } or null) and `liveError`.
 */
async function runImport({ guildId, perCategory, dryRun = true, byName = "", live = true, now = Date.now() } = {}) {
    const { events, liveError } = await collectRaidHelperEvents(guildId, { live, now });
    const plan = planImport(events, { perCategory, imported: specHistory.importedEventIds(), now });
    const stored = dryRun ? null : specHistory.applyImport(plan.entries, { eventIds: plan.eventIds, byName, now });
    return {
        dryRun: !!dryRun,
        perCategory: plan.perCategory,
        categories: plan.categories,
        summary: plan.summary,
        stored,
        liveError,
        status: specHistory.importStatus(),
    };
}

module.exports = { planImport, collectRaidHelperEvents, runImport, perCategoryOf, DEFAULT_PER_CATEGORY, MAX_PER_CATEGORY };
