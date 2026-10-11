// The guild bank's waiting list (#775): every item on "give" has one per bank
// (bankKey + itemId), whatever category the request came from. A raider who
// asks for more than is free gets the free part as an open request and the
// rest waits; while somebody waits for an item, a new request waits behind
// them in full (strict order). The entries are requests with status "waiting"
// in stores/guildBankStore.js, ordered by `queueRank`.
//
//   free      stockView's `free` = Verfügbar minus the open (not yet confirmed)
//             requests of the item — an open request is promised already, so a
//             second scan never hands the same amount out twice. 0 for an item
//             that is not requestable (not "give", or only in hidden tabs).
//   allocate  the pure core: the queue in order and what is free → who gets
//             how much. The first gets as much as is free up to what they
//             asked for; only when they are served in full does the next get
//             anything. A part leaves the rest waiting at the same place.
//   promote   allocate + guildBankStore.promoteWaiting: the entries move up to
//             open requests (`fromWaitlist`), synchronously — two triggers at
//             once never share out the same amount. Posting the orga card and
//             the raider's DM is services/signups/guildBank.advanceWaitlist.
//
// The orga keeps the list in the web (apiRoutes/guildBank.js, "Warteliste"):
// add an entry, move it up or down, remove it, or import lines pasted from a
// sheet ("Name<Tab>Item<Tab>Anzahl", also ; or ,). A name is matched to a
// raider by the characters in the raider profiles (no case, no accents —
// "alina" finds "Alîna"); an unmatched name is imported as a character alone
// (`userId: ""`, no DM). An unknown item is never imported. A typo in the item
// name is forgiven (, findItem): the one item within two letters (and a
// fifth of the name) is taken, the preview marks the row `fuzzy`.
const store = require("../../stores/guildBankStore");
const stockStore = require("../../stores/guildBankStockStore");
const profiles = require("../../stores/raiderProfileStore");
const stockView = require("./stockView");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** At most this many lines are read from one import. */
const IMPORT_MAX_LINES = 200;

/**
 * Who of a queue gets how much of `free` — strictly in order: the first as
 * much as they asked for (or what is free), the next only when the first is
 * served in full.
 * @param {{ id: string, amount: number }[]} queue first in line first
 * @param {number} free
 * @returns {{ id: string, amount: number, full: boolean }[]}
 */
function allocate(queue, free) {
    let left = Math.max(0, Math.floor(Number(free) || 0));
    const out = [];
    for (const entry of queue || []) {
        if (left <= 0) break;
        const want = Math.max(0, Math.floor(Number(entry.amount) || 0));
        if (!want) continue;
        const take = Math.min(want, left);
        out.push({ id: entry.id, amount: take, full: take === want });
        left -= take;
        if (take < want) break;
    }
    return out;
}

/** What a new request or the waiting list may still get of an item now (0 when it is not requestable). */
function freeOf(bankKey, itemId) {
    const item = stockView.stockItem(bankKey, itemId);
    return item && stockView.isRequestable(item) ? item.free : 0;
}

/**
 * Move the first of one item's waiting list up as far as the stock goes.
 * Returns what moved: `[{ request (now open), rest (still waiting or null) }]`.
 */
function promoteItem(bankKey, itemId, { now = Date.now() } = {}) {
    const queue = store.waitingQueue(bankKey, itemId);
    if (!queue.length) return [];
    const moved = [];
    for (const { id, amount } of allocate(queue, freeOf(bankKey, itemId))) {
        const result = store.promoteWaiting(id, amount, { now });
        if (result.request) moved.push(result);
    }
    return moved;
}

/** promoteItem for every item of a bank that has a waiting list (or only `itemId`). */
function promoteBank(bankKey, { itemId = 0, now = Date.now() } = {}) {
    const ids = itemId ? [Math.floor(Number(itemId) || 0)] : [...new Set(store.waitingQueue(bankKey).map((r) => r.itemId))];
    return ids.flatMap((id) => promoteItem(bankKey, id, { now }));
}

/** A bank's waiting list for the web, each entry with its place (1 = next) in its item's queue. */
function listForBank(bankKey) {
    const places = new Map();
    return store.waitingQueue(bankKey).map((r) => {
        const place = (places.get(r.itemId) || 0) + 1;
        places.set(r.itemId, place);
        return { ...r, position: place };
    });
}

/** The place (1 = next) a waiting entry has in its item's queue, 0 when it waits no more. */
function positionOf(request) {
    if (!request) return 0;
    const at = store.waitingQueue(request.bankKey, request.itemId).findIndex((r) => r.id === request.id);
    return at + 1;
}

/** A name as it is compared: no case, no accents, no outer spaces ("Alîna" → "alina"). */
function foldName(name) {
    return str(name).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").toLowerCase();
}

/** One pasted line as its fields: tab-separated (a sheet), else by ";", else by ",". */
function splitLine(line) {
    const sep = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
    const parts = line.split(sep).map((p) => p.trim());
    while (parts.length && !parts[parts.length - 1]) parts.pop();
    return parts;
}

/**
 * The pasted text as rows: `{ line (1-based), name, itemText, amount, error }`.
 * "Name<sep>Item<sep>Anzahl"; a missing amount is 1; an item name with commas
 * survives (the first field is the name, a last field that is a number the
 * amount, the rest the item). Empty lines are skipped. `error` (German) only
 * for a line that cannot be read at all.
 * @param {string} text
 */
function parseImport(text) {
    const rows = [];
    String(text || "").split(/\r?\n/).slice(0, IMPORT_MAX_LINES).forEach((raw, i) => {
        if (!raw.trim()) return;
        const parts = splitLine(raw);
        const name = parts[0] || "";
        let amountText = "";
        let rest = parts.slice(1);
        if (rest.length > 1 && /^\d+$/.test(rest[rest.length - 1])) {
            amountText = rest[rest.length - 1];
            rest = rest.slice(0, -1);
        }
        const itemText = rest.join(", ").trim();
        const amount = amountText ? store.parseAmount(amountText) : 1;
        let error = "";
        if (!name || !itemText) error = "Name und Gegenstand fehlen.";
        else if (!amount) error = `Die Menge muss eine ganze Zahl von ${store.AMOUNT_MIN} bis ${store.AMOUNT_MAX} sein.`;
        rows.push({ line: i + 1, name: name.slice(0, 40), itemText: itemText.slice(0, store.ITEM_MAX), amount, error });
    });
    return rows;
}

/** The edit distance (insert, delete, replace one letter) of two strings. */
function levenshtein(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) {
            row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = row;
    }
    return prev[b.length];
}

/** How many wrong letters a typed name may have: 2 at most and about a fifth of its length (none under 5 letters). */
const typoLimit = (key) => Math.min(2, Math.floor(key.length * 0.2));

/**
 * The bank item a typed name (or id) means — no case, no accents. No exact
 * name: the one item with the smallest edit distance, within typoLimit and
 * only when no other item is as close ("Crimson Spinal" -> "Crimson Spinel").
 * `{ item, fuzzy }` — `item` null when nothing fits.
 */
function findItem(itemText, items) {
    const text = str(itemText);
    const list = items || [];
    if (/^\d+$/.test(text)) return { item: list.find((it) => it.itemId === Number(text)) || null, fuzzy: false };
    const key = foldName(text);
    if (!key) return { item: null, fuzzy: false };
    const exact = list.find((it) => foldName(it.name) === key);
    if (exact) return { item: exact, fuzzy: false };
    const limit = typoLimit(key);
    if (!limit) return { item: null, fuzzy: false };
    let best = [];
    let bestDistance = limit + 1;
    for (const it of list) {
        const name = foldName(it.name);
        if (!name || Math.abs(name.length - key.length) > limit) continue;
        const d = levenshtein(key, name);
        if (d < bestDistance) {
            bestDistance = d;
            best = [it];
        } else if (d === bestDistance) {
            best.push(it);
        }
    }
    return best.length === 1 ? { item: best[0], fuzzy: true } : { item: null, fuzzy: false };
}

/** The bank item a typed name (or id) means (also a near miss, see findItem), or null. */
function matchItem(itemText, items) {
    return findItem(itemText, items).item;
}

/**
 * The raider whose profile has a character of that name: a character of the
 * bank's game version first, then any. `{ userId, userName, characterName,
 * realm }`, or `{ ambiguous: true }` when characters of several raiders carry
 * the name, or null.
 */
function matchCharacter(name, gameVersion = "", list = profiles.listProfiles()) {
    const key = foldName(name);
    if (!key) return null;
    const hits = (versionOnly) => {
        const found = [];
        for (const p of list) {
            const c = (p.characters || []).find((ch) => foldName(ch.name) === key
                && (!versionOnly || profiles.charactersOfVersion({ characters: [ch] }, gameVersion).length));
            if (c) found.push({ userId: p.userId, userName: p.name || c.name, characterName: c.name, realm: c.realm || "" });
        }
        return found;
    };
    const found = gameVersion ? hits(true) : [];
    const all = found.length ? found : hits(false);
    if (all.length > 1) return { ambiguous: true };
    return all[0] || null;
}

/**
 * The import's preview for one bank: every pasted row with the item it found
 * (`item: { itemId, name, iconUrl } | null`, `itemError` when it is not
 * offered) and the raider (`match`, null = imported as a character alone).
 * `ok` = the row will be imported.
 */
function previewImport(bankKey, text) {
    const bank = stockStore.getBank(bankKey);
    if (!bank) return { rows: [] };
    const list = profiles.listProfiles();
    const rows = parseImport(text).map((row) => {
        const found = row.error ? { item: null, fuzzy: false } : findItem(row.itemText, bank.items);
        const raw = found.item;
        const item = raw ? stockView.stockItem(bank.key, raw.itemId) : null;
        let itemError = "";
        if (!row.error && !item) itemError = "Unbekannter Gegenstand.";
        else if (item && !stockView.isRequestable(item)) itemError = "Nicht ausgebbar.";
        const match = row.error ? null : matchCharacter(row.name, bank.gameVersion, list);
        return {
            ...row,
            item: item ? { itemId: item.itemId, name: item.name || `Item ${item.itemId}`, iconUrl: item.iconUrl || "" } : null,
            itemError,
            fuzzy: !!(item && found.fuzzy),
            match: match && !match.ambiguous ? match : null,
            ambiguous: !!(match && match.ambiguous),
            ok: !row.error && !itemError,
        };
    });
    return { rows };
}

/** The fields of a waiting entry for a matched raider or a bare character name. */
function entryFor(bank, item, { name, match, amount, by, byName }) {
    return {
        userId: match ? match.userId : "",
        userName: match ? match.userName : str(name),
        characterName: match ? match.characterName : str(name),
        realm: (match && match.realm) || bank.realm || "",
        faction: bank.faction || "",
        bankKey: bank.key, itemId: item.itemId, item: item.name || `Item ${item.itemId}`, icon: item.icon, group: item.group,
        amount, addedBy: str(by) || "web", addedByName: byName,
    };
}

/**
 * Import the pasted lines of one bank: every row the preview marks `ok` goes
 * to the end of its item's list, in the order of the lines. Returns
 * `{ added: [request], skipped: number }` or `{ error }` (German).
 */
function importLines(bankKey, text, { by = "", byName = "", now = Date.now() } = {}) {
    const bank = stockStore.getBank(bankKey);
    if (!bank) return { error: "Gildenbank nicht gefunden." };
    const { rows } = previewImport(bankKey, text);
    if (!rows.length) return { error: "Keine Zeile zum Importieren." };
    const added = [];
    let skipped = 0;
    rows.forEach((row, i) => {
        if (!row.ok) {
            skipped += 1;
            return;
        }
        const item = stockView.stockItem(bank.key, row.item.itemId);
        // one millisecond apart: the order of the lines stays the order of the list
        const result = store.addWaiting(entryFor(bank, item, { name: row.name, match: row.match, amount: row.amount, by, byName }), { now: now + i });
        if (result.request) added.push(result.request);
        else skipped += 1;
    });
    return { added, skipped };
}

/**
 * The orga adds one entry in the web: a name (matched like the import), an
 * offered item of the bank and the amount. Returns `{ request }` or `{ error }`.
 */
function addEntry(bankKey, { name = "", itemId = 0, amount = 0, by = "", byName = "" } = {}, { now = Date.now() } = {}) {
    const bank = stockStore.getBank(bankKey);
    if (!bank) return { error: "Gildenbank nicht gefunden." };
    if (!str(name)) return { error: "Bitte einen Namen angeben." };
    const item = stockView.stockItem(bank.key, itemId);
    if (!item || !stockView.isRequestable(item)) return { error: "Diesen Gegenstand gibt die Bank nicht aus." };
    const n = store.parseAmount(amount);
    if (!n) return { error: `Die Menge muss eine ganze Zahl von ${store.AMOUNT_MIN} bis ${store.AMOUNT_MAX} sein.` };
    const match = matchCharacter(name, bank.gameVersion);
    return store.addWaiting(entryFor(bank, item, { name, match: match && !match.ambiguous ? match : null, amount: n, by, byName }), { now });
}

module.exports = {
    IMPORT_MAX_LINES, allocate, freeOf, promoteItem, promoteBank, listForBank, positionOf,
    foldName, levenshtein, parseImport, findItem, matchItem, matchCharacter, previewImport, importLines, addEntry,
};
