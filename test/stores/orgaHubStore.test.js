// The posted Orga-Zentrale messages (stores/orgaHubStore.js): one per category.
const fs = require("fs");
const { tempStoreFile } = require("../helpers/tempStore");
const store = require("../../src/stores/orgaHubStore");

const FILE = tempStoreFile("orga-hubs.json");

beforeEach(() => {
    store.useFile(FILE);
    fs.rmSync(FILE, { force: true });
});
afterAll(() => store.useFile(null));

describe("stores/orgaHubStore", () => {
    it("starts empty", () => {
        expect(store.listHubs()).toEqual([]);
        expect(store.getHub("cat1")).toBeNull();
    });

    it("keeps one hub per category: posting again replaces the earlier one", () => {
        store.setHub({ categoryId: "cat1", guildId: "g", channelId: "c1", messageId: "m1", postedBy: "u1", hash: "h1" }, { now: 5 });
        store.setHub({ categoryId: "cat2", guildId: "g", channelId: "c2", messageId: "m2" }, { now: 6 });
        const hub = store.setHub({ categoryId: "cat1", guildId: "g", channelId: "c3", messageId: "m3", hash: "h3" }, { now: 7 });
        expect(hub).toEqual({ categoryId: "cat1", guildId: "g", channelId: "c3", messageId: "m3", postedAt: 7, postedBy: "", hash: "h3" });
        expect(store.listHubs().map((h) => h.categoryId).sort()).toEqual(["cat1", "cat2"]);
        expect(store.getHub("cat1").messageId).toBe("m3");
    });

    it("keeps the posting time it is given (a repost of a deleted message)", () => {
        expect(store.setHub({ categoryId: "cat1", channelId: "c", messageId: "m", postedAt: 3 }, { now: 9 }).postedAt).toBe(3);
    });

    it("remembers the drawn fingerprint", () => {
        store.setHub({ categoryId: "cat1", channelId: "c1", messageId: "m1", hash: "a" });
        expect(store.markHubDrawn("cat1", "b")).toBe(true);
        expect(store.getHub("cat1").hash).toBe("b");
        expect(store.markHubDrawn("nope", "b")).toBe(false);
    });

    it("removes a hub and answers null for one that is not there", () => {
        store.setHub({ categoryId: "cat1", channelId: "c1", messageId: "m1" });
        expect(store.removeHub("cat1")).toMatchObject({ categoryId: "cat1", messageId: "m1" });
        expect(store.removeHub("cat1")).toBeNull();
        expect(store.listHubs()).toEqual([]);
    });

    it("drops broken entries of the file", () => {
        fs.mkdirSync(require("path").dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify({ hubs: [null, { categoryId: "x" }, { categoryId: "cat1", channelId: "c", messageId: "m" }] }));
        expect(store.listHubs()).toHaveLength(1);
        fs.writeFileSync(FILE, JSON.stringify({ hubs: "nope" }));
        expect(store.listHubs()).toEqual([]);
    });
});
