// Guild bank requests: a raider asks the orga for mats, potions or enchants from
// the organizer ("Raid-Zentrale", services/signups/guildBank.js), the orga marks
// each one done or declined in Discord.
//
// `data/settings/guild-bank.json` = { requests: [request] }
//
//   request = { id, userId, userName, categoryId (the organizer it came from),
//               item, amount (1–9999), purpose, status: "open" | "done" |
//               "rejected" | "confirmed" | "handedOut", reason (why it was
//               declined), createdAt, handledBy (user id), handledByName, handledAt,
//               channelId, messageId (the post in the orga channel),
//               bankKey, itemId (the stocked item asked for, guildBankStockStore.js;
//               "" / 0 for a free-text request), icon, group (the item's icon and
//               group when it was asked for — the card falls back to them when
//               the bank no longer knows the item),
//               characterName, realm, faction (who receives it in game: the
//               raider's first character of the bank's game version or the one
//               picked; realm and faction default to the bank's),
//               handedOutBy, handedOutByName, handedOutAt,
//               handoutVia: "" | "discord" (the orga's button) | "manual" |
//               "mail" (the addon's hand-out list, #634) }
//
// Status flow of a request from the stock (#633/#634):
//
//   open --confirm--> confirmed --handOut--> handedOut
//     |   <--release--'
//     '--reject--> rejected
//
// A free-text request (no itemId) goes open -> done | rejected as before.
// "confirmed" sets the amount aside (services/guildbank/reservations.js);
// handledBy/handledAt name who confirmed (or declined / marked done).
//
// Handled requests are pruned 90 days after they were handled; open and
// confirmed ones stay until the orga handles them.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { newId } = require("../utils/ids");

const STATUSES = ["open", "done", "rejected", "confirmed", "handedOut"];
/** The statuses that still wait for the orga or the game: never pruned. */
const PENDING_STATUSES = ["open", "confirmed"];
const ITEM_MAX = 80;
const CHARACTER_MAX = 40;
const HANDOUT_VIAS = ["", "discord", "manual", "mail"];
const PURPOSE_MAX = 100;
const REASON_MAX = 200;
const AMOUNT_MIN = 1;
const AMOUNT_MAX = 9999;
/** How many open requests one raider may have at once. */
const MAX_OPEN = 5;
/** How long a handled request is kept. */
const KEEP_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const store = createJsonStore({
    file: settingsPath("guild-bank.json"),
    defaults: () => ({ requests: [] }),
    normalize: (data) => ({
        requests: Array.isArray(data && data.requests) ? data.requests.filter((r) => r && r.id && r.userId) : [],
    }),
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

function complete(r) {
    return {
        id: str(r.id),
        userId: str(r.userId),
        userName: str(r.userName),
        categoryId: str(r.categoryId),
        item: str(r.item).slice(0, ITEM_MAX),
        amount: Number(r.amount) || 0,
        purpose: str(r.purpose).slice(0, PURPOSE_MAX),
        status: STATUSES.includes(r.status) ? r.status : "open",
        reason: str(r.reason).slice(0, REASON_MAX),
        createdAt: Number(r.createdAt) || 0,
        handledBy: str(r.handledBy),
        handledByName: str(r.handledByName),
        handledAt: Number(r.handledAt) || 0,
        channelId: str(r.channelId),
        messageId: str(r.messageId),
        bankKey: str(r.bankKey),
        itemId: Math.max(0, Math.floor(Number(r.itemId) || 0)),
        icon: str(r.icon).slice(0, 100),
        group: str(r.group).slice(0, 60),
        characterName: str(r.characterName).slice(0, CHARACTER_MAX),
        realm: str(r.realm).slice(0, 60),
        faction: str(r.faction).slice(0, 20),
        handedOutBy: str(r.handedOutBy),
        handedOutByName: str(r.handedOutByName),
        handedOutAt: Number(r.handedOutAt) || 0,
        handoutVia: HANDOUT_VIAS.includes(r.handoutVia) ? r.handoutVia : "",
    };
}

/** The amount as typed ("12", " 3 ") as a whole number in range, or 0. */
function parseAmount(raw) {
    const text = str(raw);
    if (!/^\d{1,6}$/.test(text)) return 0;
    const n = Number(text);
    return n >= AMOUNT_MIN && n <= AMOUNT_MAX ? n : 0;
}

/** Check a request's own fields: `{ value: { item, amount, purpose } }` or `{ error }` (German). */
function checkInput(input = {}) {
    const item = str(input.item).replace(/\s+/g, " ");
    if (!item) return { error: "Bitte angeben, was du brauchst." };
    const amount = parseAmount(input.amount);
    if (!amount) return { error: `Die Menge muss eine ganze Zahl von ${AMOUNT_MIN} bis ${AMOUNT_MAX} sein.` };
    return { value: { item: item.slice(0, ITEM_MAX), amount, purpose: str(input.purpose).replace(/\s+/g, " ").slice(0, PURPOSE_MAX) } };
}

/** Open requests first, then the confirmed ones (both oldest first — they wait longest), then the handled ones, newest first. */
const QUEUE_RANK = { open: 0, confirmed: 1 };
function byQueue(a, b) {
    const rankA = QUEUE_RANK[a.status] !== undefined ? QUEUE_RANK[a.status] : 2;
    const rankB = QUEUE_RANK[b.status] !== undefined ? QUEUE_RANK[b.status] : 2;
    if (rankA !== rankB) return rankA - rankB;
    return rankA < 2 ? a.createdAt - b.createdAt : (b.handledAt || b.createdAt) - (a.handledAt || a.createdAt);
}

/** Every request (of one raider, of one status), open first. */
function listRequests({ userId = "", status = "" } = {}) {
    const uid = str(userId);
    return store.read().requests
        .map(complete)
        .filter((r) => (!uid || r.userId === uid) && (!status || r.status === status))
        .sort(byQueue);
}

function getRequest(id) {
    const hit = store.read().requests.find((r) => r.id === str(id));
    return hit ? complete(hit) : null;
}

/**
 * Store a new open request. Checks the fields and the limit of MAX_OPEN open
 * requests per raider. Returns `{ request }` or `{ error }` (German).
 */
function addRequest(input = {}, { now = Date.now() } = {}) {
    const userId = str(input.userId);
    if (!userId) return { error: "Kein Raider." };
    const checked = checkInput(input);
    if (checked.error) return checked;
    const data = store.read();
    const open = data.requests.filter((r) => str(r.userId) === userId && (r.status || "open") === "open").length;
    if (open >= MAX_OPEN) return { error: `Höchstens ${MAX_OPEN} offene Anfragen – warte, bis die Orga eine erledigt hat.` };
    const request = complete({
        ...checked.value, id: newId(), userId, userName: input.userName, categoryId: input.categoryId, status: "open", createdAt: now,
        bankKey: input.bankKey, itemId: input.itemId, icon: input.icon, group: input.group,
        characterName: input.characterName, realm: input.realm, faction: input.faction,
    });
    data.requests.push(request);
    store.write(data);
    return { request };
}

/** Remember where the orga post of a request is. Returns the request or null. */
function setMessage(id, { channelId = "", messageId = "" } = {}) {
    const data = store.read();
    const hit = data.requests.find((r) => r.id === str(id));
    if (!hit) return null;
    hit.channelId = str(channelId);
    hit.messageId = str(messageId);
    store.write(data);
    return complete(hit);
}

/**
 * Mark an open request done or declined. Returns `{ request }`, or `{ error,
 * request? }` — with the request when it was handled before.
 */
function resolveRequest(id, { status, by = "", byName = "", reason = "" } = {}, { now = Date.now() } = {}) {
    if (status !== "done" && status !== "rejected") return { error: "Unbekannter Status." };
    const data = store.read();
    const hit = data.requests.find((r) => r.id === str(id));
    if (!hit) return { error: "Anfrage nicht gefunden." };
    if ((hit.status || "open") !== "open") return { error: "Diese Anfrage ist schon erledigt.", request: complete(hit) };
    // a request from the stock is confirmed and handed out, never just "done"
    if (status === "done" && complete(hit).itemId) return { error: "Diese Anfrage ist noch nicht vorgemerkt.", request: complete(hit) };
    Object.assign(hit, {
        status,
        reason: status === "rejected" ? str(reason).replace(/\s+/g, " ").slice(0, REASON_MAX) : "",
        handledBy: str(by),
        handledByName: str(byName),
        handledAt: now,
    });
    store.write(data);
    return { request: complete(hit) };
}

/** Why a request of the stock cannot move on, by the state it is in (German). */
const STATE_ERRORS = {
    open: "Diese Anfrage ist noch nicht vorgemerkt.",
    confirmed: "Diese Anfrage ist schon vorgemerkt.",
    handedOut: "Diese Anfrage ist schon ausgegeben.",
};

/**
 * Move a request of the stock from `from` to `to` with `patch`. Returns
 * `{ request }`, or `{ error, request? }` (German) — with the request when it
 * is in another state (or a free-text one).
 */
function transition(id, from, to, patch) {
    const data = store.read();
    const hit = data.requests.find((r) => r.id === str(id));
    if (!hit) return { error: "Anfrage nicht gefunden." };
    if (!complete(hit).itemId) return { error: "Diese Anfrage ist keine aus dem Bestand.", request: complete(hit) };
    const status = hit.status || "open";
    if (status !== from) return { error: STATE_ERRORS[status] || "Diese Anfrage ist schon erledigt.", request: complete(hit) };
    Object.assign(hit, patch, { status: to });
    store.write(data);
    return { request: complete(hit) };
}

/** Confirm an open request of the stock: its amount is set aside until the hand-out. */
function confirmRequest(id, { by = "", byName = "" } = {}, { now = Date.now() } = {}) {
    return transition(id, "open", "confirmed", { handledBy: str(by), handledByName: str(byName), handledAt: now, reason: "" });
}

/** Take a confirmation back: the request is open again, nothing set aside. */
function releaseRequest(id) {
    return transition(id, "confirmed", "open", { handledBy: "", handledByName: "", handledAt: 0 });
}

/**
 * A confirmed request was handed out in game — by the orga's button
 * (`via: "discord"`) or the addon's hand-out list ("manual" | "mail", #634).
 * A second report of the same request is refused with the request, so a
 * caller can ignore it (idempotent).
 */
function handOutRequest(id, { by = "", byName = "", via = "discord" } = {}, { now = Date.now() } = {}) {
    return transition(id, "confirmed", "handedOut", {
        handedOutBy: str(by),
        handedOutByName: str(byName),
        handedOutAt: now,
        handoutVia: via && HANDOUT_VIAS.includes(via) ? via : "discord",
    });
}

/** Remove a request (a post that never reached the channel). Returns the removed request or null. */
function removeRequest(id) {
    const data = store.read();
    const hit = data.requests.find((r) => r.id === str(id));
    if (!hit) return null;
    data.requests = data.requests.filter((r) => r !== hit);
    store.write(data);
    return complete(hit);
}

/** Drop handled requests handled more than `days` ago (open and confirmed ones stay). Returns how many were dropped. */
function prune({ now = Date.now(), days = KEEP_DAYS } = {}) {
    const limit = now - days * DAY_MS;
    const data = store.read();
    const kept = data.requests.filter((r) => PENDING_STATUSES.includes(r.status || "open") || (Number(r.handledAt) || Number(r.createdAt) || 0) >= limit);
    const dropped = data.requests.length - kept.length;
    if (dropped) store.write({ ...data, requests: kept });
    return dropped;
}

/**
 * Give the pending (open / confirmed) requests of a stocked item the item's
 * current name — the bank's item names turned English (guildBankStockStore
 * META_VERSION 2). Handled requests keep the name they were handled with.
 * Returns the ids of the requests that changed.
 * @param {{ bankKeys: string[], itemId: number, name: string }} o
 */
function renamePendingItem({ bankKeys = [], itemId = 0, name = "" } = {}) {
    const keys = new Set((bankKeys || []).map(str).filter(Boolean));
    const id = Math.max(0, Math.floor(Number(itemId) || 0));
    const next = str(name).replace(/\s+/g, " ").slice(0, ITEM_MAX);
    if (!keys.size || !id || !next) return [];
    const data = store.read();
    const changed = [];
    for (const r of data.requests) {
        const c = complete(r);
        if (!PENDING_STATUSES.includes(c.status) || c.itemId !== id || !keys.has(c.bankKey) || c.item === next) continue;
        r.item = next;
        changed.push(c.id);
    }
    if (changed.length) store.write(data);
    return changed;
}

module.exports = {
    STATUSES, PENDING_STATUSES, HANDOUT_VIAS, ITEM_MAX, PURPOSE_MAX, REASON_MAX, AMOUNT_MIN, AMOUNT_MAX, MAX_OPEN, KEEP_DAYS,
    parseAmount, checkInput, listRequests, getRequest, addRequest, setMessage, resolveRequest,
    confirmRequest, releaseRequest, handOutRequest, removeRequest, prune, renamePendingItem,
    useFile,
};
