// The remembered raid overview messages (stores/raidOverviewStore.js).
const fs = require("fs");
const { tempStoreFile } = require("../helpers/tempStore");
const store = require("../../src/stores/raidOverviewStore");

const FILE = tempStoreFile("raid-overviews.json");

beforeEach(() => {
    store.useFile(FILE);
    fs.rmSync(FILE, { force: true });
});
afterAll(() => store.useFile(null));

const entry = (over = {}) => ({ guildId: "g1", channelId: "c1", messageId: "m1", categoryId: "cat1", hash: "h", lastChange: 100, ...over });

describe("stores/raidOverviewStore", () => {
    it("starts empty", () => {
        expect(store.listOverviews()).toEqual([]);
        expect(store.getOverview("m1")).toBeNull();
        expect(store.isScanned("g1")).toBe(false);
    });

    it("keeps several overviews of a category, one per message", () => {
        store.setOverview(entry());
        store.setOverview(entry({ channelId: "c2", messageId: "m2" }));
        store.setOverview(entry({ hash: "new", lastChange: 200 }));
        expect(store.listOverviews()).toHaveLength(2);
        expect(store.getOverview("m1")).toEqual(entry({ hash: "new", lastChange: 200 }));
    });

    it("finds the overview of a category in a channel", () => {
        store.setOverview(entry());
        store.setOverview(entry({ categoryId: "cat2", messageId: "m2" }));
        expect(store.findInChannel("c1", "cat2").messageId).toBe("m2");
        expect(store.findInChannel("c1", "cat3")).toBeNull();
        expect(store.findInChannel("c9", "cat1")).toBeNull();
    });

    it("refuses an entry without channel, message or category", () => {
        expect(store.setOverview(entry({ messageId: "" }))).toBeNull();
        expect(store.setOverview(entry({ categoryId: "" }))).toBeNull();
        expect(store.listOverviews()).toEqual([]);
    });

    it("remembers what a message shows and when", () => {
        store.setOverview(entry());
        expect(store.markDrawn("m1", "h2", 300)).toBe(true);
        expect(store.getOverview("m1")).toMatchObject({ hash: "h2", lastChange: 300 });
        expect(store.markDrawn("m1", "h3")).toBe(true);
        expect(store.getOverview("m1")).toMatchObject({ hash: "h3", lastChange: 300 });
        expect(store.markDrawn("nope", "x", 1)).toBe(false);
    });

    it("forgets a message", () => {
        store.setOverview(entry());
        expect(store.removeOverview("m1")).toEqual(entry());
        expect(store.removeOverview("m1")).toBeNull();
        expect(store.listOverviews()).toEqual([]);
    });

    it("notes which event servers were searched", () => {
        store.markScanned("g1");
        store.markScanned("g1");
        store.markScanned("");
        expect(store.isScanned("g1")).toBe(true);
        expect(store.isScanned("g2")).toBe(false);
        expect(JSON.parse(fs.readFileSync(FILE, "utf8")).scannedGuilds).toEqual(["g1"]);
    });

    it("keeps the overview of a whole server apart from the category overviews of its channel", () => {
        const server = store.setOverview(entry({ messageId: "m9", categoryId: "cat1", scope: "server" }));
        expect(server).toEqual({ guildId: "g1", channelId: "c1", messageId: "m9", categoryId: "", scope: "server", hash: "h", lastChange: 100 });
        expect(store.isServerOverview(server)).toBe(true);
        expect(store.findServerInChannel("c1").messageId).toBe("m9");
        expect(store.findServerInChannel("c2")).toBeNull();
        // never the overview of a category, not even of "" or the category it was posted with
        expect(store.findInChannel("c1", "")).toBeNull();
        expect(store.findInChannel("c1", "cat1")).toBeNull();
        store.setOverview(entry());
        expect(store.findInChannel("c1", "cat1").messageId).toBe("m1");
        expect(store.findServerInChannel("c1").messageId).toBe("m9");
        expect(store.isServerOverview(store.getOverview("m1"))).toBe(false);
        expect(store.getOverview("m1")).not.toHaveProperty("scope");
        // survives a reload of the file
        store.useFile(FILE);
        expect(store.getOverview("m9")).toMatchObject({ scope: "server", categoryId: "" });
    });

    it("refuses a server overview without its server", () => {
        expect(store.setOverview(entry({ guildId: "", scope: "server" }))).toBeNull();
        fs.writeFileSync(FILE, JSON.stringify({ overviews: [{ channelId: "c", messageId: "m", scope: "server", categoryId: "" }] }));
        expect(store.listOverviews()).toEqual([]);
    });

    it("reads a damaged file as empty", () => {
        fs.writeFileSync(FILE, JSON.stringify({ overviews: [null, { channelId: "c" }, entry()], scannedGuilds: "x" }));
        expect(store.listOverviews()).toEqual([entry()]);
        expect(store.isScanned("x")).toBe(false);
    });
});
