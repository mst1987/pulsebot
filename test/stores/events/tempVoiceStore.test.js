// The remembered temporary voice channels (stores/events/tempVoiceStore.js).
const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");
const store = require("../../../src/stores/events/tempVoiceStore");

const FILE = tempStoreFile("temp-voice.json");

beforeEach(() => {
    store.useFile(FILE);
    fs.rmSync(FILE, { force: true });
});
afterAll(() => store.useFile(null));

describe("stores/events/tempVoiceStore", () => {
    it("starts empty", () => {
        expect(store.listEntries()).toEqual([]);
        expect(store.getEntry("eh-1")).toBeNull();
    });

    it("merges changes into an event's entry and keeps them over a reload", () => {
        store.updateEntry("eh-1", { guildId: "g1", channelId: "v1", name: "SSC 1", createdAt: 100 });
        store.updateEntry("eh-1", { emptySince: 160 });
        expect(store.getEntry("eh-1")).toEqual({
            guildId: "g1", channelId: "v1", name: "SSC 1", createdAt: 100, emptySince: 160, closedAt: 0, closeReason: "", manual: false, error: "",
        });
        expect(JSON.parse(fs.readFileSync(FILE, "utf8")).channels["eh-1"].channelId).toBe("v1");
        expect(store.listEntries()).toEqual([expect.objectContaining({ eventId: "eh-1", channelId: "v1" })]);
    });

    it("refuses an entry without a server and cleans broken values", () => {
        expect(store.updateEntry("eh-2", { channelId: "v2" })).toBeNull();
        expect(store.updateEntry("", { guildId: "g1" })).toBeNull();
        expect(store.updateEntry("eh-3", { guildId: "g1", createdAt: "x", emptySince: -5, manual: "yes", error: "e".repeat(400) }))
            .toMatchObject({ createdAt: 0, emptySince: 0, manual: false, error: "e".repeat(300) });
    });

    it("removes an entry and prunes old closed ones", () => {
        store.updateEntry("eh-1", { guildId: "g1", closedAt: 100 });
        store.updateEntry("eh-2", { guildId: "g1", closedAt: 500 });
        store.updateEntry("eh-3", { guildId: "g1" });
        expect(store.prune(200)).toBe(1);
        expect(store.prune(200)).toBe(0);
        expect(store.listEntries().map((e) => e.eventId)).toEqual(["eh-2", "eh-3"]);
        expect(store.removeEntry("eh-2")).toBe(true);
        expect(store.removeEntry("eh-2")).toBe(false);
    });

    it("drops garbage from the file", () => {
        fs.writeFileSync(FILE, JSON.stringify({ channels: { a: { guildId: "g1" }, b: "x", c: [], d: { channelId: "v" } } }));
        expect(store.listEntries().map((e) => e.eventId)).toEqual(["a"]);
        fs.writeFileSync(FILE, JSON.stringify({ channels: [] }));
        expect(store.listEntries()).toEqual([]);
    });
});
