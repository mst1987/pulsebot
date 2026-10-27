// The bot's invites per link and per server (src/stores/discordInviteStore.js, #905).
const store = require("../../src/stores/discordInviteStore");
const { tempStoreFile } = require("../helpers/tempStore");

const KEY = "900000000000000001:900000000000000002";
const PUG = "900000000000000001";

beforeEach(() => store.useFile(tempStoreFile("discord-invites.json")));
afterAll(() => store.useFile(null));

describe("discordInviteStore", () => {
    it("hands out empty records for links and servers without an invite", () => {
        expect(store.getLinkInvite(KEY)).toEqual({ code: "", channelId: "", createdAt: 0, error: "" });
        expect(store.getGeneralInvite(PUG)).toEqual({ code: "", channelId: "", createdAt: 0, error: "" });
        expect(store.getInviteChannel(PUG)).toBe("");
        expect(store.knownCodes()).toEqual([]);
    });

    it("merges patches into a link's and a server's record", () => {
        store.setLinkInvite(KEY, { code: "abc", channelId: "300000000000000001", createdAt: 5 });
        expect(store.setLinkInvite(KEY, { error: "kaputt" })).toEqual({ code: "abc", channelId: "300000000000000001", createdAt: 5, error: "kaputt" });
        store.setGeneralInvite(PUG, { code: "gen" });
        expect(store.getGeneralInvite(PUG).code).toBe("gen");
        expect(store.knownCodes()).toEqual([
            { code: "abc", guildId: PUG, linkKey: KEY },
            { code: "gen", guildId: PUG, linkKey: "" },
        ]);
    });

    it("sets and clears the invite channel of a server", () => {
        expect(store.setInviteChannel(PUG, "300000000000000009")).toBe("300000000000000009");
        expect(store.getInviteChannel(PUG)).toBe("300000000000000009");
        expect(store.setInviteChannel(PUG, "")).toBe("");
        expect(store.getInviteChannel(PUG)).toBe("");
        expect(store.setInviteChannel("", "1")).toBe("");
    });

    it("ignores a patch without an id and cleans broken fields", () => {
        expect(store.setLinkInvite("", { code: "x" })).toEqual({ code: "", channelId: "", createdAt: 0, error: "" });
        expect(store.setLinkInvite(KEY, { code: 5, createdAt: "soon" })).toEqual({ code: "", channelId: "", createdAt: 0, error: "" });
    });
});
