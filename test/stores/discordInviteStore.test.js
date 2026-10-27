// The bot's invites per link and per server (src/stores/discordInviteStore.js, #905).
const store = require("../../src/stores/discordInviteStore");
const { tempStoreFile } = require("../helpers/tempStore");

const KEY = "900000000000000001:900000000000000002";
const PUG = "900000000000000001";
const EMPTY = { code: "", channelId: "", createdAt: 0, error: "", deleted: false };

beforeEach(() => store.useFile(tempStoreFile("discord-invites.json")));
afterAll(() => store.useFile(null));

describe("discordInviteStore", () => {
    it("hands out empty records for links and servers without an invite", () => {
        expect(store.getLinkInvite(KEY)).toEqual(EMPTY);
        expect(store.getGeneralInvite(PUG)).toEqual(EMPTY);
        expect(store.getInviteChannel(PUG)).toBe("");
        expect(store.knownCodes()).toEqual([]);
        expect(store.linkKeys()).toEqual([]);
        expect(store.generalGuildIds()).toEqual([]);
    });

    it("merges patches into a link's and a server's record", () => {
        store.setLinkInvite(KEY, { code: "abc", channelId: "300000000000000001", createdAt: 5 });
        expect(store.setLinkInvite(KEY, { error: "kaputt" })).toEqual({ ...EMPTY, code: "abc", channelId: "300000000000000001", createdAt: 5, error: "kaputt" });
        store.setGeneralInvite(PUG, { code: "gen" });
        expect(store.getGeneralInvite(PUG).code).toBe("gen");
        expect(store.knownCodes()).toEqual([
            { code: "abc", guildId: PUG, linkKey: KEY },
            { code: "gen", guildId: PUG, linkKey: "" },
        ]);
        expect(store.linkKeys()).toEqual([KEY]);
        expect(store.generalGuildIds()).toEqual([PUG]);
    });

    it("leaves a deleted invite out of the known codes but keeps its record", () => {
        store.setLinkInvite(KEY, { code: "abc" });
        store.setGeneralInvite(PUG, { code: "gen" });
        expect(store.setLinkInvite(KEY, { deleted: true }).deleted).toBe(true);
        expect(store.knownCodes()).toEqual([{ code: "gen", guildId: PUG, linkKey: "" }]);
        expect(store.linkKeys()).toEqual([KEY]);
        expect(store.setLinkInvite(KEY, { code: "new", deleted: false }).deleted).toBe(false);
        expect(store.knownCodes()).toHaveLength(2);
    });

    it("removes the record of a link and of a server", () => {
        store.setLinkInvite(KEY, { code: "abc" });
        store.setGeneralInvite(PUG, { code: "gen" });
        expect(store.removeLinkInvite(KEY)).toBe(true);
        expect(store.removeLinkInvite(KEY)).toBe(false);
        expect(store.removeGeneralInvite(PUG)).toBe(true);
        expect(store.removeGeneralInvite("")).toBe(false);
        expect(store.linkKeys()).toEqual([]);
        expect(store.generalGuildIds()).toEqual([]);
        expect(store.knownCodes()).toEqual([]);
    });

    it("sets and clears the invite channel of a server", () => {
        expect(store.setInviteChannel(PUG, "300000000000000009")).toBe("300000000000000009");
        expect(store.getInviteChannel(PUG)).toBe("300000000000000009");
        expect(store.channelGuildIds()).toEqual([PUG]);
        expect(store.setInviteChannel(PUG, "")).toBe("");
        expect(store.channelGuildIds()).toEqual([]);
        expect(store.getInviteChannel(PUG)).toBe("");
        expect(store.setInviteChannel("", "1")).toBe("");
    });

    it("ignores a patch without an id and cleans broken fields", () => {
        expect(store.setLinkInvite("", { code: "x" })).toEqual(EMPTY);
        expect(store.setLinkInvite(KEY, { code: 5, createdAt: "soon", deleted: "yes" })).toEqual(EMPTY);
    });
});
