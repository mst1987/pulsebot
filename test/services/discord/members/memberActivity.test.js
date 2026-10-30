// Joins and leaves from the gateway events (src/services/discord/members/memberActivity.js):
// only configured servers and humans, roles on a leave, never a throw, and the
// relation to rosters and characters the overview shows.
const mockRosters = [];
const mockProfiles = {};
const mockAssignments = {};
const mockSignups = {};
const mockEvents = [];
jest.mock("../../../../src/services/discord/roles/guildRoles", () => ({
    guildRole: (gid) => (gid === "900000000000000001" ? "event" : gid === "900000000000000002" ? "talk" : ""),
}));
jest.mock("../../../../src/stores/rosterStore", () => ({
    listRosters: () => mockRosters,
    isClosed: (r) => !!r.closedAt,
}));
jest.mock("../../../../src/stores/raiderProfileStore", () => ({
    hasProfile: (uid) => !!mockProfiles[uid],
    getProfile: (uid) => mockProfiles[uid],
}));
jest.mock("../../../../src/stores/raiderCharactersStore", () => ({
    charactersForUser: (uid) => mockAssignments[uid] || [],
}));
jest.mock("../../../../src/stores/signupStore", () => ({
    signupsOfUser: (uid) => mockSignups[uid] || {},
}));
jest.mock("../../../../src/stores/eventStore", () => ({
    listEvents: (gid) => mockEvents.filter((e) => e.guildId === gid),
}));

const memberActivity = require("../../../../src/services/discord/members/memberActivity");
const store = require("../../../../src/stores/memberActivityStore");
const signals = require("../../../../src/stores/userSignalsStore");
const { tempStoreFile } = require("../../../helpers/tempStore");
const fs = require("fs");

const EVENT = "900000000000000001";
const OTHER = "900000000000000009";
const U1 = "100000000000000001";

function member({ guildId = EVENT, id = U1, bot = false, roles = [] } = {}) {
    const cache = new Map([[guildId, { id: guildId, name: "@everyone" }], ...roles.map((r) => [r.id, r])]);
    return { id, guild: { id: guildId }, displayName: "Ostrava", user: { bot, username: "ostrava" }, roles: { cache } };
}

beforeEach(() => {
    store.useFile(tempStoreFile("member-activity.json"));
    const signalFile = tempStoreFile("user-signals.json");
    if (fs.existsSync(signalFile)) fs.unlinkSync(signalFile);
    signals.useFile(signalFile);
    mockRosters.length = 0;
    for (const k of Object.keys(mockProfiles)) delete mockProfiles[k];
    for (const k of Object.keys(mockAssignments)) delete mockAssignments[k];
    for (const k of Object.keys(mockSignups)) delete mockSignups[k];
    mockEvents.length = 0;
});
afterAll(() => {
    store.useFile(null);
    signals.useFile(null);
});

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

    it("never throws on a member object that breaks while it is read", () => {
        const broken = { get user() { throw new Error("partial"); }, guild: { id: EVENT } };
        expect(() => memberActivity.onMemberAdd(broken)).not.toThrow();
        expect(memberActivity.onMemberAdd(broken)).toBeNull();
        expect(memberActivity.onMemberRemove(broken)).toBeNull();
        expect(store.listEntries()).toEqual([]);
    });
});

describe("leave hint for the Vermerke (#982)", () => {
    const hints = () => signals.eventsFor(EVENT);

    it("notes nothing for somebody without a roster or a signup of the server", () => {
        mockAssignments[U1] = [{ character: "Twink" }]; // characters alone tie nobody to this server
        memberActivity.onMemberRemove(member());
        expect(hints()).toEqual({});
    });

    it("notes leaving the server for somebody in its roster or signed up at its raids", () => {
        mockRosters.push({ id: "r1", guildId: EVENT, name: "TBC Main", categoryId: "c1", members: { [U1]: { status: "raider" } } });
        memberActivity.onMemberRemove(member());
        expect(hints()[U1]).toEqual({ name: "Ostrava", events: [expect.objectContaining({ kind: "left_server", eventId: "" })] });

        const U2 = "100000000000000002";
        mockEvents.push({ id: "e1", guildId: EVENT });
        mockSignups[U2] = { e1: { userId: U2, status: "primary" } };
        memberActivity.onMemberRemove(member({ id: U2 }));
        expect(Object.keys(hints()).sort()).toEqual([U1, U2]);
    });

    it("notes nothing when the roster or the signups belong to another server", () => {
        const ELSE = "900000000000000002";
        mockRosters.push({ id: "r2", guildId: ELSE, name: "Forever", categoryId: "c2", members: { [U1]: { status: "raider" } } });
        mockEvents.push({ id: "e2", guildId: ELSE });
        mockSignups[U1] = { e2: { userId: U1, status: "primary" } };
        memberActivity.onMemberRemove(member());
        expect(hints()).toEqual({});
        expect(signals.eventsFor(ELSE)).toEqual({});
    });

    it("notes no hint on a join, for a bot or on another server", () => {
        mockRosters.push({ id: "r1", guildId: EVENT, name: "TBC Main", categoryId: "c1", members: { [U1]: { status: "raider" } } });
        memberActivity.onMemberAdd(member());
        memberActivity.onMemberRemove(member({ bot: true }));
        memberActivity.onMemberRemove(member({ guildId: OTHER }));
        expect(hints()).toEqual({});
        expect(signals.eventsFor(OTHER)).toEqual({});
    });

    it("still notes the leave when the hint fails", () => {
        mockRosters.push({ id: "r1", guildId: EVENT, name: "TBC Main", categoryId: "c1", members: { [U1]: { status: "raider" } } });
        const spy = jest.spyOn(signals, "recordEvent").mockImplementation(() => { throw new Error("disk full"); });
        try {
            expect(memberActivity.onMemberRemove(member())).toEqual(expect.objectContaining({ kind: "leave" }));
        } finally {
            spy.mockRestore();
        }
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

    it("counts a roster character too, once per version and name (docs/discord-servers.md)", () => {
        mockRosters.push(
            { id: "r1", name: "TBC Main", versionId: "tbc", members: { [U1]: { status: "raider", chars: ["heiltrank-tbc"], charNames: { "heiltrank-tbc": "Heiltrank" } } } },
            { id: "r3", name: "Forever", versionId: "forever", members: { [U1]: { status: "raider", chars: ["ostrava-forever"], charNames: { "ostrava-forever": "Ostrava" } } } },
        );
        mockProfiles[U1] = { characters: [{ name: "Ostrava", versionId: "tbc" }] };
        // Ostrava (TBC), Heiltrank (TBC, roster only), Ostrava (Forever)
        expect(memberActivity.relationOf(U1).characters).toBe(3);
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
