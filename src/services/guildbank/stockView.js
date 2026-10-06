// The guild bank stock as the orga's page (#632) and the request form (#633)
// read it: a bank's items with what is set aside and what is left, grouped.
//
//   count      the stock in the bank's visible tabs, `tabs` per visible tab (a
//              hidden tab's stock is not offered; totalCount and allTabs keep
//              everything, tabHidden = the whole stock lies in hidden tabs)
//   reserved   the confirmed requests of the item (reservations.js)
//   handedOut  handed out after the last scan (reservations.handedOutSince): still
//              in the stored stock, no longer in the bank
//   available  max(0, count - reserved - handedOut - reserve) — what a raider may still ask for
//   group      the line the item is listed under: the orga's own category,
//              else Wowhead's class (gems, recipes) or subclass (consumables,
//              trade goods: "Fläschchen", "Stoff"), "" when Wowhead has not
//              answered yet; autoGroup = Wowhead's alone
const stockStore = require("../../stores/guildBankStockStore");
const { reservedByItem, handedOutSince, reservedRequestCount } = require("./reservations");
const { wowheadPathFor } = require("./itemMeta");
const { rulesFor } = require("../../config/gameVersions");

// Item classes whose subclass is the useful group (Wowhead's ids): consumables
// (flasks, elixirs, potions) and trade goods (cloth, leather, metal, herbs).
const BY_SUBCLASS = new Set([0, 7]);

/** The group an item is listed under. */
function itemGroup(item) {
    const it = item || {};
    if (it.category) return it.category;
    if (BY_SUBCLASS.has(it.classId)) return it.subclassName || it.className || "";
    return it.className || it.subclassName || "";
}

/** What is left of an item for requests. */
function availableOf(count, reserved, reserve) {
    return Math.max(0, (Number(count) || 0) - (Number(reserved) || 0) - (Number(reserve) || 0));
}

/** The indexes of a bank's hidden tabs. */
function hiddenTabsOf(bank) {
    return new Set(((bank && bank.tabs) || []).filter((t) => t.hidden).map((t) => String(t.index)));
}

/**
 * One item view (guildBankStockStore itemView) with reserved, available and
 * group. A hidden bank tab's stock does not count: `count` and `tabs` are the
 * visible tabs only (`totalCount` keeps everything), and an item whose whole
 * stock lies in hidden tabs is `tabHidden` — the page leaves it out, nobody
 * can ask for it.
 */
function withAvailability(item, reserved = {}, hiddenTabs = new Set(), handedOut = {}) {
    const tabs = {};
    let count = 0;
    for (const [index, n] of Object.entries(item.tabs || {})) {
        if (hiddenTabs.has(String(index))) continue;
        tabs[index] = n;
        count += Number(n) || 0;
    }
    const totalCount = Number(item.count) || 0;
    const onlyHidden = totalCount > 0 && Object.keys(item.tabs || {}).length > 0 && count === 0;
    const visibleCount = Object.keys(item.tabs || {}).length ? count : totalCount;
    const r = Number(reserved[item.itemId]) || 0;
    const out = Number(handedOut[item.itemId]) || 0;
    return {
        ...item,
        count: visibleCount,
        totalCount,
        allTabs: { ...(item.tabs || {}) },
        tabs,
        tabHidden: onlyHidden,
        reserved: r,
        handedOut: out,
        available: availableOf(visibleCount, r + out, item.reserve),
        group: itemGroup(item),
        autoGroup: itemGroup({ ...item, category: "" }),
    };
}

/** The short name of a game version ("TBC"), the id itself for an unknown one. */
function versionShort(versionId) {
    const rules = rulesFor(versionId);
    return (rules && rules.short) || String(versionId || "").toUpperCase();
}

/** A bank summary for the page's selector. */
function summary(bank) {
    return {
        key: bank.key, gameVersion: bank.gameVersion, versionShort: versionShort(bank.gameVersion),
        realm: bank.realm, guild: bank.guild, scannedAt: bank.scannedAt,
    };
}

/**
 * The banks of a Discord server and the one the page shows: the one asked for
 * by `key`, else the first of the content version `versionId`, else the first.
 * @param {string} guildId
 * @param {{ key?: string, versionId?: string }} [opts]
 * @returns {{ banks: object[], bank: object|null }}
 */
function stockForServer(guildId, { key = "", versionId = "" } = {}) {
    const all = stockStore.listForServer(guildId);
    const chosen = all.find((b) => key && b.key === key)
        || all.find((b) => versionId && b.gameVersion === versionId)
        || all[0]
        || null;
    if (!chosen) return { banks: [], bank: null };
    const reserved = reservedByItem(chosen.key);
    const out = handedOutSince(chosen.key, chosen.scannedAt);
    const hidden = hiddenTabsOf(chosen);
    const bank = {
        ...chosen,
        versionShort: versionShort(chosen.gameVersion),
        wowheadPath: wowheadPathFor(chosen.gameVersion),
        reservedRequests: reservedRequestCount(chosen.key),
        items: chosen.items.map((it) => withAvailability(it, reserved, hidden, out)),
    };
    return { banks: all.map(summary), bank };
}

/** One item of a bank with reserved/available/group, or null. */
function itemForPage(bankKey, item) {
    if (!item) return null;
    const bank = stockStore.getBank(bankKey);
    return withAvailability(item, reservedByItem(bankKey), hiddenTabsOf(bank), handedOutSince(bankKey, bank && bank.scannedAt));
}

/** One item of a bank by id with reserved/available/group — what the request form and the orga card read — or null. */
function stockItem(bankKey, itemId) {
    const bank = stockStore.getBank(bankKey);
    const item = bank ? bank.items.find((it) => it.itemId === Number(itemId)) : null;
    return item ? withAvailability(item, reservedByItem(bankKey), hiddenTabsOf(bank), handedOutSince(bankKey, bank.scannedAt)) : null;
}

/** Whether a raider may ask for an item now: offered ("give"), not only in hidden tabs, something left. */
const isOfferable = (item) => !!item && item.status === "give" && !item.tabHidden && item.available > 0;

/**
 * What a raider of a Discord server may ask for: the server's bank of
 * `versionId` (else its first, like the page) and its offerable items in
 * groups — by group name, the items without a group last, each group by item
 * name. `{ bank: null, groups: [] }` without a bank.
 * @returns {{ bank: object|null, groups: { name: string, items: object[] }[] }}
 */
function offerForServer(guildId, { versionId = "" } = {}) {
    const { bank } = stockForServer(guildId, { versionId });
    if (!bank) return { bank: null, groups: [] };
    const byGroup = new Map();
    for (const item of bank.items.filter(isOfferable)) {
        const name = item.group || "";
        if (!byGroup.has(name)) byGroup.set(name, []);
        byGroup.get(name).push(item);
    }
    const groups = [...byGroup.entries()]
        .sort(([a], [b]) => (Boolean(a) !== Boolean(b) ? (a ? -1 : 1) : a.localeCompare(b, "de")))
        .map(([name, items]) => ({ name, items }));
    return { bank, groups };
}

/** Whether a bank belongs to the given Discord server. */
function bankOfServer(key, guildId) {
    const id = String(guildId || "").trim();
    if (!id) return null;
    const bank = stockStore.getBank(key);
    return bank && bank.guildId === id ? bank : null;
}

module.exports = {
    itemGroup, availableOf, withAvailability, hiddenTabsOf, versionShort, stockForServer, itemForPage, stockItem, isOfferable,
    offerForServer, bankOfServer,
};
