// Joins and leaves from the gateway events (src/services/discord/memberActivity.js):
// only configured servers and humans, roles on a leave, never a throw, and the
// relation to rosters and characters the overview shows.
const mockRosters = [];
const mockProfiles = {};
const mockAssignments = {};
jest.mock("../../../src/services/discord/guildRoles", () => ({
    guildRole: (gid) => (gid === "900000000000000001" ? "event" : gid === "900000000000000002" ? "talk" : ""),
}));
jest.mock("../../../src/stores/rosterStore", () => ({
    listRosters: () => mockRosters,
    isClosed: (r) => !!r.closedAt,
}));
jest.mock("../../../src/stores/raiderProfileStore", () => ({
    hasProfile: (uid) => !!mockProfiles[uid],
    getProfile: (uid) => mockProfiles[uid],
}));
jest.mock("../../../src/stores/raiderCharactersStore", () => ({
    charactersForUser: (uid) => mockAssignments[uid] || [],
}));

const memberActivity = require("../../../src/services/discord/memberActivity");
const store = require("../../../src/stores/memberActivityStore");
const { tempStoreFile } = require("../../helpers/tempStore");

const EVENT = "900000000000000001";
const OTHER = "900000000000000009";
const U1 = "100000000000000001";

function member({ guildId = EVENT, id = U1, bot = false, roles = [] } = {}) {
    const cache = new Map([[guildId, { id: guildId, name: "@everyone" }], ...roles.map((r) => [r.id, r])]);
    return { id, guild: { id: guildId }, displayName: "Ostrava", user: { bot, username: "ostrava" }, roles: { cache } };
}

beforeEach(() => {
    store.useFile(tempStoreFile("member-activity.json"));
    mockRosters.length = 0;
    for (const k of Object.keys(mockProfiles)) delete mockProfiles[k];
    for (const k of Object.keys(mockAssignments)) delete mockAssignments[k];
});
afterAll(() => store.useFile(null));

describe("onMemberAdd / onMemberRemove", () => {
    it("notes a join on a configured server", () => {
        expect(memberActivity.onMemberAdd(member())).toEqual(expect.objectContaining({ guildId: EVENT, userId: U1, name: "Ostrava", kind: "join", roles: [] }));
    });

    it("notes a leave with the roles, without @everyone", () => {
        const left = memberActivity.onMemberRemove(member({ roles: [{ id: "200000000000000001", name: "TBC-Raider" }] }));
        expect(left.roles).toEqual([{ id: "200000000000000001", name: "TBC-Raider" }]);
    });

    it("ignores bots and servers that are not configured", () => {
        expect(memberActivity.onMemberAdd(member({ bot: true }))).toBeNull();
        expect(memberActivity.onMemberAdd(member({ guildId: OTHER }))).toBeNull();
        expect(memberActivity.onMemberRemove(null)).toBeNull();
        expect(store.listEntries()).toEqual([]);
    });

    it("never throws when the store fails", () => {
        const spy = jest.spyOn(store, "record").mockImplementation(() => { throw new Error("disk full"); });
        expect(() => memberActivity.onMemberAdd(member())).not.toThrow();
        expect(memberActivity.onMemberAdd(member())).toBeNull();
        spy.mockRestore();
    });
});

describe("relationOf / recentActivity", () => {
    it("names the open rosters and counts each character once", () => {
        mockRosters.push(
            { id: "r1", name: "TBC Main", categoryId: "c1", members: { [U1]: { status: "raider" } } },
            { id: "r2", name: "Alt", categoryId: "c2", closedAt: 1, members: { [U1]: { status: "raider" } } },
        );
        mockProfiles[U1] = { characters: [{ name: "Ostrava" }, { name: "Twink" }] };
        mockAssignments[U1] = [{ character: "ostrava" }, { character: "Dritter" }];
        expect(memberActivity.relationOf(U1)).toEqual({
            rosters: [{ id: "r1", name: "TBC Main", categoryId: "c1", status: "raider" }],
            characters: 3,
        });
        expect(memberActivity.relationOf("")).toEqual({ rosters: [], characters: 0 });
    });

    it("lists the last days of one server with the relation", () => {
        const now = Date.now();
        store.record({ guildId: EVENT, userId: U1, kind: "join" }, { now: now - 8 * 24 * 3600 * 1000 });
        store.record({ guildId: EVENT, userId: U1, kind: "leave" }, { now });
        const list = memberActivity.recentActivity(EVENT, { days: 7, now });
        expect(list.map((e) => e.kind)).toEqual(["leave"]);
        expect(list[0].relation).toEqual({ rosters: [], characters: 0 });
        expect(memberActivity.recentActivity("")).toEqual([]);
    });
});
