// What a guild bank has set aside: the confirmed requests of the bank, summed
// per item. The fields bankKey/itemId/"confirmed" are written by #633; the
// fixtures here write them straight into the store's file.
const fs = require("fs");
const store = require("../../../src/stores/guildBankStore");
const { reservedByItem, reservedRequestCount } = require("../../../src/services/guildbank/reservations");
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
