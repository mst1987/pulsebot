// The hand-maintained BiS lists of the loot council (#760): a version without
// BiS data of its own (WoW Forever) gets its lists from the orga, per spec and
// slot (stores/manualBisStore.js). The council reads them in
// web/loot/manualBisCouncil.js; these routes are the editor.
//
//   GET  /api/lootcouncil/manual-bis?version=          the version's lists, specs, slots
//   GET  /api/lootcouncil/manual-bis/search?version=&q= Wowhead of the version (name, or an id)
//   POST /api/lootcouncil/manual-bis { version, spec, slot, items: [id] }  one slot, whole
//
// Reading takes `lootcouncil` read, writing `lootcouncil` write. A version with
// BiS data of its own (TBC) has no hand lists: 409 `has_bis_data`.
//
// Names come from Wowhead of the version (its path in Einstellungen →
// Spielversion), never from the request. A version without a path, or an item
// Wowhead does not know (yet) - Forever before its launch - is stored with its
// id alone: the answer names it in `unresolved`, the page shows "Item <id>".

const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { userCan } = require("../../config/permissions");
const { getConfig } = require("../../stores/settingsStore");
const manualBisStore = require("../../stores/manualBisStore");
const { MANUAL_SLOTS, MAX_PER_SLOT } = manualBisStore;
const { SLOT_NAMES } = require("../../utils/logcheck/gearIssues");
const { SPECS, specByKey } = require("../../config/councilSpecs");
const { characterProfile } = require("../../utils/setup/setupView");
const { rulesFor } = require("../../config/gameVersions");
const { knownVersion, mainVersionFor } = require("../../services/events/mainVersion");
const { councilContent } = require("../../services/events/versionCapabilities");
const { versionLinks } = require("../../services/events/versionSettings");
const { wowheadPathOf } = require("../../services/characters/wishItems");
const wowhead = require("../../utils/loot/wowhead");

const SLOT_SET = new Set(MANUAL_SLOTS);

/** The version a request names, else the main version. */
function versionOf(raw, config) {
    return knownVersion(raw) || mainVersionFor({ config });
}

/** A stored item as the editor shows it: icon url and the Wowhead link of the version. */
function itemView(item, links) {
    return {
        id: item.id,
        name: item.name || "",
        iconUrl: wowhead.iconUrl(item.icon),
        quality: item.quality === undefined ? null : item.quality,
        link: links.wowheadItem(item.id),
    };
}

/** A spec's list for the editor: `{ slots: { [slot]: [item] }, at, by }`. */
function listView(list, links) {
    const slots = {};
    for (const [slot, items] of Object.entries((list && list.slots) || {})) slots[slot] = items.map((it) => itemView(it, links));
    return { slots, at: (list && list.at) || 0, by: (list && list.by) || "" };
}

/** The whole editor answer for a version. */
function editorView(versionId, config) {
    const content = councilContent(versionId, { config });
    const links = versionLinks(versionId, { config });
    const lists = manualBisStore.listsFor(versionId);
    const rules = rulesFor(versionId);
    return {
        versionId,
        versionLabel: (rules && rules.label) || versionId,
        // Whether the version keeps hand lists at all (no BiS data of its own, feature on).
        available: content.manualBis,
        off: content.off,
        // Whether Wowhead can be asked for the version (a path is set); otherwise only ids.
        search: !!wowheadPathOf(versionId, { config }),
        maxPerSlot: MAX_PER_SLOT,
        slots: MANUAL_SLOTS.map((slot) => ({ slot, slotName: SLOT_NAMES[slot] || `Slot ${slot}` })),
        specs: SPECS.map((s) => {
            const look = characterProfile(s.className, s.spec) || {};
            const list = lists[s.key];
            return {
                key: s.key,
                label: s.label,
                className: s.className,
                spec: s.spec,
                role: s.role,
                iconUrl: look.iconUrl || "",
                classColor: look.classColor || "",
                filled: list ? Object.keys(list.slots).length : 0,
            };
        }),
        lists: Object.fromEntries(Object.entries(lists).map(([key, list]) => [key, listView(list, links)])),
    };
}

/** Why a version takes no hand lists (`{ code, message }`, a 409); null when it does. */
function refusal(versionId, config) {
    const content = councilContent(versionId, { config });
    if (content.manualBis) return null;
    if (content.bis) return { code: "has_bis_data", message: "Diese Spielversion hat eigene BiS-Listen – von Hand gepflegte Listen gibt es nur für Versionen ohne BiS-Daten." };
    return { code: "feature_off", message: "BiS-Listen sind für diese Spielversion ausgeschaltet (Einstellungen → Spielversion)." };
}

const getManualBis = withUser({}, async ({ user, res, url }) => {
    if (!userCan(user, "lootcouncil", "read")) return apiError(res, 403, "forbidden", "Kein Zugriff auf den Loot-Council.");
    const config = getConfig();
    ok(res, editorView(versionOf(url.searchParams.get("version"), config), config));
});

/**
 * Wowhead of the version: a name (suggestions) or an item id (one lookup).
 * `search: false` when the version has no Wowhead path - the page then offers
 * the id field alone and says why.
 */
const getManualBisSearch = withUser({}, async ({ user, res, url }) => {
    if (!userCan(user, "lootcouncil", "read")) return apiError(res, 403, "forbidden", "Kein Zugriff auf den Loot-Council.");
    const config = getConfig();
    const versionId = versionOf(url.searchParams.get("version"), config);
    const path = wowheadPathOf(versionId, { config });
    const q = String(url.searchParams.get("q") || "").trim().slice(0, 80);
    if (!path) return ok(res, { items: [], search: false });
    if (/^\d+$/.test(q)) {
        const hit = await wowhead.lookupItem(Number(q), { path });
        return ok(res, { items: hit ? [{ id: hit.id, name: hit.name, iconUrl: hit.iconUrl, quality: hit.quality }] : [], search: true });
    }
    const items = await wowhead.searchItems(q, { path, limit: 12 });
    ok(res, { items: items.map((it) => ({ id: it.id, name: it.name, iconUrl: it.iconUrl, quality: it.quality })), search: true });
});

/** The item ids a save asks for, each once; null when one is no id. */
function requestedIds(list) {
    const ids = [];
    for (const raw of Array.isArray(list) ? list : []) {
        const id = Number(raw && typeof raw === "object" ? raw.id : raw);
        if (!Number.isInteger(id) || id <= 0) return null;
        if (!ids.includes(id)) ids.push(id);
    }
    return ids;
}

/**
 * The items to store for these ids: what the version's lists already know (no
 * second Wowhead call), else Wowhead of the version; an item Wowhead does not
 * know (yet), or cannot be asked about, is kept by id and named in `unresolved`.
 */
async function resolveItems(versionId, ids, config) {
    const known = new Map();
    for (const list of Object.values(manualBisStore.listsFor(versionId))) {
        for (const items of Object.values(list.slots)) {
            for (const it of items) if (!known.has(it.id) || (!known.get(it.id).name && it.name)) known.set(it.id, it);
        }
    }
    const path = wowheadPathOf(versionId, { config });
    const unresolved = [];
    const items = [];
    for (const id of ids) {
        const stored = known.get(id);
        if (stored && stored.name) { items.push(stored); continue; }
        const hit = path ? await wowhead.lookupItem(id, { path, strict: true }).catch(() => null) : null;
        if (hit && hit.name) {
            items.push({ id, name: hit.name, icon: hit.icon || "", quality: hit.quality });
        } else {
            // kept by id, never named by guess
            unresolved.push(id);
            items.push({ id, name: "", icon: "", quality: null });
        }
    }
    return { items, unresolved };
}

/**
 * Set one slot of one spec's list (the whole slot, in order: the first item is
 * the BiS piece, the rest alternatives). Items already in the version's lists
 * keep their stored name; a new one is looked up on Wowhead of the version.
 */
const postManualBis = withUser({ write: "lootcouncil", csrf: true, body: true }, async ({ user, body, res }) => {
    const config = getConfig();
    const versionId = knownVersion(body.version);
    if (!versionId) return apiError(res, 400, "unknown_version", "Unbekannte Spielversion.");
    const refused = refusal(versionId, config);
    if (refused) return apiError(res, 409, refused.code, refused.message);
    const spec = specByKey(String(body.spec || ""));
    if (!spec || !SPECS.includes(spec)) return apiError(res, 400, "unknown_spec", "Unbekannte Spezialisierung.");
    const slot = Number(body.slot);
    if (!SLOT_SET.has(slot)) return apiError(res, 400, "unknown_slot", "Unbekannter Slot.");
    const ids = requestedIds(body.items);
    if (!ids) return apiError(res, 400, "unknown_item", "Ungültige Item-ID.");
    if (ids.length > MAX_PER_SLOT) return apiError(res, 400, "too_many", `Höchstens ${MAX_PER_SLOT} Items je Slot.`);

    const { items, unresolved } = await resolveItems(versionId, ids, config);
    manualBisStore.setSlot(versionId, spec.key, slot, items, { by: (user && user.name) || "" });
    const view = editorView(versionId, config);
    ok(res, { ...view, spec: spec.key, slot, unresolved });
});

const routes = [
    { method: "GET", path: "/api/lootcouncil/manual-bis", handler: getManualBis, area: "lootcouncil" },
    { method: "GET", path: "/api/lootcouncil/manual-bis/search", handler: getManualBisSearch, area: "lootcouncil" },
    { method: "POST", path: "/api/lootcouncil/manual-bis", handler: postManualBis, area: "lootcouncil" },
];

module.exports = { getManualBis, getManualBisSearch, postManualBis, routes };
