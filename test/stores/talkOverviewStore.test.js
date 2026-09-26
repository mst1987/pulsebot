// Per-event-server overview state (#361): one record per guild id instead of
// the single flat record it used to be, plus the one-time migration of an old
// install's flat file.
const fs = require("fs");
const { tempStoreFile } = require("../helpers/tempStore");
const store = require("../../src/stores/talkOverviewStore");

const FILE = tempStoreFile("talk-overview.json");

const EVENT_A = "111111111111111111";
const EVENT_B = "222222222222222222";

const stored = () => {
    try {
        return JSON.parse(fs.readFileSync(FILE, "utf8"));
    } catch {
        return {};
    }
};

beforeEach(() => {
    store.useFile(FILE);
    try {
        fs.unlinkSync(FILE);
    } catch {
        // nothing to remove yet
    }
});

describe("stores/talkOverviewStore", () => {
    it("has empty state for a guild that never posted", () => {
        expect(store.getOverviewState(EVENT_A)).toEqual({
            channelId: "", messageId: "", hash: "", postedAt: 0, editedAt: 0, checkedAt: 0, error: "",
        });
    });

    it("keeps independent state per guild", () => {
        store.setOverviewState(EVENT_A, { channelId: "1", messageId: "10" });
        store.setOverviewState(EVENT_B, { channelId: "2", messageId: "20" });
        expect(store.getOverviewState(EVENT_A)).toMatchObject({ channelId: "1", messageId: "10" });
        expect(store.getOverviewState(EVENT_B)).toMatchObject({ channelId: "2", messageId: "20" });
        expect(Object.keys(stored())).toEqual([EVENT_A, EVENT_B]);
    });

    it("merges a patch into one guild's record without touching another's", () => {
        store.setOverviewState(EVENT_A, { channelId: "1", messageId: "10", hash: "h1" });
        store.setOverviewState(EVENT_B, { channelId: "2" });
        store.setOverviewState(EVENT_A, { hash: "h2" });
        expect(store.getOverviewState(EVENT_A)).toMatchObject({ channelId: "1", messageId: "10", hash: "h2" });
        expect(store.getOverviewState(EVENT_B)).toMatchObject({ channelId: "2" });
    });

    it("migrates an old flat-shape file into the first guild that reads it, once", () => {
        fs.mkdirSync(require("path").dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify({
            channelId: "9", messageId: "90", hash: "old", postedAt: 111, editedAt: 0, checkedAt: 222, error: "",
        }));
        expect(store.getOverviewState(EVENT_A)).toMatchObject({ channelId: "9", messageId: "90", hash: "old", postedAt: 111, checkedAt: 222 });
        // The file is now nested — a second guild's read never sees the migrated data.
        expect(stored()).toEqual({ [EVENT_A]: expect.objectContaining({ channelId: "9" }) });
        expect(store.getOverviewState(EVENT_B)).toEqual({
            channelId: "", messageId: "", hash: "", postedAt: 0, editedAt: 0, checkedAt: 0, error: "",
        });
    });
});
