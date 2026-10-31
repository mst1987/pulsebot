// The synced Raid-Helper event lists (#608), one per Discord server (#927).
const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");
const store = require("../../../src/stores/events/raidhelperEventsStore");

const A = "111111111111111111";
const B = "222222222222222222";
const NEVER = { syncedAt: 0, since: 0, events: [], error: "", errorAt: 0 };

let file;
beforeEach(() => {
    file = tempStoreFile("raidhelper-events.json");
    store.useFile(file);
});
afterAll(() => store.useFile(null));

// the store caches: after writing the file by hand, point it at the file again
function writeRaw(content) {
    fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
    store.useFile(file);
}

describe("stores/events/raidhelperEventsStore", () => {
    it("has never synced at first", () => {
        expect(store.readSnapshot(A)).toEqual(NEVER);
        expect(store.readSnapshot()).toEqual(NEVER);
        expect(store.snapshotGuilds()).toEqual([]);
    });

    it("replaces the list on a successful sync and clears the error", () => {
        store.saveSyncError(A, "down", 5);
        store.saveSnapshot(A, { syncedAt: 10, since: 1, events: [{ id: "a" }] });
        expect(store.readSnapshot(A)).toEqual({ syncedAt: 10, since: 1, events: [{ id: "a" }], error: "", errorAt: 0 });
    });

    it("keeps the list when a sync fails and records why", () => {
        store.saveSnapshot(A, { syncedAt: 10, since: 1, events: [{ id: "a" }] });
        store.saveSyncError(A, "x".repeat(400), 20);
        const snap = store.readSnapshot(A);
        expect(snap.events).toEqual([{ id: "a" }]);
        expect(snap.error).toHaveLength(300);
        expect(snap.errorAt).toBe(20);
    });

    it("keeps one list per server; without an id it joins them", () => {
        store.saveSnapshot(A, { syncedAt: 10, since: 5, events: [{ id: "a" }] });
        store.saveSnapshot(B, { syncedAt: 30, since: 2, events: [{ id: "b" }] });
        store.saveSyncError(B, "down", 40);
        expect(store.readSnapshot(A)).toEqual({ syncedAt: 10, since: 5, events: [{ id: "a" }], error: "", errorAt: 0 });
        expect(store.readSnapshot(B)).toMatchObject({ events: [{ id: "b" }], error: "down", errorAt: 40 });
        expect(store.snapshotGuilds().sort()).toEqual([A, B]);
        expect(store.readSnapshot()).toEqual({ syncedAt: 30, since: 2, events: [{ id: "a" }, { id: "b" }], error: "", errorAt: 0 });
    });

    it("reads a broken file as never synced and drops entries that are no event", () => {
        writeRaw({ servers: { [A]: { syncedAt: "x", events: [{ id: "a" }, null, 3] } } });
        expect(store.readSnapshot(A)).toMatchObject({ syncedAt: 0, events: [{ id: "a" }] });
        writeRaw("[1]");
        expect(store.readSnapshot(A)).toEqual(NEVER);
    });

    it("hands a list from before #927 to one server once", () => {
        writeRaw({ syncedAt: 10, since: 1, events: [{ id: "old" }] });
        expect(store.readSnapshot(A)).toEqual(NEVER);
        expect(store.moveLegacy(A)).toBe(true);
        expect(store.readSnapshot(A).events).toEqual([{ id: "old" }]);
        expect(store.moveLegacy(A)).toBe(false);
        expect(store.moveLegacy(B)).toBe(false);
        expect(store.readSnapshot(B)).toEqual(NEVER);
        expect(JSON.parse(fs.readFileSync(file, "utf8")).legacy).toBeUndefined();
    });

    it("never moves the old list over a list the server already has", () => {
        writeRaw({ servers: { [A]: { syncedAt: 50, events: [{ id: "new" }] } }, legacy: { syncedAt: 1, events: [{ id: "old" }] } });
        expect(store.moveLegacy(A)).toBe(true);
        expect(store.readSnapshot(A).events).toEqual([{ id: "new" }]);
        expect(store.moveLegacy(A)).toBe(false);
    });
});
