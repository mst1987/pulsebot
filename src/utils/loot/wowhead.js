// Wowhead item lookup for the softres hard-reserve picker. Wowhead's search
// suggestion endpoint returns items with id + icon; we proxy it server-side
// (it is cross-origin from the browser) and normalise the shape for the UI.

const axios = require("axios");
const httpsAgent = require("../httpAgent");
// Anniversary re-issues Wowhead does not know link and resolve as the original.
const { wowheadItemId } = require("../../config/wowheadItemAliases");

const ICON_BASE = "https://wow.zamimg.com/images/wow/icons/large";

// Map a softres edition to the Wowhead game branch used in its URL path. A
// version's own Wowhead path (#542, versionSettings.wowheadPath) is handed in
// as `path` and wins over the edition.
function branchFor(edition, path = "") {
    if (path) return String(path);
    if (edition === "classic") return "classic";
    if (edition === "wotlk") return "wotlk";
    return "tbc";
}

function iconUrl(icon) {
    return icon ? `${ICON_BASE}/${String(icon).toLowerCase()}.jpg` : "";
}

function itemLink(itemId, edition = "tbc", path = "") {
    return itemId ? `https://www.wowhead.com/${branchFor(edition, path)}/item=${wowheadItemId(itemId)}` : "";
}

/**
 * Search Wowhead for items matching `query`. Returns up to `limit` items as
 * { id, name, icon, iconUrl, quality }. Non-item results (spells, NPCs, quests)
 * are filtered out. Returns [] for short queries or on any error (best-effort).
 * @param {string} query
 * @param {object} [opts] { edition, limit, path } - `path` a version's Wowhead path, wins over the edition
 */
async function searchItems(query, { edition = "tbc", limit = 12, path = "" } = {}) {
    const q = String(query || "").trim();
    if (q.length < 2) return [];
    try {
        const { data } = await axios.get(`https://www.wowhead.com/${branchFor(edition, path)}/search/suggestions-template`, {
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
 * @param {object} [opts] { edition, path } - `path` a version's Wowhead path, wins over the edition
 */
async function lookupItem(itemId, { edition = "tbc", path = "" } = {}) {
    const id = Number(itemId) || 0;
    if (!id) return null;
    const branch = branchFor(edition, path);
    const key = `${branch}:${id}`;
    if (itemCache.has(key)) return itemCache.get(key);
    try {
        const { data } = await axios.get(`https://nether.wowhead.com/${branch}/tooltip/item/${wowheadItemId(id)}`, {
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
        itemCache.set(key, result);
        return result;
    } catch (e) {
        console.error("wowhead item lookup failed:", e.message);
        return null;
    }
}

// Wowhead's locale numbers for the tooltip endpoint and the path segment of
// its pages; English is the default and has neither.
const LOCALES = { de: { number: 3, segment: "de" }, en: { number: 0, segment: "" } };

/** The text of `<tag ...>` in Wowhead's item XML (CDATA unwrapped), "" when missing. */
function xmlText(xml, tag) {
    const m = new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`).exec(xml);
    return m ? m[1].trim() : "";
}

/** The `id` attribute of `<tag id="...">`, null when missing. */
function xmlId(xml, tag) {
    const m = new RegExp(`<${tag}\\s+id="(-?\\d+)"`).exec(xml);
    return m ? Number(m[1]) : null;
}

/**
 * One item with its name in a locale (German by default), icon, quality and
 * Wowhead's item class and subclass ("Verbrauchbar" / "Fläschchen") — what the
 * guild bank stock shows and groups by (services/guildbank/itemMeta.js).
 *
 * Asks Wowhead's item XML first, the one answer that carries the class; when
 * that fails, the tooltip endpoint (name, icon, quality, no class). Not cached
 * here: the caller keeps the answer on disk. Null on a missing id, an unknown
 * item or any error (best-effort).
 * @param {number|string} itemId
 * @param {{ edition?: string, path?: string, locale?: "de"|"en" }} [opts]
 * @returns {Promise<{ id, name, icon, iconUrl, quality, classId, subclassId, className, subclassName }|null>}
 */
async function lookupItemDetails(itemId, { edition = "tbc", path = "", locale = "de" } = {}) {
    const id = Number(itemId) || 0;
    if (!id) return null;
    const branch = branchFor(edition, path);
    const loc = LOCALES[locale] || LOCALES.de;
    const target = wowheadItemId(id);
    const request = { httpsAgent, timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 (EventHelper)" } };
    try {
        const segment = loc.segment ? `/${loc.segment}` : "";
        const { data } = await axios.get(`https://www.wowhead.com/${branch}${segment}/item=${target}&xml`, { ...request, responseType: "text" });
        const xml = String(data || "");
        const name = xmlText(xml, "name");
        if (name && !/<error>/.test(xml)) {
            const icon = xmlText(xml, "icon");
            return {
                id,
                name,
                icon,
                iconUrl: iconUrl(icon),
                quality: xmlId(xml, "quality"),
                classId: xmlId(xml, "class"),
                subclassId: xmlId(xml, "subclass"),
                className: xmlText(xml, "class"),
                subclassName: xmlText(xml, "subclass"),
            };
        }
    } catch (e) {
        console.error("wowhead item xml failed:", e.message);
    }
    try {
        const query = loc.number ? `?locale=${loc.number}` : "";
        const { data } = await axios.get(`https://nether.wowhead.com/${branch}/tooltip/item/${target}${query}`, request);
        if (!data || !data.name) return null;
        return {
            id,
            name: String(data.name),
            icon: data.icon || "",
            iconUrl: iconUrl(data.icon),
            quality: typeof data.quality === "number" ? data.quality : null,
            classId: null,
            subclassId: null,
            className: "",
            subclassName: "",
        };
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

module.exports = { searchItems, lookupItem, lookupItemDetails, findItemByName, iconUrl, itemLink, branchFor };
