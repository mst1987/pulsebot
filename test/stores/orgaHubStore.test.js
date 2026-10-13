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

    describe("orga links", () => {
        const A = { label: "WCL", url: "https://www.warcraftlogs.com/guild/x" };
        const B = { label: "Sheet", url: "https://docs.example/sheet" };

        it("has none to begin with and keeps a category's list in order, apart from the hubs", () => {
            expect(store.getLinks("cat1")).toEqual([]);
            expect(store.listLinks()).toEqual({});
            expect(store.setLinks("cat1", [A, B])).toEqual({ links: [A, B] });
            store.setHub({ categoryId: "cat1", channelId: "c", messageId: "m" });
            store.removeHub("cat1");
            expect(store.getLinks("cat1")).toEqual([A, B]);
            expect(store.listLinks()).toEqual({ cat1: [A, B] });
            expect(store.getLinks("cat2")).toEqual([]);
        });

        it("trims, drops empty rows and removes the list with an empty one", () => {
            expect(store.setLinks("cat1", [{ label: " WCL ", url: " https://a.example " }, { label: "", url: "" }]).links)
                .toEqual([{ label: "WCL", url: "https://a.example" }]);
            expect(store.setLinks("cat1", [])).toEqual({ links: [] });
            expect(store.listLinks()).toEqual({});
        });

        it("refuses what the raider organizer refuses: too many, no https, a long or missing label", () => {
            const six = Array.from({ length: 6 }, (_, i) => ({ label: `L${i}`, url: `https://a.example/${i}` }));
            expect(store.setLinks("cat1", six).error).toContain(`Höchstens ${store.MAX_LINKS} Links`);
            expect(store.setLinks("cat1", [{ label: "X", url: "ftp://a.example" }]).error).toContain("https://");
            expect(store.setLinks("cat1", [{ label: "X", url: "javascript:alert(1)" }]).error).toContain("https://");
            expect(store.setLinks("cat1", [{ label: "", url: "https://a.example" }]).error).toContain("braucht einen Text");
            expect(store.setLinks("cat1", [{ label: "x".repeat(store.LINK_LABEL_MAX + 1), url: "https://a.example" }]).error).toContain("zu lang");
            expect(store.setLinks("", [A])).toEqual({ error: "Keine Kategorie gewählt." });
            expect(store.getLinks("cat1")).toEqual([]);
        });

        it("refuses the same address twice, however it is written", () => {
            const res = store.setLinks("cat1", [A, { label: "Again", url: "HTTPS://WWW.WARCRAFTLOGS.COM/guild/x" }]);
            expect(res.error).toContain("steht schon in der Liste");
            expect(store.getLinks("cat1")).toEqual([]);
        });

        it("reads a file without or with broken links", () => {
            fs.mkdirSync(require("path").dirname(FILE), { recursive: true });
            fs.writeFileSync(FILE, JSON.stringify({ hubs: [], links: { cat1: [null, { label: "A" }, A], cat2: "nope" } }));
            expect(store.listLinks()).toEqual({ cat1: [A] });
            fs.writeFileSync(FILE, JSON.stringify({ hubs: [], links: [] }));
            expect(store.listLinks()).toEqual({});
        });
    });

    it("drops broken entries of the file", () => {
        fs.mkdirSync(require("path").dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify({ hubs: [null, { categoryId: "x" }, { categoryId: "cat1", channelId: "c", messageId: "m" }] }));
        expect(store.listHubs()).toHaveLength(1);
        fs.writeFileSync(FILE, JSON.stringify({ hubs: "nope" }));
        expect(store.listHubs()).toEqual([]);
    });
});
