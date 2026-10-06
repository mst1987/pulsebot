// Guild bank stock: the last scan of every guild bank the addon uploaded
// (POST /api/ingest/guildbank, utils/guildbank/guildBankScan.js) and what the
// orga decided per item. Requests against the stock are guildBankStore.js.
//
// `data/settings/guild-bank-stock.json` = { banks: [bank], emojis: { [itemId]: emoji } }
//
//   emoji = { id, name ("gb_<itemId>"), icon, createdAt } — the bot's application
//           emoji of an item's icon (#633, services/guildbank/itemEmojis.js): one
//           per item id, shared by every bank and version that offers the item;
//           it lives while at least one bank has the item on "give". Item views
//           carry its id as `emojiId` ("" = none).
//
//   bank = { key            "tbc:spineshatter:die gilde" — version + realm + guild (bankKeyOf)
//            gameVersion, realm, guild, faction ("Alliance" | "Horde" | "")
//            guildId        the Discord server it belongs to; "" = waits for assignment
//            firstSeenAt, updatedAt,
//            lastScan: { scannedAt, scannedBy, money (copper), generatedAt, build, receivedAt,
//                        uploadedBy (token name), tabs: [{ index, name }],
//                        items: { [itemId]: { count, tabs: { [tabIndex]: count } } } },
//            tabSettings: { [tabIndex]: { hidden } },
//            items: { [itemId]: itemSettings } }
//
//   itemSettings = { status: "new" | "hide" | "show" | "give", reserve, maxPerRequest (0 = no limit),
//                    category (the orga's own group, "" = none), firstSeenAt,
//                    name, icon, quality, classId, subclassId, className, subclassName,
//                    metaSource: "" | "local" | "wowhead", metaAt }
//
// The settings outlive scans: a new scan replaces `lastScan` only. An item id
// seen for the first time gets status "new"; an item that left the bank keeps
// its settings and reads with count 0. A scan older than the stored one (a
// second PC uploading late) is ignored. Item names are German when they come
// from Wowhead (services/guildbank/itemMeta.js), English from the local item
// tables only until Wowhead answered (every item without a Wowhead answer is
// looked up again; the answer replaces the English name).
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { iconUrl } = require("../utils/loot/wowhead");

const STATUSES = ["new", "hide", "show", "give"];
/** What the orga may set; "new" only ever comes from a scan. */
const SETTABLE_STATUSES = ["hide", "show", "give"];
const RESERVE_MAX = 1_000_000;
const MAX_PER_REQUEST_MAX = 9999;
const CATEGORY_MAX = 40;
const META_SOURCES = ["", "local", "wowhead"];

const store = createJsonStore({
    file: settingsPath("guild-bank-stock.json"),
    defaults: () => ({ banks: [], emojis: {} }),
    normalize: (data) => ({
        banks: Array.isArray(data && data.banks) ? data.banks.filter((b) => b && typeof b === "object" && b.key) : [],
        emojis: obj(Object(data).emojis),
    }),
    cache: true,
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

const str = (v, max = 200) => String(v === undefined || v === null ? "" : v).trim().slice(0, max);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const intOrNull = (v) => (v === null || v === undefined || v === "" || !Number.isInteger(Number(v)) ? null : Number(v));
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

function completeItem(raw) {
    const r = obj(raw);
    return {
        status: STATUSES.includes(r.status) ? r.status : "new",
        reserve: Math.max(0, Math.floor(num(r.reserve))),
        maxPerRequest: Math.max(0, Math.floor(num(r.maxPerRequest))),
        category: str(r.category, CATEGORY_MAX),
        firstSeenAt: num(r.firstSeenAt),
        name: str(r.name),
        icon: str(r.icon, 100),
        quality: intOrNull(r.quality),
        classId: intOrNull(r.classId),
        subclassId: intOrNull(r.subclassId),
        className: str(r.className, 60),
        subclassName: str(r.subclassName, 60),
        metaSource: META_SOURCES.includes(r.metaSource) ? r.metaSource : "",
        metaAt: num(r.metaAt),
    };
}

function scanOf(bank) {
    const s = obj(bank.lastScan);
    return {
        scannedAt: num(s.scannedAt),
        scannedBy: str(s.scannedBy),
        money: num(s.money),
        generatedAt: num(s.generatedAt),
        build: str(s.build, 30),
        receivedAt: num(s.receivedAt),
        uploadedBy: str(s.uploadedBy),
        tabs: Array.isArray(s.tabs) ? s.tabs.filter((t) => t && Number(t.index) > 0) : [],
        items: obj(s.items),
    };
}

/** The tabs of a bank: those of the last scan plus any hidden one that is gone, with their hidden flag. */
function tabsOf(bank, scan) {
    const settings = obj(bank.tabSettings);
    const byIndex = new Map(scan.tabs.map((t) => [Number(t.index), { index: Number(t.index), name: str(t.name, 40), inScan: true }]));
    for (const index of Object.keys(settings)) {
        const n = Number(index);
        if (n > 0 && !byIndex.has(n) && settings[index] && settings[index].hidden) byIndex.set(n, { index: n, name: "", inScan: false });
    }
    return [...byIndex.values()]
        .map((t) => ({ ...t, hidden: Boolean(obj(settings[t.index]).hidden) }))
        .sort((a, b) => a.index - b.index);
}

/** One item as the readers get it: stock of the last scan + the orga's settings (+ its emoji's id). */
function itemView(itemId, settings, scan, emojis) {
    const stock = obj(scan.items[itemId]);
    const tabs = {};
    for (const [index, count] of Object.entries(obj(stock.tabs))) {
        if (num(count) > 0) tabs[index] = num(count);
    }
    return {
        itemId: Number(itemId),
        count: num(stock.count),
        tabs,
        ...settings,
        iconUrl: iconUrl(settings.icon),
        emojiId: str(obj(obj(emojis)[String(Number(itemId))]).id, 30),
    };
}

/** By name; items without a name yet last, by id. */
function byName(a, b) {
    if (Boolean(a.name) !== Boolean(b.name)) return a.name ? -1 : 1;
    return a.name.localeCompare(b.name, "de") || a.itemId - b.itemId;
}

/**
 * A bank for the readers. Without `items` the summary: identity, assignment,
 * the scan's facts, the tabs and how many items have which status.
 */
function bankView(bank, { items = true, emojis = {} }) {
    const scan = scanOf(bank);
    const settings = obj(bank.items);
    const list = Object.keys(settings).map((id) => itemView(id, completeItem(settings[id]), scan, emojis));
    const counts = { items: list.length, inStock: 0, new: 0, hide: 0, show: 0, give: 0 };
    for (const it of list) {
        counts[it.status] += 1;
        if (it.count > 0) counts.inStock += 1;
    }
    const guildId = str(bank.guildId, 30);
    const view = {
        key: str(bank.key),
        gameVersion: str(bank.gameVersion, 30),
        realm: str(bank.realm, 60),
        guild: str(bank.guild, 60),
        faction: str(bank.faction, 20),
        guildId,
        pending: !guildId,
        firstSeenAt: num(bank.firstSeenAt),
        updatedAt: num(bank.updatedAt),
        scannedAt: scan.scannedAt,
        scannedBy: scan.scannedBy,
        money: scan.money,
        build: scan.build,
        receivedAt: scan.receivedAt,
        uploadedBy: scan.uploadedBy,
        tabs: tabsOf(bank, scan),
        counts,
    };
    if (items) view.items = list.sort(byName);
    return view;
}

const findBank = (data, key) => data.banks.find((b) => b.key === str(key));

/**
 * Store a parsed scan (utils/guildbank/guildBankScan.js). A bank seen for the
 * first time is created — assigned to `guildId` when one is given, else it
 * waits for an assignment. Returns `{ status: "created" | "updated" | "stale",
 * bank (summary), newItems: [itemId] }`; "stale" = an older scan than the
 * stored one, nothing changed.
 * @param {object} scan
 * @param {{ now?: number, guildId?: string, uploadedBy?: string }} [opts]
 */
function recordScan(scan, { now = Date.now(), guildId = "", uploadedBy = "" } = {}) {
    const data = store.read();
    let bank = findBank(data, scan.key);
    const created = !bank;
    if (!bank) {
        bank = { key: scan.key, gameVersion: scan.gameVersion, guildId: str(guildId, 30), firstSeenAt: now, tabSettings: {}, items: {} };
        data.banks.push(bank);
    }
    const before = scanOf(bank);
    if (!created && before.scannedAt && scan.scannedAt && scan.scannedAt < before.scannedAt) {
        return { status: "stale", bank: bankView(bank, { items: false }), newItems: [] };
    }
    Object.assign(bank, { realm: scan.realm, guild: scan.guild, faction: scan.faction || bank.faction || "", updatedAt: now });
    if (!str(bank.guildId) && str(guildId)) bank.guildId = str(guildId, 30);
    bank.lastScan = {
        scannedAt: scan.scannedAt || now,
        scannedBy: scan.scannedBy || "",
        money: scan.money || 0,
        generatedAt: scan.generatedAt || 0,
        build: scan.build || "",
        receivedAt: now,
        uploadedBy: str(uploadedBy),
        tabs: (scan.tabs || []).map((t) => ({ index: t.index, name: t.name })),
        items: scan.items || {},
    };
    bank.items = obj(bank.items);
    const newItems = [];
    for (const id of Object.keys(bank.lastScan.items)) {
        if (bank.items[id]) continue;
        bank.items[id] = completeItem({ status: "new", firstSeenAt: now });
        newItems.push(Number(id));
    }
    store.write(data);
    return { status: created ? "created" : "updated", bank: bankView(bank, { items: false }), newItems };
}

/** One bank with its items, or null. */
function getBank(key) {
    const data = store.read();
    const bank = findBank(data, key);
    return bank ? bankView(bank, { emojis: data.emojis }) : null;
}

/** Every bank as a summary (no items): waiting ones first, then by version, guild and realm. */
function listBanks() {
    return store.read().banks
        .map((b) => bankView(b, { items: false }))
        .sort((a, b) => (Number(b.pending) - Number(a.pending))
            || a.gameVersion.localeCompare(b.gameVersion)
            || a.guild.localeCompare(b.guild, "de")
            || a.realm.localeCompare(b.realm, "de"));
}

/** The banks of one Discord server, with their items. */
function listForServer(guildId) {
    const id = str(guildId);
    if (!id) return [];
    const data = store.read();
    return data.banks.filter((b) => str(b.guildId) === id).map((b) => bankView(b, { emojis: data.emojis }));
}

/** Assign a bank to a Discord server ("" = back to waiting). Returns the summary or null for an unknown bank. */
function assignBank(key, guildId) {
    const data = store.read();
    const bank = findBank(data, key);
    if (!bank) return null;
    bank.guildId = str(guildId, 30);
    store.write(data);
    return bankView(bank, { items: false });
}

/** Forget a bank with its settings. Returns true when one was removed. */
function removeBank(key) {
    const data = store.read();
    const kept = data.banks.filter((b) => b.key !== str(key));
    if (kept.length === data.banks.length) return false;
    store.write({ ...data, banks: kept });
    return true;
}

/** A whole number from `min` to `max` as typed or sent, else null. */
function wholeNumber(v, min, max) {
    const text = String(v === undefined || v === null ? "" : v).trim();
    if (!/^\d{1,7}$/.test(text)) return null;
    const n = Number(text);
    return n >= min && n <= max ? n : null;
}

/**
 * Change what the orga decided for one item: `{ status, reserve, maxPerRequest,
 * category }`, each optional. Returns `{ item }` (the item view) or `{ error }`
 * (German); nothing is written when one field is wrong.
 */
function setItemSettings(key, itemId, patch = {}) {
    const data = store.read();
    const bank = findBank(data, key);
    if (!bank) return { error: "Gildenbank nicht gefunden." };
    const id = String(Number(itemId) || "");
    const items = obj(bank.items);
    if (!id || !items[id]) return { error: "Gegenstand nicht in dieser Gildenbank." };
    const next = completeItem(items[id]);
    const p = obj(patch);
    if (p.status !== undefined) {
        if (!SETTABLE_STATUSES.includes(p.status)) return { error: "Unbekannte Einordnung." };
        next.status = p.status;
    }
    if (p.reserve !== undefined) {
        const n = wholeNumber(p.reserve, 0, RESERVE_MAX);
        if (n === null) return { error: `Die Reserve muss eine ganze Zahl von 0 bis ${RESERVE_MAX} sein.` };
        next.reserve = n;
    }
    if (p.maxPerRequest !== undefined) {
        const n = wholeNumber(p.maxPerRequest, 0, MAX_PER_REQUEST_MAX);
        if (n === null) return { error: `Die Höchstmenge muss eine ganze Zahl von 0 bis ${MAX_PER_REQUEST_MAX} sein (0 = ohne Grenze).` };
        next.maxPerRequest = n;
    }
    if (p.category !== undefined) next.category = str(p.category, CATEGORY_MAX).replace(/\s+/g, " ");
    items[id] = next;
    bank.items = items;
    store.write(data);
    return { item: itemView(id, next, scanOf(bank), data.emojis) };
}

/** Hide or show a whole bank tab (by its index). Returns `{ bank }` (summary) or `{ error }`. */
function setTabHidden(key, index, hidden) {
    const data = store.read();
    const bank = findBank(data, key);
    if (!bank) return { error: "Gildenbank nicht gefunden." };
    const n = Number(index);
    if (!Number.isInteger(n) || n < 1 || n > 20) return { error: "Unbekannter Bank-Tab." };
    const settings = obj(bank.tabSettings);
    if (hidden) settings[n] = { ...obj(settings[n]), hidden: true };
    else delete settings[n];
    bank.tabSettings = settings;
    store.write(data);
    return { bank: bankView(bank, { items: false }) };
}

/**
 * The name/icon/quality/class Wowhead gave for an item on a version, from any
 * bank that has it — the store doubles as the lookup's persistent cache.
 * Null when no bank of that version has a Wowhead answer for it.
 */
function knownMeta(gameVersion, itemId) {
    const id = String(Number(itemId) || "");
    for (const bank of store.read().banks) {
        if (bank.gameVersion !== gameVersion) continue;
        const it = obj(obj(bank.items)[id]);
        if (it.metaSource === "wowhead" && it.name) return pickMeta(completeItem(it));
    }
    return null;
}

const META_FIELDS = ["name", "icon", "quality", "classId", "subclassId", "className", "subclassName"];

function pickMeta(source) {
    const out = {};
    for (const f of META_FIELDS) out[f] = source[f];
    return out;
}

/** The new meta over the old one; a field the new answer leaves empty keeps its value (an icon from the local tables). */
function mergeMeta(current, next) {
    const out = pickMeta(current);
    for (const f of META_FIELDS) {
        if (next[f] !== "" && next[f] !== null && next[f] !== undefined) out[f] = next[f];
    }
    return out;
}

/**
 * Write an item's meta into every bank of `gameVersion` that has the item.
 * A Wowhead answer replaces whatever was there — the German name always wins
 * over the English one of the local tables; a field it lacks (icon, quality)
 * keeps the local value. Local data only fills an item that has nothing yet.
 * Returns how many banks changed.
 * @param {string} gameVersion
 * @param {number} itemId
 * @param {object} meta { name, icon, quality, classId?, subclassId?, className?, subclassName? }
 * @param {{ source: "local" | "wowhead", now?: number }} opts
 */
function setItemMeta(gameVersion, itemId, meta, { source, now = Date.now() } = {}) {
    if (!META_SOURCES.includes(source) || !source || !meta || !meta.name) return 0;
    const id = String(Number(itemId) || "");
    const data = store.read();
    let changed = 0;
    for (const bank of data.banks) {
        if (bank.gameVersion !== gameVersion) continue;
        const items = obj(bank.items);
        if (!items[id]) continue;
        const current = completeItem(items[id]);
        if (source === "local" && current.metaSource) continue;
        items[id] = completeItem({ ...current, ...mergeMeta(current, completeItem(meta)), metaSource: source, metaAt: now });
        bank.items = items;
        changed += 1;
    }
    if (changed) store.write(data);
    return changed;
}

/** The item ids of a bank that have no Wowhead answer yet (local data or nothing). */
function itemsWithoutWowheadMeta(key) {
    const bank = findBank(store.read(), key);
    if (!bank) return [];
    return Object.entries(obj(bank.items))
        .filter(([, it]) => completeItem(it).metaSource !== "wowhead")
        .map(([id]) => Number(id));
}

/**
 * The items some bank offers ("give") with an icon: `{ [itemId]: icon }` — the
 * items that should have an application emoji. Shared across banks and
 * versions: the first icon found wins (an item id has one icon).
 */
function offeredIcons() {
    const out = {};
    for (const bank of store.read().banks) {
        for (const [id, raw] of Object.entries(obj(bank.items))) {
            const it = completeItem(raw);
            if (it.status === "give" && it.icon && !out[id]) out[id] = it.icon;
        }
    }
    return out;
}

/** The stored application emojis of the items: `{ [itemId]: { id, name, icon, createdAt } }`. */
function itemEmojis() {
    const out = {};
    for (const [id, e] of Object.entries(obj(store.read().emojis))) {
        const emoji = obj(e);
        if (Number(id) > 0 && str(emoji.id)) out[id] = { id: str(emoji.id, 30), name: str(emoji.name, 32), icon: str(emoji.icon, 100), createdAt: num(emoji.createdAt) };
    }
    return out;
}

/** Remember an item's application emoji (`null` forgets it). */
function setItemEmoji(itemId, emoji) {
    const id = String(Number(itemId) || "");
    if (!id) return;
    const data = store.read();
    const emojis = obj(data.emojis);
    if (emoji && emoji.id) {
        emojis[id] = { id: str(emoji.id, 30), name: str(emoji.name, 32), icon: str(emoji.icon, 100), createdAt: num(emoji.createdAt) };
    } else {
        delete emojis[id];
    }
    store.write({ ...data, emojis });
}

module.exports = {
    STATUSES, SETTABLE_STATUSES, RESERVE_MAX, MAX_PER_REQUEST_MAX, CATEGORY_MAX,
    recordScan, getBank, listBanks, listForServer, assignBank, removeBank,
    setItemSettings, setTabHidden, knownMeta, setItemMeta, itemsWithoutWowheadMeta,
    offeredIcons, itemEmojis, setItemEmoji,
    useFile,
};
