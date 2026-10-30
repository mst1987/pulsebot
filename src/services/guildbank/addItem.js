// Create a guild bank item by hand: the orga wants a waiting list for an
// item the bank does not hold, so it has no row in the stock yet (a row only
// appears with a scan). The input is an item id, a Wowhead link
// (".../item=32227/crimson-spinel") or a name; a name goes through Wowhead's
// search suggestions on the bank version's Wowhead path (the same endpoint the
// softres picker uses) and is taken when exactly one item has that name (or
// only one item is found), else the answer carries the hits to pick from.
//
//   parseQuery   the pure part: text -> { itemId } | { name } | null
//   search       Wowhead hits for a name on the bank's version
//   addByHand    store.addItem + the meta chain (local tables at once, then
//                the Wowhead lookup, awaited for a moment so the answer
//                already carries the name and icon)
const stockStore = require("../../stores/loot/guildBankStockStore");
const wowhead = require("../../utils/loot/wowhead");
const itemMeta = require("./itemMeta");
const stockView = require("./stockView");
const { foldName } = require("./waitlist");

/** How long an add waits for the Wowhead lookup before it answers without the name. */
const LOOKUP_WAIT_MS = 4000;
/** At most this many hits are offered. */
const SEARCH_LIMIT = 8;

/** An item id, a Wowhead link (item=<id>) or a name; null for nothing usable. */
function parseQuery(text) {
    const t = String(text === undefined || text === null ? "" : text).trim();
    if (!t) return null;
    if (/^\d{1,12}$/.test(t)) return { itemId: Number(t) };
    const link = /[?&/#]item[=/](\d{1,7})(?!\d)/i.exec(t);
    if (link && /wowhead\.com|^item=/i.test(t)) return { itemId: Number(link[1]) };
    if (/^item[=:](\d{1,7})$/i.test(t)) return { itemId: Number(/(\d+)/.exec(t)[1]) };
    if (/^https?:\/\//i.test(t)) return null;
    return { name: t.slice(0, 80) };
}

/** Wowhead's item hits for a name on a bank's version: `[{ id, name, icon, iconUrl, quality }]`. */
async function search(gameVersion, text) {
    return wowhead.searchItems(text, { path: itemMeta.wowheadPathFor(gameVersion), limit: SEARCH_LIMIT });
}

/** The one hit a name means: the single exact (folded) name, else the only hit; null otherwise. */
function pickHit(name, hits) {
    const key = foldName(name);
    const exact = hits.filter((h) => foldName(h.name) === key);
    if (exact.length === 1) return exact[0];
    if (!exact.length && hits.length === 1) return hits[0];
    return null;
}

const wait = (ms) => new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (t.unref) t.unref();
});

/**
 * Add an item to a bank by hand. `input` is `{ itemId }` or `{ query }` (id,
 * link or name). Returns `{ item, created }` (the page's item view),
 * `{ error }` (German) or `{ error, choices }` when a name fits several items.
 * @param {string} key
 * @param {{ itemId?: number, query?: string }} input
 */
async function addByHand(key, { itemId = 0, query = "" } = {}, { lookupWaitMs = LOOKUP_WAIT_MS } = {}) {
    const bank = stockStore.getBank(key);
    if (!bank) return { error: "Gildenbank nicht gefunden." };
    let id = Math.floor(Number(itemId) || 0);
    if (!id) {
        const parsed = parseQuery(query);
        if (!parsed) return { error: "Bitte eine Item-ID, einen Wowhead-Link oder einen Namen eingeben." };
        if (parsed.itemId) {
            id = parsed.itemId;
        } else {
            const hits = await search(bank.gameVersion, parsed.name);
            if (!hits.length) return { error: "Dazu hat Wowhead nichts gefunden. Die Item-ID oder den Link von Wowhead einfügen." };
            const hit = pickHit(parsed.name, hits);
            if (!hit) return { error: "Mehrere Treffer, bitte einen auswählen.", choices: hits };
            id = hit.id;
        }
    }
    const result = stockStore.addItem(key, id);
    if (result.error) return result;
    itemMeta.applyLocalMeta(bank.gameVersion, [id]);
    itemMeta.queueLookups(bank.gameVersion, [id]);
    if (lookupWaitMs > 0 && !stockStore.getBank(key).items.find((it) => it.itemId === id).name) {
        await Promise.race([itemMeta.idle(), wait(lookupWaitMs)]);
    }
    const fresh = stockStore.getBank(key).items.find((it) => it.itemId === id);
    return { item: stockView.itemForPage(key, fresh), created: result.created };
}

module.exports = { LOOKUP_WAIT_MS, SEARCH_LIMIT, parseQuery, search, pickHit, addByHand };
