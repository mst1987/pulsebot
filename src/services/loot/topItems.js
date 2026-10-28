// The top items of a Discord server, per game version (#952):
//
//   config.serverSettings[guildId].topItems = {
//       tbc: [{ id, name, iconUrl, quality }], classic: [...], forever: [...]
//   }
//
// The items the server counts as a "big" drop. The loot views (dashboard
// "Neuer Loot"/"Top-Items", Historie "Neuester Loot") match an award by its
// item id against the list of the raid's server and version. Picked on
// System > Einstellungen > <Server> > Top-Items: a switch per boss item of the
// version's loot table, plus a Wowhead search for items no boss drops.
const { serverSetting } = require("../discord/serverSettings");
const { knownVersion } = require("../events/mainVersion");
const { normalizeTopItems } = require("../../stores/configSchema");

/** How many top items one version of one server may hold. */
const MAX_TOP_ITEMS = 500;

/**
 * A topItems block in its final shape: one list per known version, each
 * normalised like the old global list (positive ids, deduped, http(s) icons),
 * an unknown version or an empty list is dropped.
 * @param {*} raw
 * @returns {Object<string, {id:number, name:string, iconUrl:string, quality:number|null}[]>}
 */
function normalizeTopItemLists(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [key, list] of Object.entries(raw)) {
        const versionId = knownVersion(key);
        if (!versionId) continue;
        const items = normalizeTopItems(list).slice(0, MAX_TOP_ITEMS);
        if (items.length) out[versionId] = items;
    }
    return out;
}

/** Every list of one server (normalised; {} without any). */
function topItemListsOf(guildId, { config } = {}) {
    return normalizeTopItemLists(serverSetting(guildId, "topItems", { config }));
}

/** The top items of one server and version ([] without any). */
function topItemsOf(guildId, versionId, { config } = {}) {
    const v = knownVersion(versionId);
    if (!guildId || !v) return [];
    return topItemListsOf(guildId, { config })[v] || [];
}

/** The item ids of one server and version, as a Set. */
function topItemIds(guildId, versionId, { config } = {}) {
    return new Set(topItemsOf(guildId, versionId, { config }).map((it) => it.id));
}

/**
 * The lists with one item switched on or off for one version: on appends it
 * (a known id keeps its place), off removes it. Returns the normalised lists.
 * @param {object} lists
 * @param {string} versionId
 * @param {{id:number, name?:string, iconUrl?:string, quality?:number|null}} item
 * @param {boolean} on
 */
function withTopItem(lists, versionId, item, on) {
    const all = normalizeTopItemLists(lists);
    const v = knownVersion(versionId);
    const id = Number(item && item.id) || 0;
    if (!v || id <= 0) return all;
    const current = all[v] || [];
    const rest = current.filter((it) => it.id !== id);
    const next = on
        ? (current.some((it) => it.id === id) ? current : [...current, item])
        : rest;
    return normalizeTopItemLists({ ...all, [v]: next });
}

module.exports = { MAX_TOP_ITEMS, normalizeTopItemLists, topItemListsOf, topItemsOf, topItemIds, withTopItem };
