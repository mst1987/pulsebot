// The stored Raid-Helper request count (#608): hour buckets plus a pause, per server (#927).
const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");
const store = require("../../../src/stores/events/raidhelperBudgetStore");

const A = "111111111111111111";
const B = "222222222222222222";
const EMPTY = { hours: {}, blockedUntil: 0, blockedReason: "" };

let file;
beforeEach(() => {
    file = tempStoreFile("raidhelper-budget.json");
    store.useFile(file);
});
afterAll(() => store.useFile(null));

// the store caches: after writing the file by hand, point it at the file again
function writeRaw(content) {
    fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
    store.useFile(file);
}

describe("stores/events/raidhelperBudgetStore", () => {
    it("starts empty", () => {
        expect(store.readBudget(A)).toEqual(EMPTY);
    });

    it("keeps what it was given, per server", () => {
        store.writeBudget(A, { hours: { 500000: 3 }, blockedUntil: 9, blockedReason: "limit" });
        expect(store.readBudget(A)).toEqual({ hours: { 500000: 3 }, blockedUntil: 9, blockedReason: "limit" });
        expect(store.readBudget(B)).toEqual(EMPTY);
        store.writeBudget(B, { hours: { 500000: 1 } });
        expect(store.readBudget(A).hours).toEqual({ 500000: 3 });
        expect(store.readBudget(B).hours).toEqual({ 500000: 1 });
    });

    it("drops hours that are no count, and survives a broken file", () => {
        writeRaw({ servers: { [A]: { hours: { 1: 2, x: 5, 3: -1, 4: "a" }, blockedUntil: "soon" } } });
        expect(store.readBudget(A)).toEqual({ hours: { 1: 2 }, blockedUntil: 0, blockedReason: "" });
        writeRaw("{ not json");
        expect(store.readBudget(A)).toEqual(EMPTY);
        writeRaw("[]");
        expect(store.readBudget(A)).toEqual(EMPTY);
    });

    it("hands a state from before #927 to one server once", () => {
        writeRaw({ hours: { 7: 4 }, blockedUntil: 0 });
        expect(store.readBudget(A)).toEqual(EMPTY);
        expect(store.moveLegacy(A)).toBe(true);
        expect(store.readBudget(A).hours).toEqual({ 7: 4 });
        expect(store.moveLegacy(B)).toBe(false);
        expect(store.readBudget(B)).toEqual(EMPTY);
    });
});
