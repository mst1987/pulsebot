// Names, icons, quality and item class for the guild bank stock
// (stores/guildBankStockStore.js). A scan only carries item ids.
//
// Two sources, in this order:
//   1. the local item tables (TBC only: WoWSims items, the raid loot names) —
//      synchronous, applied while the upload is stored; English names, which
//      only stand in until Wowhead answered (an item with local data is still
//      queued for the lookup, and the German answer replaces the name; icon
//      and quality stay when the answer lacks them),
//   2. one Wowhead lookup per item id and game version (German name, icon,
//      quality, class/subclass; utils/loot/wowhead.js lookupItemDetails) —
//      in the background, after the upload has been answered, one request at a
//      time with a pause between them. An item that has a Wowhead answer in
//      any bank of the version takes it from there (the store is the
//      persistent cache); a lookup that failed is not repeated for a while,
//      and every new scan queues the items still without an answer.
//
// The ingest never waits for the network: queueLookups() returns at once.
const store = require("../../stores/guildBankStockStore");
const wowhead = require("../../utils/loot/wowhead");
const wowsims = require("../../config/wowsims");
const { itemMeta: raidItemMeta } = require("../../config/tbcLootNames");
const { settingsForVersion } = require("../events/versionSettings");
const logger = require("../../logger").child("guildbank");

// The Wowhead path of a version without its own setting (#542): Forever has
// Classic's items until it gets a branch of its own.
const FALLBACK_PATH = { tbc: "tbc", classic: "classic", forever: "classic" };
/** Pause between two Wowhead requests. */
const DEFAULT_GAP_MS = 400;
/** How long a failed lookup is not tried again. */
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

let gapMs = DEFAULT_GAP_MS;
const queue = [];
const queued = new Set();
const failedAt = new Map();
let running = null;

/** The Wowhead path an item of a version is looked up on. */
function wowheadPathFor(versionId) {
    try {
        const settings = settingsForVersion(versionId);
        if (settings.versionId === versionId && settings.wowheadPath) return settings.wowheadPath;
    } catch {
        // no settings readable: the fallback below
    }
    return FALLBACK_PATH[versionId] || "tbc";
}

/** `{ name, icon, quality }` from the local tables, or null. Only TBC has them. */
function localMeta(versionId, itemId) {
    if (versionId !== "tbc") return null;
    const sim = wowsims.item(itemId);
    if (sim && sim.name) return { name: sim.name, icon: sim.icon || "", quality: typeof sim.quality === "number" ? sim.quality : null };
    const raid = raidItemMeta(itemId);
    if (raid && raid[0]) return { name: raid[0], icon: raid[1] || "", quality: typeof raid[2] === "number" ? raid[2] : null };
    return null;
}

/** Fill the items the local tables know (only those without any meta). Returns how many were filled. */
function applyLocalMeta(versionId, itemIds, { now = Date.now() } = {}) {
    let filled = 0;
    for (const id of itemIds || []) {
        const meta = localMeta(versionId, id);
        if (meta && store.setItemMeta(versionId, id, meta, { source: "local", now })) filled += 1;
    }
    return filled;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveOne(versionId, itemId) {
    const key = `${versionId}:${itemId}`;
    const known = store.knownMeta(versionId, itemId);
    if (known) {
        store.setItemMeta(versionId, itemId, known, { source: "wowhead" });
        return false;
    }
    const meta = await wowhead.lookupItemDetails(itemId, { path: wowheadPathFor(versionId), locale: "de" });
    if (meta && meta.name) {
        store.setItemMeta(versionId, itemId, meta, { source: "wowhead" });
        failedAt.delete(key);
    } else {
        failedAt.set(key, Date.now());
    }
    return true;
}

async function work() {
    while (queue.length) {
        const { versionId, itemId } = queue.shift();
        let asked = false;
        try {
            asked = await resolveOne(versionId, itemId);
        } catch (e) {
            failedAt.set(`${versionId}:${itemId}`, Date.now());
            logger.warn("item lookup failed:", itemId, (e && e.message) || e);
        } finally {
            queued.delete(`${versionId}:${itemId}`);
        }
        if (asked && queue.length && gapMs > 0) await sleep(gapMs);
    }
}

/**
 * Queue Wowhead lookups for items of a version; returns at once with how many
 * are waiting. Items already queued, or failed less than RETRY_AFTER_MS ago,
 * are skipped.
 */
function queueLookups(versionId, itemIds, { now = Date.now() } = {}) {
    for (const raw of itemIds || []) {
        const itemId = Number(raw) || 0;
        if (!itemId) continue;
        const key = `${versionId}:${itemId}`;
        if (queued.has(key)) continue;
        const failed = failedAt.get(key);
        if (failed && now - failed < RETRY_AFTER_MS) continue;
        queued.add(key);
        queue.push({ versionId, itemId });
    }
    if (!running && queue.length) {
        running = work().finally(() => {
            running = null;
        });
    }
    return queue.length;
}

/** Resolves when the queue is empty (tests, a clean shutdown). */
function idle() {
    return running || Promise.resolve();
}

/** Tests: the pause between requests, and a clean slate. */
function configure({ gap } = {}) {
    if (gap !== undefined) gapMs = Math.max(0, Number(gap) || 0);
}

function reset() {
    queue.length = 0;
    queued.clear();
    failedAt.clear();
    gapMs = DEFAULT_GAP_MS;
}

module.exports = {
    wowheadPathFor, localMeta, applyLocalMeta, queueLookups, idle, configure, reset,
    RETRY_AFTER_MS, DEFAULT_GAP_MS,
};
