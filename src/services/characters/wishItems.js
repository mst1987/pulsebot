// Wish items of a character ("Mein Profil", part 2; docs/roster-profile.md
// "Wunsch-Items"): up to ten items a raider would like, freely given, kept on
// the profile character (raiderProfileStore `wishItems`).
//
//   - New items only for a character whose category runs as Loot-Council: the
//     character is listed for the raider in an OPEN roster of its own game
//     version, and that roster's loot system is "lootcouncil"
//     (services/loot/lootSystem.js rosterLootSystem - the category's setting).
//     Items stored before the character left such a roster (or the system
//     changed) stay: the raider reads them and may take them out, never adds.
//   - Only items of the character's version: a new item is looked up on that
//     version's Wowhead section (versionLinks().wowheadPath - none, or the
//     feature "Wowhead-Links" switched off, means no wish items); name, icon
//     and quality come from Wowhead, never from the request.
//   - Read only by the raider and the orga (profileView: the own profile, the
//     orga's views); not in "Drop prüfen" and not in the addon format yet.
const rosterStore = require("../../stores/roster/rosterStore");
const { rosterLootSystem } = require("../loot/lootSystem");
const { versionLinks } = require("../versions/versionSettings");
const wowhead = require("../../utils/loot/wowhead");
const { LEGACY_VERSION } = require("../../config/gameVersions");
const { MAX_WISH_ITEMS } = require("../../stores/roster/raiderProfileStore");

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
 * The list a save asks for, resolved - `{ items }` or `{ status, code, error }`:
 *
 *   - the ids are read and each kept once (an id that is no item: 400
 *     `unknown_item`); more than MAX_WISH_ITEMS after that: 400 `too_many`;
 *   - only stored items (taking some out, reordering, an empty list): always
 *     allowed, without the Loot-Council check and without Wowhead - so a raider
 *     who left the Loot-Council roster can still clear what they had;
 *   - a NEW item needs the Loot-Council roster (403 `not_loot_council`) and the
 *     version's Wowhead (400 `no_wowhead` without a path): it is looked up there,
 *     name, icon and quality come from Wowhead; an id Wowhead does not know is
 *     400 `unknown_item`, Wowhead not answering 502 `wowhead_unavailable`.
 *
 * `lookup(itemId, { path, strict: true })` resolves null for an unknown item and
 * throws when Wowhead cannot be asked (utils/loot/wowhead.js lookupItem).
 */
async function resolveWishItems(userId, character, requested, { config, lookup = wowhead.lookupItem, rosters } = {}) {
    const ids = [];
    for (const raw of Array.isArray(requested) ? requested : []) {
        const itemId = Number(raw && typeof raw === "object" ? raw.itemId : raw);
        if (!Number.isInteger(itemId) || itemId <= 0) return { status: 400, code: "unknown_item", error: "Unbekanntes Item." };
        if (!ids.includes(itemId)) ids.push(itemId);
    }
    if (ids.length > MAX_WISH_ITEMS) return { status: 400, code: "too_many", error: `Höchstens ${MAX_WISH_ITEMS} Wunsch-Items je Charakter.` };
    const stored = new Map((character.wishItems || []).map((w) => [w.itemId, w]));
    const fresh = ids.filter((id) => !stored.has(id));
    if (fresh.length) {
        if (!wishItemsAllowed(userId, character, { config, ...(rosters ? { rosters } : {}) })) {
            return { status: 403, code: "not_loot_council", error: "Neue Wunsch-Items gibt es nur für Charaktere in einem Loot-Council-Roster." };
        }
        const path = wowheadPathOf(versionOf(character), { config });
        if (!path) return { status: 400, code: "no_wowhead", error: "Für diese Spielversion gibt es keine Wowhead-Suche - neue Wunsch-Items gehen hier nicht." };
        for (const itemId of fresh) {
            let hit;
            try {
                hit = await lookup(itemId, { path, strict: true });
            } catch {
                return { status: 502, code: "wowhead_unavailable", error: "Wowhead antwortet gerade nicht - bitte gleich noch einmal versuchen." };
            }
            if (!hit || !hit.name) return { status: 400, code: "unknown_item", error: `Item ${itemId} gibt es in dieser Spielversion nicht.` };
            stored.set(itemId, { itemId, name: hit.name, icon: hit.icon || "", quality: hit.quality === undefined ? null : hit.quality });
        }
    }
    return { items: ids.map((id) => stored.get(id)) };
}

/** Whether any of the raider's characters of a version may get new wish items (the item search answers only then). */
function anyWishItemsAllowed(userId, characters, versionId, { config } = {}) {
    const rosters = rosterStore.listRosters();
    return (characters || []).some((c) => versionOf(c) === versionId && wishItemsAllowed(userId, c, { config, rosters }));
}

/** Wowhead's items for a name on a version's section: `[{ id, name, iconUrl, quality }]`, [] without a path. */
async function searchWishItems(versionId, text, { config, search = wowhead.searchItems } = {}) {
    const path = wowheadPathOf(versionId, { config });
    if (!path || String(text || "").trim().length < 2) return [];
    return search(String(text).slice(0, 80), { path, limit: 12 });
}

module.exports = { wishItemsAllowed, anyWishItemsAllowed, wishItemView, resolveWishItems, searchWishItems, wowheadPathOf };
