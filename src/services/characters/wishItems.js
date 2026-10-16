// Wish items of a character ("Mein Profil", part 2; docs/roster-profile.md
// "Wunsch-Items"): up to ten items a raider would like, freely given, kept on
// the profile character (raiderProfileStore `wishItems`).
//
//   - Only for a character whose category runs as Loot-Council: the character
//     is listed for the raider in an OPEN roster of its own game version, and
//     that roster's loot system is "lootcouncil" (services/loot/lootSystem.js
//     rosterLootSystem - the category's setting). Elsewhere there is no block
//     and a save refuses the list.
//   - Only items of the character's version: a new item is looked up on that
//     version's Wowhead section (versionLinks().wowheadPath - none, or the
//     feature "Wowhead-Links" switched off, means no wish items); name, icon
//     and quality come from Wowhead, never from the request.
//   - Read only by the raider and the orga (profileView: the own profile, the
//     orga's views); not in "Drop prüfen" and not in the addon format yet.
const rosterStore = require("../../stores/rosterStore");
const { rosterLootSystem } = require("../loot/lootSystem");
const { versionLinks } = require("../events/versionSettings");
const wowhead = require("../../utils/loot/wowhead");
const { LEGACY_VERSION } = require("../../config/gameVersions");

const versionOf = (c) => (c && c.versionId) || LEGACY_VERSION;

/** The Wowhead path of a version's items, "" without one (or with the links switched off). */
function wowheadPathOf(versionId, { config } = {}) {
    const links = versionLinks(versionId, { config });
    return links.versionId === versionId ? links.wowheadPath : "";
}

/**
 * Whether `userId`'s `character` may keep wish items: listed for them in an
 * open roster of its version that runs as Loot-Council.
 * @param {string} userId
 * @param {{ key: string, versionId?: string }} character
 * @param {{ config?: object, rosters?: object[] }} [opts]
 */
function wishItemsAllowed(userId, character, { config = {}, rosters = rosterStore.listRosters() } = {}) {
    const uid = String(userId || "");
    if (!character || !uid) return false;
    const versionId = versionOf(character);
    return rosters.some((r) => r.versionId === versionId && !rosterStore.isClosed(r)
        && r.members[uid] && r.members[uid].chars.includes(character.key)
        && rosterLootSystem(config, r).system === "lootcouncil");
}

/** A stored wish item as the page shows it: with its icon and its Wowhead link of the version. */
function wishItemView(item, versionId, { config } = {}) {
    return {
        itemId: item.itemId,
        name: item.name,
        icon: item.icon,
        iconUrl: wowhead.iconUrl(item.icon),
        quality: item.quality,
        link: versionLinks(versionId, { config }).wowheadItem(item.itemId),
    };
}

/**
 * The list a save asks for, resolved: items already stored stay as they are,
 * a new one is looked up on the version's Wowhead (`lookup`, for tests). An id
 * Wowhead does not know there is refused.
 * @returns {Promise<{ items: object[] } | { error: string, code: string }>}
 */
async function resolveWishItems(character, ids, { config, lookup = wowhead.lookupItem } = {}) {
    const path = wowheadPathOf(versionOf(character), { config });
    if (!path) return { code: "no_wowhead", error: "Für diese Spielversion gibt es keine Wowhead-Suche - Wunsch-Items gehen hier nicht." };
    const stored = new Map((character.wishItems || []).map((w) => [w.itemId, w]));
    const items = [];
    for (const raw of ids) {
        const itemId = Number(raw && typeof raw === "object" ? raw.itemId : raw);
        if (!Number.isInteger(itemId) || itemId <= 0) return { code: "unknown_item", error: "Unbekanntes Item." };
        if (items.some((w) => w.itemId === itemId)) continue;
        if (stored.has(itemId)) { items.push(stored.get(itemId)); continue; }
        const hit = await lookup(itemId, { path });
        if (!hit || !hit.name) return { code: "unknown_item", error: `Item ${itemId} gibt es in dieser Spielversion nicht.` };
        items.push({ itemId, name: hit.name, icon: hit.icon || "", quality: hit.quality === undefined ? null : hit.quality });
    }
    return { items };
}

/** Wowhead's items for a name on a version's section: `[{ id, name, iconUrl, quality }]`, [] without a path. */
async function searchWishItems(versionId, text, { config, search = wowhead.searchItems } = {}) {
    const path = wowheadPathOf(versionId, { config });
    if (!path || String(text || "").trim().length < 2) return [];
    return search(String(text).slice(0, 80), { path, limit: 12 });
}

module.exports = { wishItemsAllowed, wishItemView, resolveWishItems, searchWishItems, wowheadPathOf };
