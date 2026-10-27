// Per-link overview state (#361, #892): one record per key ("from:to" since
// #892, the guild id before), the move of a pre-#892 record to the first link
// of its source, plus the one-time migration of an old install's flat file.
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

    it("names every link by from:to; only the first link of a source inherits the old record (#892)", () => {
        const links = [
            { from: EVENT_A, to: EVENT_B, channelId: "1" },
            { from: EVENT_A, to: EVENT_A, channelId: "2" },
            { from: EVENT_B, to: EVENT_A, channelId: "3" },
            { from: "", to: EVENT_A },
        ];
        expect(store.overviewKeys(links).map(({ key, legacyKey }) => [key, legacyKey])).toEqual([
            [`${EVENT_A}:${EVENT_B}`, EVENT_A],
            [`${EVENT_A}:${EVENT_A}`, ""],
            [`${EVENT_B}:${EVENT_A}`, EVENT_B],
        ]);
        expect(store.overviewKeys(null)).toEqual([]);
    });

    it("moves a pre-#892 record (keyed by the source) to its link's key on the first read", () => {
        store.setOverviewState(EVENT_A, { channelId: "1", messageId: "10", hash: "h" });
        const key = `${EVENT_A}:${EVENT_B}`;
        expect(store.getOverviewState(key, { legacyKey: EVENT_A })).toMatchObject({ channelId: "1", messageId: "10", hash: "h" });
        expect(Object.keys(stored())).toEqual([key]);
        // a second link of the same source starts empty
        expect(store.getOverviewState(`${EVENT_A}:${EVENT_A}`, { legacyKey: "" }).messageId).toBe("");
        // an existing record of the link wins over a leftover old one
        store.setOverviewState(EVENT_A, { messageId: "99" });
        expect(store.getOverviewState(key, { legacyKey: EVENT_A }).messageId).toBe("10");
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

    it("lists only link keys for the clean-up and drops one record on request", () => {
        const ab = `${EVENT_A}:${EVENT_B}`;
        const ba = `${EVENT_B}:${EVENT_A}`;
        store.setOverviewState(ab, { messageId: "1" });
        store.setOverviewState(ba, { messageId: "2" });
        store.setOverviewState(EVENT_A, { messageId: "3" }); // pre-#892, may still migrate
        expect(store.listOverviewKeys()).toEqual([ab, ba]);
        expect(store.removeOverviewState(ba)).toBe(true);
        expect(store.removeOverviewState(ba)).toBe(false);
        expect(Object.keys(stored())).toEqual([ab, EVENT_A]);
    });

    it("lists and drops nothing while the file still has the old flat shape", () => {
        fs.mkdirSync(require("path").dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify({ channelId: "9", messageId: "90" }));
        expect(store.listOverviewKeys()).toEqual([]);
        expect(store.removeOverviewState("channelId")).toBe(false);
        expect(stored()).toEqual({ channelId: "9", messageId: "90" });
    });
});
