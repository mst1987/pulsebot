// Joins and leaves of the configured servers (src/stores/discord/memberActivityStore.js):
// validation, roles only on a leave, KEEP_DAYS (14) and the entry cap.
const store = require("../../../src/stores/discord/memberActivityStore");
const { tempStoreFile } = require("../../helpers/tempStore");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 20, 12);
const G1 = "900000000000000001";
const G2 = "900000000000000002";
const U1 = "100000000000000001";
const U2 = "100000000000000002";

beforeEach(() => store.useFile(tempStoreFile("member-activity.json")));
afterAll(() => store.useFile(null));

describe("record", () => {
    it("stores a join without roles and a leave with them", () => {
        const join = store.record({ guildId: G1, userId: U1, name: "Ostrava", kind: "join", roles: [{ id: "200000000000000001", name: "x" }] }, { now: NOW });
        expect(join).toEqual({ guildId: G1, userId: U1, name: "Ostrava", at: NOW, kind: "join", roles: [] });
        const leave = store.record({ guildId: G1, userId: U1, name: "Ostrava", kind: "leave", roles: [{ id: "200000000000000001", name: "Raider" }, { id: "200000000000000001", name: "twice" }, { id: "bad", name: "no" }] }, { now: NOW + 1 });
        expect(leave.roles).toEqual([{ id: "200000000000000001", name: "Raider" }]);
        expect(store.listEntries({ since: 0 }).map((e) => e.kind)).toEqual(["leave", "join"]);
    });

    it("refuses an entry without ids or with an unknown kind", () => {
        expect(store.record({ guildId: "", userId: U1, kind: "join" }, { now: NOW })).toBeNull();
        expect(store.record({ guildId: G1, userId: "abc", kind: "join" }, { now: NOW })).toBeNull();
        expect(store.record({ guildId: G1, userId: U1, kind: "kick" }, { now: NOW })).toBeNull();
        expect(store.listEntries()).toEqual([]);
    });

    it("drops entries older than 14 days on the next write", () => {
        expect(store.KEEP_DAYS).toBe(14);
        store.record({ guildId: G1, userId: U1, kind: "join" }, { now: NOW - 15 * DAY });
        store.record({ guildId: G1, userId: U2, kind: "join" }, { now: NOW });
        expect(store.listEntries().map((e) => e.userId)).toEqual([U2]);
    });

    it("keeps at most MAX_ENTRIES, the oldest go", () => {
        const many = Array.from({ length: store.MAX_ENTRIES + 5 }, (_, i) => ({ guildId: G1, userId: U1, kind: "join", at: NOW - (store.MAX_ENTRIES + 5 - i) }));
        const kept = store.prune(many, NOW);
        expect(kept).toHaveLength(store.MAX_ENTRIES);
        expect(kept[0].at).toBe(NOW - store.MAX_ENTRIES);
    });
});

describe("listEntries", () => {
    it("filters by server and time, newest first", () => {
        store.record({ guildId: G1, userId: U1, kind: "join" }, { now: NOW - 10 * DAY });
        store.record({ guildId: G1, userId: U2, kind: "join" }, { now: NOW - DAY });
        store.record({ guildId: G2, userId: U1, kind: "leave" }, { now: NOW });
        expect(store.listEntries({ guildId: G1, since: NOW - 7 * DAY }).map((e) => e.userId)).toEqual([U2]);
        expect(store.listEntries({ since: 0 }).map((e) => e.guildId)).toEqual([G2, G1, G1]);
    });
});
