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

module.exports = { searchItems, iconUrl, itemLink, branchFor };
