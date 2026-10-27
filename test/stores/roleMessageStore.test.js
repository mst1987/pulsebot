// The role messages' store (src/stores/roleMessageStore.js): shape, ids, lookups.
const fs = require("fs");
const store = require("../../src/stores/roleMessageStore");
const { tempStoreFile } = require("../helpers/tempStore");

let file;
beforeEach(() => {
    file = tempStoreFile("role-messages.json");
    store.useFile(file);
});
afterAll(() => store.useFile(null));

const ENTRY = {
    guildSide: "talk",
    channelId: "100000000000000001",
    messageId: "300000000000000003",
    title: "WoW Forever Role",
    body: "Reagiere auf diese Nachricht",
    imageUrl: "https://cdn.example/forever.png",
    color: "#3366cc",
    roles: [{ roleId: "200000000000000002", emoji: "✅", label: "WoW Forever Role" }],
    createdBy: "u1",
};

describe("stores/roleMessageStore", () => {
    it("starts empty", () => {
        expect(store.listMessages()).toEqual([]);
        expect(store.getMessage("x")).toBeNull();
        expect(store.findByMessageId("300000000000000003")).toBeNull();
        expect(store.findByMessageId("")).toBeNull();
    });

    it("saves a new entry with an id and the times, finds it by id and by message", () => {
        const saved = store.saveMessage(ENTRY, { now: 1000 });
        expect(saved.id).toMatch(/^[0-9a-f]{12}$/);
        expect(saved).toMatchObject({ guildSide: "talk", color: 0x3366cc, createdAt: 1000, updatedAt: 1000, createdBy: "u1" });
        expect(store.getMessage(saved.id)).toEqual(saved);
        expect(store.findByMessageId("300000000000000003")).toEqual(saved);
        expect(JSON.parse(fs.readFileSync(file, "utf8")).messages).toHaveLength(1);
    });

    it("replaces an entry and keeps who made it and when", () => {
        const first = store.saveMessage(ENTRY, { now: 1000 });
        const again = store.saveMessage({ ...first, title: "Neu", createdBy: "", createdAt: 0 }, { now: 2000 });
        expect(again).toMatchObject({ id: first.id, title: "Neu", createdBy: "u1", createdAt: 1000, updatedAt: 2000 });
        expect(store.listMessages()).toHaveLength(1);
    });

    it("drops what is no valid shape: a bad side, ids, picture, colour, roles", () => {
        const saved = store.saveMessage({
            guildSide: "other", channelId: "abc", messageId: "", imageUrl: "http://x/y.png", color: 0x1000000,
            roles: [{ roleId: "nope", emoji: "x" }, null, { roleId: "200000000000000002", emoji: " ✅ ", label: " Hi " }],
        });
        expect(saved).toMatchObject({ guildSide: "event", channelId: "", messageId: "", imageUrl: "", color: null });
        expect(saved.roles).toEqual([{ roleId: "200000000000000002", emoji: "✅", label: "Hi" }]);
    });

    it("keeps the guildId and drops the old guildSide once a server is set (#895)", () => {
        const saved = store.saveMessage({ ...ENTRY, guildId: "900000000000000002" });
        expect(saved.guildId).toBe("900000000000000002");
        expect(saved.guildSide).toBeUndefined();
        const legacy = store.saveMessage(ENTRY);
        expect(legacy).toMatchObject({ guildId: "", guildSide: "talk" });
    });

    it("hands out copies: changing one never changes the store", () => {
        const saved = store.saveMessage(ENTRY);
        saved.roles[0].label = "changed";
        expect(store.getMessage(saved.id).roles[0].label).toBe("WoW Forever Role");
    });

    it("removes an entry and says what it removed", () => {
        const saved = store.saveMessage(ENTRY);
        expect(store.removeMessage(saved.id)).toMatchObject({ id: saved.id });
        expect(store.removeMessage(saved.id)).toBeNull();
        expect(store.listMessages()).toEqual([]);
    });

    it("reads a broken or foreign file as empty and skips entries without id or twice", () => {
        fs.writeFileSync(file, "{nope");
        expect(store.listMessages()).toEqual([]);
        fs.writeFileSync(file, JSON.stringify({ messages: [{ id: "a" }, { id: "a", title: "twice" }, { title: "no id" }, 5] }));
        expect(store.listMessages().map((m) => m.id)).toEqual(["a"]);
    });

    it("answers a reaction lookup from memory: no file read for unknown messages, fresh after save/remove/useFile", () => {
        const saved = store.saveMessage(ENTRY);
        expect(store.findByMessageId("300000000000000003")).toMatchObject({ id: saved.id });
        const read = jest.spyOn(fs, "readFileSync");
        const stat = jest.spyOn(fs, "statSync");
        expect(store.findByMessageId("399999999999999999")).toBeNull();
        expect(read).not.toHaveBeenCalled();
        expect(stat).not.toHaveBeenCalled();
        read.mockRestore();
        stat.mockRestore();

        // a save with a new message id is found at once, the old one no longer
        store.saveMessage({ ...saved, messageId: "300000000000000004" });
        expect(store.findByMessageId("300000000000000003")).toBeNull();
        expect(store.findByMessageId("300000000000000004")).toMatchObject({ id: saved.id });
        store.removeMessage(saved.id);
        expect(store.findByMessageId("300000000000000004")).toBeNull();

        // another file: the set is built again from it
        const other = tempStoreFile("role-messages-2.json");
        fs.writeFileSync(other, JSON.stringify({ messages: [{ id: "b", messageId: "300000000000000005", roles: [] }] }));
        store.useFile(other);
        expect(store.findByMessageId("300000000000000005")).toMatchObject({ id: "b" });
    });

    it("reads colours as numbers or #hex", () => {
        expect(store.colorOf("#ff0000")).toBe(0xff0000);
        expect(store.colorOf(255)).toBe(255);
        expect(store.colorOf("")).toBeNull();
        expect(store.colorOf("red")).toBeNull();
    });
});
