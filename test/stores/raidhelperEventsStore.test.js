// The synced Raid-Helper event list (#606): the one copy every page reads.
const fs = require("fs");
const { tempStoreFile } = require("../helpers/tempStore");
const store = require("../../src/stores/raidhelperEventsStore");

let file;
beforeEach(() => {
    file = tempStoreFile("raidhelper-events.json");
    store.useFile(file);
});
afterAll(() => store.useFile(null));

describe("stores/raidhelperEventsStore", () => {
    it("has never synced at first", () => {
        expect(store.readSnapshot()).toEqual({ syncedAt: 0, since: 0, events: [], error: "", errorAt: 0 });
    });

    it("replaces the list on a successful sync and clears the error", () => {
        store.saveSyncError("down", 5);
        store.saveSnapshot({ syncedAt: 10, since: 1, events: [{ id: "a" }] });
        expect(store.readSnapshot()).toEqual({ syncedAt: 10, since: 1, events: [{ id: "a" }], error: "", errorAt: 0 });
    });

    it("keeps the list when a sync fails and records why", () => {
        store.saveSnapshot({ syncedAt: 10, since: 1, events: [{ id: "a" }] });
        store.saveSyncError("x".repeat(400), 20);
        const snap = store.readSnapshot();
        expect(snap.events).toEqual([{ id: "a" }]);
        expect(snap.error).toHaveLength(300);
        expect(snap.errorAt).toBe(20);
    });

    it("reads a broken file as never synced and drops entries that are no event", () => {
        fs.writeFileSync(file, JSON.stringify({ syncedAt: "x", events: [{ id: "a" }, null, 3] }));
        expect(store.readSnapshot()).toMatchObject({ syncedAt: 0, events: [{ id: "a" }] });
        fs.writeFileSync(file, "[1]");
        expect(store.readSnapshot().events).toEqual([]);
    });
});
