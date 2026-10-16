// The loot council on hand-maintained BiS lists (#760).
//
// A version without content data (WoW Forever: no WoWSims, no generated item
// table) measures its raiders against the lists the orga keeps in
// stores/manualBisStore.js. What that can and cannot answer:
//
//   - "BiS 9 von 16" and the open BiS items: yes — a slot counts as done when
//     the raider's last seen gear wears its BiS piece or one of its
//     alternatives (copies counted, two rings of the same id need two).
//   - "für wen ist das BiS?": yes — every spec whose list names the item.
//   - "wer könnte es tragen, was wäre es wert?": no. There is no item table,
//     so no wear rules, no stats and no simulation. A drop's candidates are
//     therefore exactly the raiders whose list names it and who still miss it,
//     ordered by need — never a guessed gain.
//
// The TBC council never comes here: `councilContent().manualBis` is false for a
// version with BiS data of its own.

const manualBisStore = require("../../stores/manualBisStore");
const { MANUAL_SLOTS } = manualBisStore;
const { SLOT_NAMES } = require("../../utils/logcheck/gearIssues");
const { characterProfile } = require("../../utils/setup/setupView");
const { specByKey } = require("../../config/councilSpecs");
const wowhead = require("../../utils/loot/wowhead");

const SOURCE = "manual";
const SOURCE_LABEL = "Eigene Liste";

// How many recent awards ride along on a candidate — the same as lootCouncil.js.
const RECENT_ITEMS = 8;

/**
 * Everything the council needs of a version's hand lists, read once per request:
 * the lists, who names each item (spec keys) and the stored item info.
 * @param {string} versionId
 * @param {{ lists?: object }} [opts]  `lists` instead of the store (tests)
 */
function manualIndex(versionId, { lists } = {}) {
    const all = lists || manualBisStore.listsFor(versionId);
    const owners = new Map();
    const info = new Map();
    for (const [specKey, list] of Object.entries(all)) {
        for (const items of Object.values(list.slots || {})) {
            for (const item of items) {
                if (!owners.has(item.id)) owners.set(item.id, []);
                if (!owners.get(item.id).includes(specKey)) owners.get(item.id).push(specKey);
                // The first entry with a name wins: an id-only entry elsewhere never blanks it.
                const known = info.get(item.id);
                if (!known || (!known.name && item.name)) info.set(item.id, item);
            }
        }
    }
    return { versionId: String(versionId || ""), lists: all, owners, info };
}

/** Whose hand list names an item — the same shape as lootCouncil.js bisSpecsView. */
function manualBisSpecsView(index, itemId) {
    const keys = (index && index.owners.get(Number(itemId))) || [];
    return keys.map((key) => {
        const spec = specByKey(key);
        const look = (spec && characterProfile(spec.className, spec.spec)) || {};
        return {
            specKey: key,
            label: spec ? spec.label : key,
            iconUrl: look.iconUrl || "",
            classColor: look.classColor || "",
            role: spec ? spec.role : "",
            tier: "",
            alsoFor: [],
        };
    });
}

/** An item of the hand lists as the page draws it (lootCouncil.js itemView's shape, no table data). */
function manualItemView(index, itemId) {
    const id = Number(itemId);
    const item = (index && index.info.get(id)) || {};
    return {
        id,
        name: item.name || "",
        iconUrl: wowhead.iconUrl(item.icon),
        ilvl: 0,
        quality: item.quality === undefined ? null : item.quality,
        stats: {},
        setName: "",
        contentId: "",
        boss: "",
        bisSpecs: manualBisSpecsView(index, id),
    };
}

/** A spec's hand list as a roster row's `bis` source (bisForSpec's shape). Empty without one. */
function manualBisForSpec(index, specEntry) {
    const list = (specEntry && index && index.lists[specEntry.key]) || null;
    const items = [];
    for (const slot of MANUAL_SLOTS) {
        const slotItems = list && list.slots[slot];
        if (slotItems && slotItems.length) items.push({ id: slotItems[0].id, slot, ids: slotItems.map((i) => i.id) });
    }
    return {
        items,
        tier: "",
        exact: true,
        borrowedFrom: "",
        source: items.length ? SOURCE : "",
        sourceLabel: items.length ? SOURCE_LABEL : "",
    };
}

/**
 * The hand list with what the raider wears of it: one entry per slot, done when
 * the worn gear holds its BiS piece or an alternative. Copies are spent like
 * bisItemsFor does, so one worn ring closes one ring slot, not two. A done slot
 * shows the piece actually worn; an open one its BiS piece, the others as
 * `alternatives`.
 */
function manualBisItems(index, bis, gear) {
    const wornCount = new Map();
    for (const it of (gear && gear.items) || []) {
        const id = Number(it.itemId);
        wornCount.set(id, (wornCount.get(id) || 0) + 1);
    }
    return bis.items.map((entry) => {
        const worn = entry.ids.find((id) => (wornCount.get(id) || 0) > 0);
        if (worn) wornCount.set(worn, wornCount.get(worn) - 1);
        const shown = worn || entry.id;
        return {
            ...manualItemView(index, shown),
            slot: entry.slot,
            slotName: SLOT_NAMES[entry.slot] || `Slot ${entry.slot}`,
            alternatives: entry.ids.filter((id) => id !== shown),
            owned: !!worn,
        };
    });
}

/** Every item id a row's hand list names (BiS pieces and alternatives). */
function manualBisIds(bis) {
    return new Set(bis.items.flatMap((entry) => entry.ids));
}

/** The open entries of a row's list that name this item (as BiS piece or alternative). */
function openEntriesFor(row, itemId) {
    const id = Number(itemId);
    return ((row.bis && row.bis.items) || []).filter((entry) => !entry.owned && (entry.id === id || (entry.alternatives || []).includes(id)));
}

/**
 * The drop check on hand lists: who has the item on their list and still
 * misses it. No wear rules, no gain — ordered by need alone; `owned` names who
 * already has every copy their list asks for (worn or awarded).
 * @returns {{ candidates: object[], unwearable: object[], owned: object[] }}
 */
function manualCandidateSplit(itemId, roster) {
    const id = Number(itemId);
    const candidates = [];
    const owned = [];
    for (const row of roster) {
        const named = ((row.bis && row.bis.items) || []).filter((entry) => entry.id === id || (entry.alternatives || []).includes(id));
        if (!named.length) continue;
        const ident = {
            key: row.key,
            character: row.character,
            classColor: row.classColor,
            specKey: row.specKey,
            specLabel: row.specLabel,
            specIconUrl: row.specIconUrl,
        };
        const open = openEntriesFor(row, id);
        const awarded = (row.items || []).filter((it) => Number(it.itemId) === id).length;
        if (!open.length) { owned.push({ ...ident, source: "worn" }); continue; }
        // Won but not yet in a log: as many copies as the open slots ask for are "awarded".
        if (awarded >= open.length) { owned.push({ ...ident, source: "awarded" }); continue; }
        const entry = open[0];
        const replaces = ((row.gear && row.gear.items) || []).find((it) => it.slot === entry.slot) || null;
        candidates.push({
            ...ident,
            slot: entry.slot,
            slotName: entry.slotName,
            replaces,
            slotOptions: [{ slot: entry.slot, slotName: entry.slotName, chosen: true, item: replaces }],
            twoHanded: false,
            value: 0,
            inflatedBy: [],
            isBis: true,
            bisWeight: 1,
            itemNeedScore: row.needScore,
            needScore: row.needScore,
            needParts: row.needParts,
            lootCount: row.lootCount,
            lootPoints: row.lootPoints,
            lootTotal: row.lootTotal,
            droughtDays: row.droughtDays,
            tenureDays: row.tenureDays,
            joinedAt: row.joinedAt,
            otherCount: row.otherCount,
            recentItems: (row.items || []).slice(0, RECENT_ITEMS),
            daysSinceLoot: row.daysSinceLoot,
            lastAwardAt: row.lastAwardAt,
            bisOwned: row.bis.owned,
            bisTotal: row.bis.total,
            hasGear: !!row.gear,
            simSupported: false,
            gear: row.gear,
        });
    }
    candidates.sort((a, b) => b.itemNeedScore - a.itemNeedScore || a.character.localeCompare(b.character));
    return { candidates, unwearable: [], owned };
}

/**
 * The open BiS items on hand lists (bisGaps' shape): one card per item somebody
 * still misses, with who wants it and the candidates by need.
 */
function manualBisGaps(roster) {
    const byItem = new Map();
    for (const row of roster) {
        const seen = new Map();
        for (const item of (row.bis && row.bis.items) || []) {
            if (item.owned) continue;
            if (!byItem.has(item.id)) {
                // the item as bisGaps carries it - without the raider's own slot fields
                byItem.set(item.id, {
                    id: item.id, name: item.name, iconUrl: item.iconUrl, ilvl: item.ilvl, quality: item.quality,
                    stats: item.stats, setName: item.setName, contentId: item.contentId, boss: item.boss, bisSpecs: item.bisSpecs,
                    wantedBy: [],
                });
            }
            const already = seen.get(item.id);
            if (already) { already.missing += 1; continue; }
            const entry = {
                missing: 1,
                key: row.key,
                character: row.character,
                specKey: row.specKey,
                specLabel: row.specLabel,
                needScore: row.needScore,
            };
            seen.set(item.id, entry);
            byItem.get(item.id).wantedBy.push(entry);
        }
    }
    const items = [...byItem.values()];
    for (const item of items) {
        item.candidates = manualCandidateSplit(item.id, roster).candidates;
        item.best = item.candidates.length ? item.candidates[0] : null;
    }
    items.sort((a, b) => b.wantedBy.length - a.wantedBy.length || (b.best ? b.best.needScore : 0) - (a.best ? a.best.needScore : 0));
    return items;
}

/** Items of the hand lists whose name contains the text (or whose id it is), for the drop picker. */
function searchManualItems(index, text, limit = 20) {
    const q = String(text || "").trim().toLowerCase();
    if (!q) return [];
    const asId = /^\d+$/.test(q) ? Number(q) : 0;
    const out = [];
    for (const [id, item] of index.info) {
        if (id === asId || (item.name && item.name.toLowerCase().includes(q))) out.push(manualItemView(index, id));
        if (out.length >= limit) break;
    }
    return out;
}

module.exports = {
    manualIndex, manualBisForSpec, manualBisItems, manualBisIds, manualBisSpecsView, manualItemView,
    manualCandidateSplit, manualBisGaps, searchManualItems, SOURCE, SOURCE_LABEL,
};
