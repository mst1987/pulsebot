// Mock fs with an in-memory store so tests never touch the repo's disk.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { getRaidplanPost, markRaidplanPosted, deleteRaidplanPost } = require("../../src/stores/raidplanPostStore");

beforeEach(() => fs.__store.clear());

describe("stores/raidplanPostStore", () => {
    it("knows nothing at first and ignores a blank id", () => {
        expect(getRaidplanPost("eh-1")).toBeNull();
        expect(getRaidplanPost("")).toBeNull();
        expect(markRaidplanPosted("  ", { channelId: "c1", messageId: "m1" })).toBeNull();
        expect(deleteRaidplanPost("eh-1")).toBe(false);
    });

    it("records where the link went, trimmed, with time and author", () => {
        const saved = markRaidplanPosted(" eh-1 ", { channelId: " c1 ", messageId: "m1", message: " Bitte lesen ", userId: "u1", now: 1000 });
        expect(saved).toEqual({ eventId: "eh-1", channelId: "c1", messageId: "m1", message: "Bitte lesen", postedAt: 1000, postedBy: "u1" });
        expect(getRaidplanPost("eh-1")).toEqual(saved);
    });

    it("replaces the record of the same event and keeps the others", () => {
        markRaidplanPosted("eh-1", { channelId: "c1", messageId: "m1", now: 1 });
        markRaidplanPosted("eh-2", { channelId: "c2", messageId: "m2", now: 2 });
        markRaidplanPosted("eh-1", { channelId: "c1", messageId: "m3", message: "neu", now: 3 });
        expect(getRaidplanPost("eh-1")).toMatchObject({ messageId: "m3", message: "neu", postedAt: 3 });
        expect(getRaidplanPost("eh-2")).toMatchObject({ messageId: "m2" });
    });

    it("fills in missing fields and the current time", () => {
        const before = Date.now();
        const saved = markRaidplanPosted("eh-1");
        expect(saved).toMatchObject({ channelId: "", messageId: "", message: "", postedBy: "" });
        expect(saved.postedAt).toBeGreaterThanOrEqual(before);
    });

    it("forgets an event's post", () => {
        markRaidplanPosted("eh-1", { channelId: "c1", messageId: "m1" });
        markRaidplanPosted("eh-2", { channelId: "c2", messageId: "m2" });
        expect(deleteRaidplanPost("eh-1")).toBe(true);
        expect(getRaidplanPost("eh-1")).toBeNull();
        expect(getRaidplanPost("eh-2")).not.toBeNull();
    });
});
