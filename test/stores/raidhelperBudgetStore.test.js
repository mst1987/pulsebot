// The stored Raid-Helper request count (#606): hour buckets plus a pause.
const fs = require("fs");
const { tempStoreFile } = require("../helpers/tempStore");
const store = require("../../src/stores/raidhelperBudgetStore");

let file;
beforeEach(() => {
    file = tempStoreFile("raidhelper-budget.json");
    store.useFile(file);
});
afterAll(() => store.useFile(null));

describe("stores/raidhelperBudgetStore", () => {
    it("starts empty", () => {
        expect(store.readBudget()).toEqual({ hours: {}, blockedUntil: 0, blockedReason: "" });
    });

    it("keeps what it was given", () => {
        store.writeBudget({ hours: { 500000: 3 }, blockedUntil: 9, blockedReason: "limit" });
        expect(store.readBudget()).toEqual({ hours: { 500000: 3 }, blockedUntil: 9, blockedReason: "limit" });
    });

    it("drops hours that are no count, and survives a broken file", () => {
        fs.writeFileSync(file, JSON.stringify({ hours: { 1: 2, x: 5, 3: -1, 4: "a" }, blockedUntil: "soon" }));
        expect(store.readBudget()).toEqual({ hours: { 1: 2 }, blockedUntil: 0, blockedReason: "" });
        fs.writeFileSync(file, "{ not json");
        expect(store.readBudget().hours).toEqual({});
        fs.writeFileSync(file, "[]");
        expect(store.readBudget().hours).toEqual({});
    });
});
