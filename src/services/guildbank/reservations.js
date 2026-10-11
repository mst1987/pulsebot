// What is set aside from a guild bank's stock: the amounts of the requests the
// orga confirmed (stores/guildBankStore.js, status "confirmed") that wait for
// the hand-out in game. The stock page (#632) shows them as "Vorgemerkt" and
// takes them off "Verfügbar"; the request form (#633) checks a new request
// against the same number, the hand-out list (#634) ends the reservation by
// moving the request on to "handedOut".
//
//   reservedByItem(bankKey) -> { [itemId]: amount }   only items with a reservation
//   pendingByItem(bankKey)  -> { open, waiting, waitingAmount }  open requests and the waiting list (#775)
//
// A request counts when its `bankKey` is this bank's, its `itemId` is set and
// its status is "confirmed". Open requests are not reserved yet (the orga has
// not said yes), handed-out ones are gone from the bank with the next scan.
const store = require("../../stores/guildBankStore");

/**
 * The confirmed amounts per item of one bank.
 * @param {string} bankKey
 * @returns {Record<string, number>}
 */
function reservedByItem(bankKey) {
    const key = String(bankKey || "").trim();
    const out = {};
    if (!key) return out;
    for (const r of store.listRequests({ status: "confirmed" })) {
        if (r.bankKey !== key || !r.itemId || !(r.amount > 0)) continue;
        out[r.itemId] = (out[r.itemId] || 0) + r.amount;
    }
    return out;
}

/**
 * The amounts per item handed out after the bank's last scan (`scannedAt`, ms):
 * gone from the bank, but the stored stock still counts them until the next
 * scan — stockView takes them off "Verfügbar" so the number does not jump
 * back up when a reservation ends with the hand-out.
 * @param {string} bankKey
 * @param {number} scannedAt
 * @returns {Record<string, number>}
 */
function handedOutSince(bankKey, scannedAt) {
    const key = String(bankKey || "").trim();
    const since = Number(scannedAt) || 0;
    const out = {};
    if (!key) return out;
    for (const r of store.listRequests({ status: "handedOut" })) {
        if (r.bankKey !== key || !r.itemId || !(r.amount > 0) || r.handedOutAt <= since) continue;
        out[r.itemId] = (out[r.itemId] || 0) + r.amount;
    }
    return out;
}

/**
 * What still waits for the orga per item of one bank (#775): `open` = the
 * amounts of the open (not yet confirmed) requests from the stock — not set
 * aside, but already promised, so a new request or the waiting list's move-up
 * must not hand them out a second time; `waiting` = how many waiting-list
 * entries wait, `waitingAmount` = their amounts.
 * @param {string} bankKey
 * @returns {{ open: Record<string, number>, waiting: Record<string, number>, waitingAmount: Record<string, number> }}
 */
function pendingByItem(bankKey) {
    const key = String(bankKey || "").trim();
    const out = { open: {}, waiting: {}, waitingAmount: {} };
    if (!key) return out;
    for (const r of store.listRequests()) {
        if (r.bankKey !== key || !r.itemId || !(r.amount > 0)) continue;
        if (r.status === "open") out.open[r.itemId] = (out.open[r.itemId] || 0) + r.amount;
        if (r.status === "waiting") {
            out.waiting[r.itemId] = (out.waiting[r.itemId] || 0) + 1;
            out.waitingAmount[r.itemId] = (out.waitingAmount[r.itemId] || 0) + r.amount;
        }
    }
    return out;
}

/** How many confirmed requests of one bank wait for the hand-out. */
function reservedRequestCount(bankKey) {
    const key = String(bankKey || "").trim();
    if (!key) return 0;
    return store.listRequests({ status: "confirmed" }).filter((r) => r.bankKey === key && r.itemId).length;
}

module.exports = { reservedByItem, handedOutSince, pendingByItem, reservedRequestCount };
