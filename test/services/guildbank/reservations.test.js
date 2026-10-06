// What a guild bank has set aside: the confirmed requests of the bank, summed
// per item. The fields bankKey/itemId/"confirmed" are written by #633; the
// fixtures here write them straight into the store's file.
const fs = require("fs");
const store = require("../../../src/stores/guildBankStore");
const { reservedByItem, handedOutSince, reservedRequestCount } = require("../../../src/services/guildbank/reservations");
const { tempStoreFile } = require("../../helpers/tempStore");

const FILE = tempStoreFile("guild-bank.json");
const KEY = "tbc:spineshatter:die gilde";

const request = (over) => ({ id: `r${Math.random()}`, userId: "u1", item: "x", amount: 1, status: "confirmed", bankKey: KEY, itemId: 22854, ...over });
const write = (requests) => fs.writeFileSync(FILE, JSON.stringify({ requests }));

beforeAll(() => store.useFile(FILE));
afterAll(() => store.useFile(null));

describe("services/guildbank/reservations", () => {
    it("is empty without requests, without a key and for free-text requests", () => {
        write([]);
        expect(reservedByItem(KEY)).toEqual({});
        write([request({ itemId: 0 }), request({ bankKey: "" })]);
        expect(reservedByItem(KEY)).toEqual({});
        expect(reservedByItem("")).toEqual({});
        expect(reservedRequestCount("")).toBe(0);
    });

    it("sums the confirmed amounts per item of this bank only", () => {
        write([
            request({ amount: 4 }),
            request({ amount: 2 }),
            request({ itemId: 24027, amount: 1 }),
            request({ amount: 10, status: "open" }),
            request({ amount: 10, status: "handedOut" }),
            request({ amount: 10, status: "rejected" }),
            request({ amount: 10, bankKey: "forever:x:y" }),
        ]);
        expect(reservedByItem(KEY)).toEqual({ 22854: 6, 24027: 1 });
        expect(reservedRequestCount(KEY)).toBe(3);
        expect(reservedByItem("forever:x:y")).toEqual({ 22854: 10 });
    });

    it("sums what was handed out after the last scan — the scan before it still counts it", () => {
        write([
            request({ amount: 4, status: "handedOut", handedOutAt: 2000 }),
            request({ amount: 2, status: "handedOut", handedOutAt: 3000 }),
            request({ amount: 9, status: "handedOut", handedOutAt: 500 }),
            request({ amount: 9, status: "confirmed", handedOutAt: 0 }),
            request({ amount: 9, status: "handedOut", handedOutAt: 3000, bankKey: "forever:x:y" }),
            request({ amount: 9, status: "handedOut", handedOutAt: 3000, itemId: 0 }),
        ]);
        expect(handedOutSince(KEY, 1000)).toEqual({ 22854: 6 });
        expect(handedOutSince(KEY, 2500)).toEqual({ 22854: 2 });
        expect(handedOutSince(KEY, 0)).toEqual({ 22854: 15 });
        expect(handedOutSince("", 0)).toEqual({});
    });

    it("keeps confirmed requests when old handled ones are pruned", () => {
        const DAY = 24 * 60 * 60 * 1000;
        const now = 1_800_000_000_000;
        write([
            request({ id: "keep", amount: 3, handledAt: now - 200 * DAY }),
            request({ id: "gone", status: "handedOut", handledAt: now - 200 * DAY }),
        ]);
        expect(store.prune({ now })).toBe(1);
        expect(reservedByItem(KEY)).toEqual({ 22854: 3 });
    });
});
