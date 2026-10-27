// Through which invite a member joined (src/stores/memberOriginStore.js, #905).
const store = require("../../src/stores/memberOriginStore");
const { tempStoreFile } = require("../helpers/tempStore");

const PUG = "900000000000000001";
const KEY = "900000000000000001:900000000000000002";
const U1 = "100000000000000001";
const U2 = "100000000000000002";

beforeEach(() => store.useFile(tempStoreFile("member-origins.json")));
afterAll(() => store.useFile(null));

describe("memberOriginStore", () => {
    it("records an origin and finds it by member and by link", () => {
        const rec = store.recordOrigin({ guildId: PUG, userId: U1, inviteCode: "abc", linkKey: KEY }, { now: 10 });
        expect(rec).toEqual({ guildId: PUG, userId: U1, inviteCode: "abc", linkKey: KEY, joinedAt: 10 });
        expect(store.originOf(PUG, U1)).toEqual(rec);
        expect(store.originsOfLink(KEY)).toEqual([rec]);
        expect(store.originsOfLink("")).toEqual([]);
    });

    it("keeps the first known origin when the member joins again", () => {
        store.recordOrigin({ guildId: PUG, userId: U1, inviteCode: "abc", linkKey: KEY }, { now: 10 });
        const again = store.recordOrigin({ guildId: PUG, userId: U1, inviteCode: "other", linkKey: "900000000000000001:900000000000000003" }, { now: 20 });
        expect(again).toEqual(expect.objectContaining({ inviteCode: "abc", joinedAt: 10 }));
        expect(store.originOf(PUG, U1)).toEqual(expect.objectContaining({ inviteCode: "abc", joinedAt: 10 }));
        expect(store.listOrigins()).toHaveLength(1);
    });

    it("never stores an unknown origin", () => {
        expect(store.recordOrigin({ guildId: PUG, userId: U2 }, { now: 10 })).toBeNull();
        expect(store.recordOrigin({ guildId: PUG, userId: U2, inviteCode: "", linkKey: KEY }, { now: 10 })).toBeNull();
        expect(store.originOf(PUG, U2)).toBeNull();
        expect(store.listOrigins()).toEqual([]);
    });

    it("refuses an invalid record, one without a link and one with a malformed link key", () => {
        expect(store.recordOrigin({ guildId: "x", userId: U1, inviteCode: "abc", linkKey: KEY })).toBeNull();
        expect(store.recordOrigin({ guildId: PUG, userId: U1, inviteCode: "abc", linkKey: "nope" }, { now: 5 })).toBeNull();
        // the general invite (linkKey "") is shown nowhere: not stored (data economy)
        expect(store.recordOrigin({ guildId: PUG, userId: U1, inviteCode: "abc", linkKey: "" }, { now: 5 })).toBeNull();
        expect(store.listOrigins()).toEqual([]);
        expect(store.normalizeOrigin(null)).toBeNull();
        expect(store.normalizeOrigin({ guildId: PUG, userId: U1, joinedAt: 5, inviteCode: "" })).toBeNull();
    });

    it("drops the origins of links that are gone", () => {
        const OTHER = "900000000000000001:900000000000000003";
        store.recordOrigin({ guildId: PUG, userId: U1, inviteCode: "abc", linkKey: KEY }, { now: 10 });
        store.recordOrigin({ guildId: PUG, userId: U2, inviteCode: "def", linkKey: OTHER }, { now: 11 });
        expect(store.removeOriginsExcept(new Set([KEY]))).toBe(1);
        expect(store.listOrigins().map((o) => o.userId)).toEqual([U1]);
        expect(store.removeOriginsExcept([KEY])).toBe(0);
        expect(store.removeOriginsExcept([])).toBe(1);
        expect(store.listOrigins()).toEqual([]);
    });
});
