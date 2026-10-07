// Names, icons, quality and item class for the guild bank stock
// (stores/guildBankStockStore.js). A scan only carries item ids.
//
// Item names are English everywhere (web page, Discord, the addon's hand-out
// list); only the group labels built from class/subclass stay German, mapped
// from the ids (config/itemClassLabels.js, services/guildbank/stockView.js).
//
// Two sources, in this order:
//   1. the local item tables (TBC only: WoWSims items, the raid loot names) —
//      synchronous, applied while the upload is stored; English names that
//      count as final (the item is still queued for the lookup, which brings
//      class and subclass; icon and quality stay when the answer lacks them),
//   2. one Wowhead lookup per item id and game version (English name, icon,
//      quality, class/subclass; utils/loot/wowhead.js lookupItemDetails) —
//      in the background, after the upload has been answered, one request at a
//      time with a pause between them. An item that has a Wowhead answer in
//      any bank of the version takes it from there (the store is the
//      persistent cache); a lookup that failed is not repeated for a while,
//      and every new scan queues the items still without an answer.
//
// German names stored before (#636, meta version 1) are stale: the store lists
// them as items without an answer, the local tables replace their name at once
// where they know the item, and the lookup brings the English rest. A sweep a
// little after the start (startMetaRefresh, web/http/jobs.js) does this for
// every bank; scans and the stock page queue the same items too. Whenever an
// item's name changes, the pending requests of it (open / confirmed) take the
// new name (guildBankStore.renamePendingItem); handled ones keep theirs.
//
// The ingest never waits for the network: queueLookups() returns at once.
const store = require("../../stores/guildBankStockStore");
const requestStore = require("../../stores/guildBankStore");
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
/** The language of the item names (Wowhead's locale). */
const NAME_LOCALE = "en";
/** When the start-up sweep for stale or missing meta runs. */
const REFRESH_DELAY_MS = 30 * 1000;

let gapMs = DEFAULT_GAP_MS;
const queue = [];
const queued = new Set();
const failedAt = new Map();
let running = null;
let refreshTimer = null;

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

/**
 * Store an item's meta in every bank of the version that has it, and give the
 * pending requests of the item its name. Returns how many banks changed.
 */
function writeMeta(versionId, itemId, meta, { source, now = Date.now() }) {
    const changed = store.setItemMeta(versionId, itemId, meta, { source, now });
    if (changed && meta && meta.name) {
        try {
            requestStore.renamePendingItem({ bankKeys: store.banksWithItem(versionId, itemId), itemId, name: meta.name });
        } catch (e) {
            logger.warn("renaming requests failed:", itemId, (e && e.message) || e);
        }
    }
    return changed;
}

/** Fill the items the local tables know (those without meta or with stale meta). Returns how many were filled. */
function applyLocalMeta(versionId, itemIds, { now = Date.now() } = {}) {
    let filled = 0;
    for (const id of itemIds || []) {
        const meta = localMeta(versionId, id);
        if (meta && writeMeta(versionId, id, meta, { source: "local", now })) filled += 1;
    }
    return filled;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveOne(versionId, itemId) {
    const key = `${versionId}:${itemId}`;
    const known = store.knownMeta(versionId, itemId);
    if (known) {
        writeMeta(versionId, itemId, known, { source: "wowhead" });
        return false;
    }
    const meta = await wowhead.lookupItemDetails(itemId, { path: wowheadPathFor(versionId), locale: NAME_LOCALE });
    if (meta && meta.name) {
        writeMeta(versionId, itemId, meta, { source: "wowhead" });
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

/**
 * Every bank's items without a current answer (none yet, a failed lookup, or
 * stale German meta): the local tables fill what they know at once, the rest
 * is queued for Wowhead. Returns `{ banks, items }` — how many were looked at.
 */
function refreshStaleMeta({ now = Date.now() } = {}) {
    let banks = 0;
    let items = 0;
    for (const bank of store.listBanks()) {
        const ids = store.itemsWithoutWowheadMeta(bank.key);
        if (!ids.length) continue;
        banks += 1;
        items += ids.length;
        applyLocalMeta(bank.gameVersion, ids, { now });
        queueLookups(bank.gameVersion, ids, { now });
    }
    if (items) logger.info(`item meta: ${items} items of ${banks} banks queued for a lookup`);
    return { banks, items };
}

/** Run refreshStaleMeta once, a little after the start (idempotent). */
function startMetaRefresh({ delayMs = REFRESH_DELAY_MS } = {}) {
    if (refreshTimer) return refreshTimer;
    refreshTimer = setTimeout(() => {
        try {
            refreshStaleMeta();
        } catch (e) {
            logger.warn("item meta refresh failed:", (e && e.message) || e);
        }
    }, delayMs);
    if (refreshTimer.unref) refreshTimer.unref();
    return refreshTimer;
}

/** Cancel a sweep that has not run yet (idempotent). */
function stopMetaRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
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
    stopMetaRefresh();
}

module.exports = {
    wowheadPathFor, localMeta, applyLocalMeta, queueLookups, refreshStaleMeta, startMetaRefresh, stopMetaRefresh,
    idle, configure, reset, RETRY_AFTER_MS, DEFAULT_GAP_MS, NAME_LOCALE,
};
