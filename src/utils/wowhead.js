// Wowhead item lookup for the softres hard-reserve picker. Wowhead's search
// suggestion endpoint returns items with id + icon; we proxy it server-side
// (it is cross-origin from the browser) and normalise the shape for the UI.

const axios = require("axios");
const httpsAgent = require("./httpAgent");

const ICON_BASE = "https://wow.zamimg.com/images/wow/icons/large";

// Map a softres edition to the Wowhead game branch used in its URL path.
function branchFor(edition) {
    if (edition === "classic") return "classic";
    if (edition === "wotlk") return "wotlk";
    return "tbc";
}

function iconUrl(icon) {
    return icon ? `${ICON_BASE}/${String(icon).toLowerCase()}.jpg` : "";
}

function itemLink(itemId, edition = "tbc") {
    return itemId ? `https://www.wowhead.com/${branchFor(edition)}/item=${itemId}` : "";
}

/**
 * Search Wowhead for items matching `query`. Returns up to `limit` items as
 * { id, name, icon, iconUrl, quality }. Non-item results (spells, NPCs, quests)
 * are filtered out. Returns [] for short queries or on any error (best-effort).
 * @param {string} query
 * @param {object} [opts] { edition, limit }
 */
async function searchItems(query, { edition = "tbc", limit = 12 } = {}) {
    const q = String(query || "").trim();
    if (q.length < 2) return [];
    try {
        const { data } = await axios.get(`https://www.wowhead.com/${branchFor(edition)}/search/suggestions-template`, {
            params: { q },
            httpsAgent,
            timeout: 15000,
            headers: { "User-Agent": "Mozilla/5.0 (EventHelper)" },
        });
        const results = (data && Array.isArray(data.results)) ? data.results : [];
        return results
            .filter((r) => r && (r.typeName === "Item" || r.type === 3) && Number(r.id) > 0)
            .slice(0, limit)
            .map((r) => ({
                id: Number(r.id),
                name: String(r.name || ""),
                icon: r.icon || "",
                iconUrl: iconUrl(r.icon),
                quality: r.quality === undefined ? null : r.quality,
            }));
    } catch (e) {
        console.error("wowhead search failed:", e.message);
        return [];
    }
}

// In-memory cache for lookupItem() — the same handful of boss-drop item ids
// repeats across every raider's row in a loot import, and across re-imports.
const itemCache = new Map();

/**
 * Resolve one item's name/icon/quality by numeric id — used to fill in Gargul
 * imports, which only carry the id. Asked on the game branch (default TBC), not
 * on the branchless endpoint: the id resolves to the same item either way, but
 * retail answers with retail's data, and the TBC relics and idols that were
 * squished out of the modern game come back as quality 0 there — grey, when
 * they were epic. Cached in-memory; returns null on a missing id or any error
 * (best-effort, like searchItems — a lookup failure just means the item keeps
 * showing as "Item <id>").
 * @param {number|string} itemId
 * @param {object} [opts] { edition }
 */
async function lookupItem(itemId, { edition = "tbc" } = {}) {
    const id = Number(itemId) || 0;
    if (!id) return null;
    if (itemCache.has(id)) return itemCache.get(id);
    try {
        const { data } = await axios.get(`https://nether.wowhead.com/${branchFor(edition)}/tooltip/item/${id}`, {
            httpsAgent,
            timeout: 15000,
            headers: { "User-Agent": "Mozilla/5.0 (EventHelper)" },
        });
        if (!data || !data.name) return null;
        const result = {
            id,
            name: String(data.name || ""),
            icon: data.icon || "",
            iconUrl: iconUrl(data.icon),
            quality: data.quality === undefined ? null : data.quality,
        };
        itemCache.set(id, result);
        return result;
    } catch (e) {
        console.error("wowhead item lookup failed:", e.message);
        return null;
    }
}

// In-memory cache for findItemByName() — the same gem cuts repeat across every
// slot of every character, so each distinct name is searched at most once.
const nameCache = new Map();

/**
 * Resolve an item by its exact (case-insensitive) name via the search
 * suggestions, e.g. to turn a known TBC gem name into its id + icon. Cached;
 * returns { id, name, icon, iconUrl, quality } or null when no exact match
 * (best-effort like the other lookups).
 * @param {string} name
 * @param {object} [opts] { edition }
 */
async function findItemByName(name, { edition = "tbc" } = {}) {
    const key = String(name || "").trim().toLowerCase();
    if (!key) return null;
    if (nameCache.has(key)) return nameCache.get(key);
    const results = await searchItems(key, { edition, limit: 8 });
    const exact = results.find((r) => r.name.toLowerCase() === key) || null;
    // Cache misses too — a name that resolves to nothing will not start
    // resolving mid-process, and re-searching it per page view is wasted I/O.
    nameCache.set(key, exact);
    return exact;
}

module.exports = { searchItems, lookupItem, findItemByName, iconUrl, itemLink, branchFor };
