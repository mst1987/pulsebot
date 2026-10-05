// Guild bank requests: a raider asks the orga for mats, potions or enchants from
// the organizer ("Raid-Zentrale", services/signups/guildBank.js), the orga marks
// each one done or declined in Discord.
//
// `data/settings/guild-bank.json` = { requests: [request] }
//
//   request = { id, userId, userName, categoryId (the organizer it came from),
//               item, amount (1–9999), purpose, status: "open" | "done" |
//               "rejected", reason (why it was declined), createdAt,
//               handledBy (user id), handledByName, handledAt,
//               channelId, messageId (the post in the orga channel) }
//
// Handled requests are pruned 90 days after they were handled; open ones stay
// until the orga handles them.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { newId } = require("../utils/ids");

const STATUSES = ["open", "done", "rejected"];
const ITEM_MAX = 80;
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

/** Open requests first (oldest first — they wait longest), then the handled ones, newest first. */
function byQueue(a, b) {
    const openA = a.status === "open" ? 0 : 1;
    const openB = b.status === "open" ? 0 : 1;
    if (openA !== openB) return openA - openB;
    return openA === 0 ? a.createdAt - b.createdAt : (b.handledAt || b.createdAt) - (a.handledAt || a.createdAt);
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

/** How many open requests a raider has. */
function countOpen(userId) {
    return listRequests({ userId, status: "open" }).length;
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

/** Remove a request (a post that never reached the channel). Returns the removed request or null. */
function removeRequest(id) {
    const data = store.read();
    const hit = data.requests.find((r) => r.id === str(id));
    if (!hit) return null;
    data.requests = data.requests.filter((r) => r !== hit);
    store.write(data);
    return complete(hit);
}

/** Drop handled requests handled more than `days` ago. Returns how many were dropped. */
function prune({ now = Date.now(), days = KEEP_DAYS } = {}) {
    const limit = now - days * DAY_MS;
    const data = store.read();
    const kept = data.requests.filter((r) => (r.status || "open") === "open" || (Number(r.handledAt) || Number(r.createdAt) || 0) >= limit);
    const dropped = data.requests.length - kept.length;
    if (dropped) store.write({ ...data, requests: kept });
    return dropped;
}

module.exports = {
    STATUSES, ITEM_MAX, PURPOSE_MAX, REASON_MAX, AMOUNT_MIN, AMOUNT_MAX, MAX_OPEN, KEEP_DAYS,
    parseAmount, checkInput, listRequests, getRequest, countOpen, addRequest, setMessage, resolveRequest, removeRequest, prune,
    useFile,
};
