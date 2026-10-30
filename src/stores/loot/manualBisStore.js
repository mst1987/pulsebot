// BiS lists the orga maintains by hand (#760), per game version, spec and slot.
//
// A version without content data (today WoW Forever: WoWSims knows no Forever,
// and there is no generated item table) has no BiS lists of its own. The loot
// council still wants to say who is missing what, so the orga writes the lists
// down itself — after the launch, from whatever guide it trusts. Nothing in here
// is ever filled by the code: an empty file is the honest starting point.
//
//   { versions: { [versionId]: { [specKey]: {
//         slots: { [slot]: [{ id, name, icon, quality }] },  // slot = WCL slot number
//         at, by,
//   } } } }
//
// A slot holds up to MAX_PER_SLOT items: the first is the BiS piece, the others
// count as equally good alternatives (one of them worn = the slot is done). The
// slots are the character sheet's (WCL numbering, shared with the gear the logs
// carry), so a worn piece and a list entry meet on the same number.
//
// Name, icon and quality come from Wowhead of the version when the route could
// ask it; an item Wowhead does not know (yet) is kept with its id alone and the
// page shows "Item <id>" — never an invented name.
//
// The route checks version and spec (apiRoutes/loot/lootCouncilBis.js); the store
// only keeps the shape sound.

const { settingsPath } = require("../../config/paths");
const { createJsonStore } = require("../jsonStore");

const FILE = settingsPath("council-manual-bis.json");

// Character-sheet order, without shirt (3) and tabard (18).
const MANUAL_SLOTS = Object.freeze([0, 1, 2, 14, 4, 8, 9, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17]);
const SLOT_SET = new Set(MANUAL_SLOTS);
const MAX_PER_SLOT = 3;

const str = (v, max = 120) => (v === undefined || v === null ? "" : String(v)).trim().slice(0, max);
const isMap = (v) => v && typeof v === "object" && !Array.isArray(v);

/** One stored item, or null when it carries no usable id. */
function normalizeItem(raw) {
    const id = Number(raw && typeof raw === "object" ? raw.id : raw);
    if (!Number.isInteger(id) || id <= 0) return null;
    const given = raw && typeof raw === "object" ? raw.quality : null;
    const q = given === null || given === undefined || given === "" ? NaN : Number(given);
    return {
        id,
        name: str(raw && raw.name),
        icon: str(raw && raw.icon, 80).toLowerCase(),
        quality: Number.isInteger(q) && q >= 0 && q <= 7 ? q : null,
    };
}

/** A slot's items: valid ids only, each once, at most MAX_PER_SLOT. */
function normalizeItems(list) {
    const out = [];
    for (const raw of Array.isArray(list) ? list : []) {
        const item = normalizeItem(raw);
        if (item && !out.some((x) => x.id === item.id)) out.push(item);
        if (out.length >= MAX_PER_SLOT) break;
    }
    return out;
}

/** A spec's list; null when no slot holds anything. */
function normalizeSpec(raw) {
    if (!isMap(raw) || !isMap(raw.slots)) return null;
    const slots = {};
    for (const [slot, items] of Object.entries(raw.slots)) {
        const n = Number(slot);
        if (!SLOT_SET.has(n)) continue;
        const list = normalizeItems(items);
        if (list.length) slots[n] = list;
    }
    if (!Object.keys(slots).length) return null;
    return { slots, at: Number(raw.at) || 0, by: str(raw.by, 80) };
}

function normalize(data) {
    const out = {};
    const versions = isMap(data) && isMap(data.versions) ? data.versions : {};
    for (const [versionId, specs] of Object.entries(versions)) {
        const vid = str(versionId, 40);
        if (!vid || !isMap(specs)) continue;
        const block = {};
        for (const [specKey, spec] of Object.entries(specs)) {
            const key = str(specKey, 60);
            const list = key ? normalizeSpec(spec) : null;
            if (list) block[key] = list;
        }
        if (Object.keys(block).length) out[vid] = block;
    }
    return out;
}

const store = createJsonStore({ file: FILE, defaults: () => ({}), normalize });

/** Every hand list of a version: `{ [specKey]: { slots, at, by } }` ({} without any). */
function listsFor(versionId) {
    return store.read()[str(versionId, 40)] || {};
}

/** Whether a version has at least one hand list. */
function hasLists(versionId) {
    return Object.keys(listsFor(versionId)).length > 0;
}

/**
 * Set one slot of one spec's list (the whole slot, in order). An empty list
 * clears the slot; a spec without any slot left disappears.
 * @returns {{ slots: object, at: number, by: string } | null} the spec's list after the change
 */
function setSlot(versionId, specKey, slot, items, { by = "", now = Date.now() } = {}) {
    const vid = str(versionId, 40);
    const key = str(specKey, 60);
    const n = Number(slot);
    if (!vid || !key || !SLOT_SET.has(n)) return null;
    const all = store.read();
    const block = all[vid] || {};
    const spec = block[key] || { slots: {}, at: 0, by: "" };
    const list = normalizeItems(items);
    if (list.length) spec.slots[n] = list;
    else delete spec.slots[n];
    if (Object.keys(spec.slots).length) {
        block[key] = { slots: spec.slots, at: now, by: str(by, 80) };
    } else {
        delete block[key];
    }
    if (Object.keys(block).length) all[vid] = block;
    else delete all[vid];
    store.write({ versions: all });
    return block[key] || null;
}

module.exports = {
    listsFor, hasLists, setSlot, normalizeItems,
    MANUAL_SLOTS, MAX_PER_SLOT, FILE,
    useFile: (file) => store.useFile(file),
};
