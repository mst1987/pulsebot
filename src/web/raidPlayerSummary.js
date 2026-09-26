// What the Raid-Detail page's player dialog shows about one raider beyond this
// raid: how many of the category's recent raids they were in, what they got
// lately and when the last item came. Derived on read from data the bot already
// keeps (the loot store and the raid-event snapshots) — nothing is stored.

const { countsAsLoot } = require("../utils/loot/lootReasons");
const { wowheadLink } = require("../config/wowheadItemAliases");

const WEEK_MS = 7 * 86400000;
const RECENT_ITEMS = 3;

const key = (name) => String(name || "").trim().toLowerCase();

/** The trimmed loot row the dialog lists. */
function recentItem(it) {
    return {
        itemId: it.itemId,
        itemName: it.itemName || "",
        itemIconUrl: it.itemIconUrl || "",
        itemQuality: it.itemQuality ?? null,
        itemLink: wowheadLink(it.itemLink),
        response: it.response || "",
        reasonLabel: it.reasonLabel || "",
        reasonTone: it.reasonTone || "",
        awardedAt: it.awardedAt || 0,
    };
}

/**
 * Per-raider summary for the names shown on a raid page.
 * @param {string[]} names character names (setup + attendance), any case
 * @param {object[]} loot every stored loot row (lootStore.listAll(), decorated)
 * @param {object[]} raidEvents persisted Raid-Helper events (raidEventStore.listRaidEvents)
 * @param {{ categoryId?: string, now?: number, weeks?: number }} [opts]
 * @returns {Object<string, { raids: number|null, raidsOf: number, loot: number, lastLootAt: number, recent: object[] }>}
 *   keyed by the lowercased name. `raids` is null when no raid of the category in
 *   the window kept a raidplan — "unknown", never "0 raids".
 */
function summarizePlayers(names, loot = [], raidEvents = [], opts = {}) {
    const now = opts.now || Date.now();
    const since = now - (opts.weeks || 8) * WEEK_MS;
    const wanted = new Set((names || []).map(key).filter(Boolean));

    // Raids of this category in the window that kept their raidplan.
    const windowRaids = (raidEvents || []).filter((e) => {
        const start = (Number(e && e.startTime) || 0) * 1000;
        if (!start || start < since || start > now) return false;
        if (opts.categoryId && e.categoryId && e.categoryId !== opts.categoryId) return false;
        return Array.isArray(e.setup) && e.setup.length > 0;
    });
    const raidsByName = new Map();
    for (const e of windowRaids) {
        const inRaid = new Set(e.setup.map((slot) => key(slot && (slot.name || slot.charName || slot.characterName))));
        for (const n of inRaid) if (wanted.has(n)) raidsByName.set(n, (raidsByName.get(n) || 0) + 1);
    }

    const out = {};
    for (const n of wanted) {
        out[n] = { raids: windowRaids.length ? (raidsByName.get(n) || 0) : null, raidsOf: windowRaids.length, loot: 0, lastLootAt: 0, recent: [] };
    }
    for (const it of loot || []) {
        const n = key(it.characterKey || it.character);
        const entry = out[n];
        if (!entry) continue;
        // Shards, bank and off-spec rolls did nothing for the raider's set.
        if (!countsAsLoot(it.reason)) continue;
        const at = Number(it.awardedAt) || 0;
        if (at >= since) entry.loot += 1;
        if (at > entry.lastLootAt) entry.lastLootAt = at;
        entry.recent.push(it);
    }
    for (const entry of Object.values(out)) {
        entry.recent = entry.recent
            .sort((a, b) => (b.awardedAt || 0) - (a.awardedAt || 0))
            .slice(0, RECENT_ITEMS)
            .map(recentItem);
    }
    return out;
}

module.exports = { summarizePlayers, RECENT_ITEMS };
