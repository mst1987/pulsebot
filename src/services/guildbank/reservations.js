// What is set aside from a guild bank's stock: the amounts of the requests the
// orga confirmed (stores/guildBankStore.js, status "confirmed") that wait for
// the hand-out in game. The stock page (#632) shows them as "Vorgemerkt" and
// takes them off "Verfügbar"; the request form (#633) checks a new request
// against the same number, the hand-out list (#634) ends the reservation by
// moving the request on to "handedOut".
//
//   reservedByItem(bankKey) -> { [itemId]: amount }   only items with a reservation
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

/** How many confirmed requests of one bank wait for the hand-out. */
function reservedRequestCount(bankKey) {
    const key = String(bankKey || "").trim();
    if (!key) return 0;
    return store.listRequests({ status: "confirmed" }).filter((r) => r.bankKey === key && r.itemId).length;
}

module.exports = { reservedByItem, handedOutSince, reservedRequestCount };
