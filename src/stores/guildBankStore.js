// Guild bank requests: a raider asks the orga for mats, potions or enchants from
// the organizer ("Raid-Zentrale", services/signups/guildBank.js), the orga marks
// each one done or declined in Discord.
//
// `data/settings/guild-bank.json` = { requests: [request] }
//
//   request = { id, userId (""  only for a waiting-list entry the orga imported
//               by character name, and the request it moves up to — until the
//               orga links a profile character, setRecipient), userName,
//               categoryId (the organizer it came from),
//               item, amount (1–9999), purpose, status: "waiting" | "open" |
//               "done" | "rejected" | "confirmed" | "handedOut", reason (why it
//               was declined), createdAt, handledBy (user id), handledByName, handledAt,
//               queueRank (a waiting entry's place in its item's queue: lowest
//               first; 0 for every other status), fromWaitlist (an open request
//               that moved up from the waiting list), addedBy, addedByName (the
//               orga member who added or imported a waiting entry; "" = the raider),
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
//               "mail" (the addon's hand-out list, #634),
//               recipientCheckedBy, recipientCheckedByName, recipientCheckedAt
//               (#806: the orga vouched for this recipient — confirmed the
//               request, or checked the name in game; services/guildbank/
//               linking.js counts it as evidence. Kept when a confirmation is
//               released, cleared when the recipient changes, setRecipient.
//               A request confirmed before #806 has no such field: read as
//               checked by whoever confirmed it, recipientCheckOf) }
//
// Status flow of a request from the stock (#633/#634, waiting list #775):
//
//   waiting --promote--> open --confirm--> confirmed --handOut--> handedOut
//      |                  |   <--release--'
//      '--remove          '--reject--> rejected
//
// One waiting list per bank and item (bankKey + itemId), whatever category the
// request came from, ordered by queueRank. promoteWaiting moves an entry up
// (services/guildbank/waitlist.js decides who and how much): all of it turns
// the entry into an open request; a part becomes a new open request and the
// rest stays waiting with the same rank — nobody is passed over.
// A free-text request (no itemId) goes open -> done | rejected as before.
// "confirmed" sets the amount aside (services/guildbank/reservations.js);
// handledBy/handledAt name who confirmed (or declined / marked done).
//
// Handled requests are pruned 90 days after they were handled; waiting, open
// and confirmed ones stay until the orga handles them.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");
const { newId } = require("../utils/ids");

const STATUSES = ["waiting", "open", "done", "rejected", "confirmed", "handedOut"];
/** The statuses that still wait for the orga, the stock or the game: never pruned. */
const PENDING_STATUSES = ["waiting", "open", "confirmed"];
const ITEM_MAX = 80;
const CHARACTER_MAX = 40;
const HANDOUT_VIAS = ["", "discord", "manual", "mail"];
const PURPOSE_MAX = 100;
const REASON_MAX = 200;
const AMOUNT_MIN = 1;
const AMOUNT_MAX = 9999;
/** How many open requests one raider may have at once — checked for a new request only; moving up from the waiting list never fails on it. */
const MAX_OPEN = 5;
/** How many waiting-list entries one raider may have at once (the orga's own entries are not limited). */
const MAX_WAITING = 10;
/** How long a handled request is kept. */
const KEEP_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const store = createJsonStore({
    file: settingsPath("guild-bank.json"),
    defaults: () => ({ requests: [] }),
    normalize: (data) => ({
        // a request belongs to a raider — or, imported by the orga, to a character name alone
        requests: Array.isArray(data && data.requests) ? data.requests.filter((r) => r && r.id && (r.userId || r.characterName)) : [],
    }),
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/**
 * Who vouched for a stored request's recipient (#806): its own fields, or —
 * a request confirmed before they existed — whoever confirmed it. The orga's
 * confirmation was its word for that recipient under the rules of the day;
 * #782/#792 must not take it back, or the addon's list drops it silently.
 */
function recipientCheckOf(r) {
    if (r.recipientCheckedAt !== undefined) {
        return { by: str(r.recipientCheckedBy), byName: str(r.recipientCheckedByName), at: Number(r.recipientCheckedAt) || 0 };
    }
    if (r.status === "confirmed") return { by: str(r.handledBy), byName: str(r.handledByName), at: Number(r.handledAt) || 1 };
    return { by: "", byName: "", at: 0 };
}

function complete(r) {
    const checked = recipientCheckOf(r);
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
        queueRank: r.status === "waiting" ? Math.max(0, Number(r.queueRank) || 0) : 0,
        fromWaitlist: r.fromWaitlist === true,
        addedBy: str(r.addedBy),
        addedByName: str(r.addedByName),
        recipientCheckedBy: checked.by,
        recipientCheckedByName: checked.byName,
        recipientCheckedAt: checked.at,
    };
}

/** The fields of a vouch for the recipient (`at` 0 = none). */
const checkFields = (by, byName, at) => ({ recipientCheckedBy: str(by), recipientCheckedByName: str(byName), recipientCheckedAt: Number(at) || 0 });

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

/**
 * Open requests first, then the confirmed ones (both oldest first — they wait
 * longest), then the waiting-list entries (by their place in the queue), then
 * the handled ones, newest first.
 */
const QUEUE_RANK = { open: 0, confirmed: 1, waiting: 2 };
const HANDLED_RANK = 3;
function byQueue(a, b) {
    const rankA = QUEUE_RANK[a.status] !== undefined ? QUEUE_RANK[a.status] : HANDLED_RANK;
    const rankB = QUEUE_RANK[b.status] !== undefined ? QUEUE_RANK[b.status] : HANDLED_RANK;
    if (rankA !== rankB) return rankA - rankB;
    if (rankA === QUEUE_RANK.waiting) return a.queueRank - b.queueRank || a.createdAt - b.createdAt;
    return rankA < HANDLED_RANK ? a.createdAt - b.createdAt : (b.handledAt || b.createdAt) - (a.handledAt || a.createdAt);
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

/** How many open requests a raider has now. */
function openCount(userId) {
    const uid = str(userId);
    return uid ? store.read().requests.filter((r) => str(r.userId) === uid && (r.status || "open") === "open").length : 0;
}

/** How many waiting-list entries a raider has now. */
function waitingCount(userId) {
    const uid = str(userId);
    return uid ? store.read().requests.filter((r) => str(r.userId) === uid && r.status === "waiting").length : 0;
}

const sameItem = (r, bankKey, itemId) => str(r.bankKey) === str(bankKey) && Math.floor(Number(r.itemId) || 0) === Math.floor(Number(itemId) || 0);

/**
 * The waiting list of one bank item, first in line first — or of the whole
 * bank without `itemId` (each item's queue in order, items by id).
 */
function waitingQueue(bankKey, itemId = 0) {
    const key = str(bankKey);
    if (!key) return [];
    return store.read().requests
        .map(complete)
        .filter((r) => r.status === "waiting" && r.bankKey === key && r.itemId > 0 && (!itemId || r.itemId === Math.floor(Number(itemId) || 0)))
        .sort((a, b) => a.itemId - b.itemId || a.queueRank - b.queueRank || a.createdAt - b.createdAt);
}

/**
 * Put a request from the stock at the end of its item's waiting list. A
 * raider's own entry (`userId`, no `addedBy`) counts against MAX_WAITING; the
 * orga's entries (added or imported in the web) may name only a character
 * (`userId: ""`) and are not limited. Returns `{ request }` or `{ error }` (German).
 */
function addWaiting(input = {}, { now = Date.now() } = {}) {
    const userId = str(input.userId);
    const characterName = str(input.characterName).slice(0, CHARACTER_MAX);
    if (!userId && !characterName) return { error: "Kein Raider und kein Charakter." };
    const bankKey = str(input.bankKey);
    const itemId = Math.max(0, Math.floor(Number(input.itemId) || 0));
    if (!bankKey || !itemId) return { error: "Nur Gegenstände aus dem Bestand haben eine Warteliste." };
    const checked = checkInput(input);
    if (checked.error) return checked;
    const data = store.read();
    const byOrga = !!str(input.addedBy);
    if (userId && !byOrga) {
        const waiting = data.requests.filter((r) => str(r.userId) === userId && r.status === "waiting").length;
        if (waiting >= MAX_WAITING) return { error: `Höchstens ${MAX_WAITING} Einträge auf der Warteliste – warte, bis einer drankommt.` };
    }
    const last = data.requests
        .filter((r) => r.status === "waiting" && sameItem(r, bankKey, itemId))
        .reduce((max, r) => Math.max(max, Number(r.queueRank) || 0), 0);
    const request = complete({
        ...checked.value, id: newId(), userId, userName: input.userName || (userId ? "" : characterName), categoryId: input.categoryId,
        status: "waiting", createdAt: now, queueRank: last + 1,
        bankKey, itemId, icon: input.icon, group: input.group,
        characterName, realm: input.realm, faction: input.faction,
        addedBy: input.addedBy, addedByName: input.addedByName,
    });
    data.requests.push(request);
    store.write(data);
    return { request };
}

/**
 * Move a waiting entry up: `amount` of it becomes an open request
 * (`fromWaitlist`, created now). All of it: the entry itself turns open; a
 * part: a new open request, the rest keeps waiting at the same place.
 * Never limited by MAX_OPEN. Returns `{ request (the open one), rest (the
 * entry still waiting, or null) }` or `{ error }`.
 */
function promoteWaiting(id, amount, { now = Date.now() } = {}) {
    const data = store.read();
    const hit = data.requests.find((r) => r.id === str(id));
    if (!hit || hit.status !== "waiting") return { error: "Kein Eintrag der Warteliste." };
    const total = Number(hit.amount) || 0;
    const take = Math.min(total, Math.max(0, Math.floor(Number(amount) || 0)));
    if (!take) return { error: "Nichts zu verteilen." };
    if (take >= total) {
        Object.assign(hit, { status: "open", queueRank: 0, fromWaitlist: true, createdAt: now });
        store.write(data);
        return { request: complete(hit), rest: null };
    }
    hit.amount = total - take;
    const request = complete({ ...complete(hit), id: newId(), amount: take, status: "open", queueRank: 0, fromWaitlist: true, createdAt: now });
    data.requests.push(request);
    store.write(data);
    return { request, rest: complete(hit) };
}

/**
 * Swap a waiting entry with its neighbour in the same item's queue
 * (`direction` "up" = one place forward). Returns `{ request }` or `{ error }`;
 * the first moved up (or the last down) stays where it is.
 */
function moveWaiting(id, direction) {
    if (direction !== "up" && direction !== "down") return { error: "Unbekannte Richtung." };
    const data = store.read();
    const hit = data.requests.find((r) => r.id === str(id));
    if (!hit || hit.status !== "waiting") return { error: "Kein Eintrag der Warteliste." };
    const queue = data.requests
        .filter((r) => r.status === "waiting" && sameItem(r, hit.bankKey, hit.itemId))
        .sort((a, b) => (Number(a.queueRank) || 0) - (Number(b.queueRank) || 0) || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
    const at = queue.indexOf(hit);
    const other = queue[direction === "up" ? at - 1 : at + 1];
    if (!other) return { request: complete(hit) };
    // ranks as places 1..n first (equal or missing ranks of old data), then swap
    queue.forEach((r, i) => { r.queueRank = i + 1; });
    [hit.queueRank, other.queueRank] = [other.queueRank, hit.queueRank];
    store.write(data);
    return { request: complete(hit) };
}

/** Take a waiting entry off its list. Returns the removed entry or null (also for a request that is no entry). */
function removeWaiting(id) {
    const hit = getRequest(id);
    return hit && hit.status === "waiting" ? removeRequest(hit.id) : null;
}

/**
 * Give a pending request (waiting, open or confirmed) a new recipient: the
 * raider and the character the orga linked it to in the web
 * (services/guildbank/linking.js). Handled requests keep theirs. Returns
 * `{ request }` or `{ error }` (German).
 */
function setRecipient(id, { userId = "", userName = "", characterName = "", realm = "" } = {}) {
    const name = str(characterName).slice(0, CHARACTER_MAX);
    if (!str(userId) || !name) return { error: "Kein Raider und kein Charakter." };
    const data = store.read();
    const hit = data.requests.find((r) => r.id === str(id));
    if (!hit) return { error: "Anfrage nicht gefunden." };
    if (!PENDING_STATUSES.includes(hit.status || "open")) return { error: "Diese Anfrage ist schon erledigt.", request: complete(hit) };
    // a new recipient: whatever the orga vouched for was the old one (#806)
    Object.assign(hit, { userId: str(userId), userName: str(userName) || name, characterName: name, realm: str(realm).slice(0, 60) }, checkFields("", "", 0));
    store.write(data);
    return { request: complete(hit) };
}

/**
 * The orga gives a pending request another character name (#809, "Charakter
 * ändern …" on the card, a free name in the web): the raider (`userId`, the
 * DMs) stays, only who receives it in game changes. `checked` = the orga
 * vouches for the new name (found it in game), else no vouch — it was for the
 * old name. The name is stored as given; the caller checks it. Returns
 * `{ request }` or `{ error, request? }` (German).
 */
function setRecipientName(id, { characterName = "", realm = "", by = "", byName = "", checked = false } = {}, { now = Date.now() } = {}) {
    const name = str(characterName).replace(/\s+/g, " ").slice(0, CHARACTER_MAX);
    if (!name) return { error: "Bitte einen Namen angeben." };
    const data = store.read();
    const hit = data.requests.find((r) => r.id === str(id));
    if (!hit) return { error: "Anfrage nicht gefunden." };
    if (!PENDING_STATUSES.includes(hit.status || "open")) return { error: "Diese Anfrage ist schon erledigt.", request: complete(hit) };
    const patch = { characterName: name, realm: str(realm).slice(0, 60) };
    // an entry without a Discord account is called by its character
    if (!str(hit.userId)) patch.userName = name;
    Object.assign(hit, patch, checked ? checkFields(by, byName, now) : checkFields("", "", 0));
    store.write(data);
    return { request: complete(hit) };
}

/**
 * A raider's character got another name (raiderProfileStore.editCharacter): his
 * pending requests (waiting, open, confirmed) for it go to the new name and
 * realm. Handled ones keep theirs — that is who got it. A vouch for the old
 * name does not carry over (#806), the same as setRecipientName without
 * `checked`. `nameKey` is the old name in lower case without realm.
 * @returns {number} how many requests changed
 */
function renameRecipient(userId, nameKey, { characterName = "", realm = "" } = {}) {
    const uid = str(userId);
    const from = str(nameKey).toLowerCase();
    const name = str(characterName).replace(/\s+/g, " ").slice(0, CHARACTER_MAX);
    if (!uid || !from || !name) return 0;
    const data = store.read();
    let changed = 0;
    for (const r of data.requests) {
        if (str(r.userId) !== uid || !PENDING_STATUSES.includes(r.status || "open")) continue;
        if (str(r.characterName).toLowerCase().split("-")[0] !== from) continue;
        Object.assign(r, { characterName: name, ...(str(realm) ? { realm: str(realm).slice(0, 60) } : {}) }, checkFields("", "", 0));
        changed += 1;
    }
    if (changed) store.write(data);
    return changed;
}

/**
 * The orga vouches for a pending request's recipient (#806): it checked the
 * name in game ("Im Spiel geprüft" in the web, "Geprüft & bestätigen" on the
 * card) — the addon may mail to it although no raider profile confirms it
 * (a raider without a Discord account has none). Returns `{ request }` or
 * `{ error, request? }` (German).
 */
function checkRecipient(id, { by = "", byName = "" } = {}, { now = Date.now() } = {}) {
    const data = store.read();
    const hit = data.requests.find((r) => r.id === str(id));
    if (!hit) return { error: "Anfrage nicht gefunden." };
    if (!PENDING_STATUSES.includes(hit.status || "open")) return { error: "Diese Anfrage ist schon erledigt.", request: complete(hit) };
    if (!str(hit.characterName)) return { error: "Die Anfrage nennt keinen Charakter – erst verknüpfen.", request: complete(hit) };
    Object.assign(hit, checkFields(by, byName, now));
    store.write(data);
    return { request: complete(hit) };
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

/**
 * Confirm an open request of the stock: its amount is set aside until the
 * hand-out. The confirmation is the orga's word for the recipient (#806): an
 * earlier check stays, else the confirming member vouches for it.
 */
function confirmRequest(id, { by = "", byName = "" } = {}, { now = Date.now() } = {}) {
    const current = getRequest(id);
    const check = current && current.recipientCheckedAt > 0
        ? checkFields(current.recipientCheckedBy, current.recipientCheckedByName, current.recipientCheckedAt)
        : checkFields(by, byName, now);
    return transition(id, "open", "confirmed", { handledBy: str(by), handledByName: str(byName), handledAt: now, reason: "", ...check });
}

/**
 * Take a confirmation back: the request is open again, nothing set aside. The
 * vouch for its recipient stays (#806) — "Bestätigen" works again at once.
 */
function releaseRequest(id) {
    const current = getRequest(id);
    const check = current ? checkFields(current.recipientCheckedBy, current.recipientCheckedByName, current.recipientCheckedAt) : {};
    return transition(id, "confirmed", "open", { handledBy: "", handledByName: "", handledAt: 0, ...check });
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
    STATUSES, PENDING_STATUSES, HANDOUT_VIAS, ITEM_MAX, PURPOSE_MAX, REASON_MAX, AMOUNT_MIN, AMOUNT_MAX, MAX_OPEN, MAX_WAITING, KEEP_DAYS,
    parseAmount, checkInput, listRequests, getRequest, addRequest, setMessage, setRecipient, setRecipientName, renameRecipient, checkRecipient, resolveRequest,
    confirmRequest, releaseRequest, handOutRequest, removeRequest, prune, renamePendingItem,
    openCount, waitingCount, waitingQueue, addWaiting, promoteWaiting, moveWaiting, removeWaiting,
    useFile,
};
