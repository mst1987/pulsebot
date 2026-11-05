// The raiders' Twitch requests on disk: one record per server and account.
const { tempStoreFile } = require("../../helpers/tempStore");
const store = require("../../../src/stores/discord/twitchRequestStore");

const record = (over = {}) => ({
    guildId: "g1", userId: "u1", userName: "Anna", login: "anna", status: "pending", requestedAt: 1, decidedAt: 0, ...over,
});

beforeEach(() => store.useFile(tempStoreFile("twitch-requests.json")));
afterAll(() => store.useFile(null));

describe("twitchRequestStore", () => {
    it("starts empty", () => {
        expect(store.requestOf("g1", "u1")).toBeNull();
        expect(store.requestsOfUser("u1")).toEqual([]);
        expect(store.requestsOfGuild("g1")).toEqual([]);
    });

    it("keeps one record per server and account: a new one replaces the old", () => {
        store.putRequest(record());
        store.putRequest(record({ login: "neu" }));
        expect(store.requestsOfGuild("g1")).toHaveLength(1);
        expect(store.requestOf("g1", "u1").login).toBe("neu");
    });

    it("keeps servers and accounts apart", () => {
        store.putRequest(record());
        store.putRequest(record({ guildId: "g2" }));
        store.putRequest(record({ userId: "u2" }));
        expect(store.requestsOfUser("u1").map((r) => r.guildId).sort()).toEqual(["g1", "g2"]);
        expect(store.requestsOfGuild("g1").map((r) => r.userId).sort()).toEqual(["u1", "u2"]);
        expect(store.requestOf("g2", "u2")).toBeNull();
    });

    it("removes one record and says whether there was one", () => {
        store.putRequest(record());
        expect(store.removeRequest("g1", "u2")).toBe(false);
        expect(store.removeRequest("g1", "u1")).toBe(true);
        expect(store.requestOf("g1", "u1")).toBeNull();
        expect(store.removeRequest("g1", "u1")).toBe(false);
    });
});
