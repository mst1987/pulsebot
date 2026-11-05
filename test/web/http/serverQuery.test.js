// The server of a Discord page's request (#895): guildId of the list, the first
// server by default (an old side=talk too, #897), and 400 unknown_guild for anything else.
// Rights hold per server (#925): only a full admin picks any server; everybody else
// reaches the server active in their session - another guildId answers 403 other_server.
jest.mock("../../../src/stores/settings/configStore", () => ({
    getConfig: () => ({ discordServers: { servers: [{ guildId: "900000000000000001" }, { guildId: "900000000000000002", trusted: true }], links: [] } }),
}));
let mockActive = "900000000000000002";
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => mockActive) }));

let mockClient = null;
jest.mock("../../../src/services/discord/discord", () => ({ getClient: () => mockClient }));

jest.mock("../../../src/web/http/auth", () => ({ getUserWithoutRank: jest.fn(() => null), userForGuild: jest.fn(() => null) }));

const { getUserWithoutRank, userForGuild } = require("../../../src/web/http/auth");
const { serverFromQuery, mayUseServer, mayUseLink, onlyByRank, rolesCountForSharedData, mayWriteSharedData, mayUseChannel, channelOnCategoryServer, guildOfChannel } = require("../../../src/web/http/serverQuery");
const { mockRes, status, json } = require("../../helpers/http");

jest.mock("../../../src/services/characters/profileVisibility", () => ({ raiderVisibility: jest.fn() }));
jest.mock("../../../src/services/discord/members/serverMembers", () => ({ serverMemberIds: jest.fn() }));

const admin = { id: "1", isAdmin: true };
const orga = { id: "7", isAdmin: false, isOrga: true };
const req = {};

const ask = (params, user = admin) => {
    const res = mockRes();
    return { res, out: serverFromQuery(new URLSearchParams(params), res, { user, req }) };
};

beforeEach(() => {
    mockActive = "900000000000000002";
    mockClient = null;
});

describe("web/http/serverQuery - a full admin", () => {
    it("takes the server of the list or the first one", () => {
        expect(ask({ guildId: "900000000000000002" }).out).toBe("900000000000000002");
        expect(ask({ guildId: "900000000000000001" }).out).toBe("900000000000000001");
        expect(ask({}).out).toBe("900000000000000001");
        expect(ask({ side: "talk" }).out).toBe("900000000000000001");
    });

    it("answers 400 unknown_guild for a server outside the list", () => {
        const { res, out } = ask({ guildId: "900000000000000099" });
        expect(out).toBeNull();
        expect(status(res)).toBe(400);
        expect(json(res).error.code).toBe("unknown_guild");
    });

    it("hands an empty id on when no server is configured", () => {
        const res = mockRes();
        const config = { discordServers: { servers: [], links: [] } };
        expect(serverFromQuery(new URLSearchParams(), res, { user: admin, req, config })).toBe("");
    });
});

describe("web/http/serverQuery - everybody else (#925)", () => {
    it("takes the active server without a guildId", () => {
        expect(ask({}, orga).out).toBe("900000000000000002");
    });

    it("takes the active server when asked for it", () => {
        expect(ask({ guildId: "900000000000000002" }, orga).out).toBe("900000000000000002");
    });

    it("answers 403 other_server for another server of the list", () => {
        const { res, out } = ask({ guildId: "900000000000000001" }, orga);
        expect(out).toBeNull();
        expect(status(res)).toBe(403);
        expect(json(res).error.code).toBe("other_server");
    });

    it("answers 403 without an active server", () => {
        mockActive = "";
        const { res, out } = ask({ guildId: "900000000000000001" }, orga);
        expect(out).toBeNull();
        expect(status(res)).toBe(403);
    });

    it("refuses a call without the caller (fail closed)", () => {
        expect(() => serverFromQuery(new URLSearchParams(), mockRes())).toThrow(/user, req/);
        expect(() => serverFromQuery(new URLSearchParams(), mockRes(), { user: orga })).toThrow();
    });
});

describe("mayUseServer", () => {
    it("lets a full admin use every server, everybody else the active one only", () => {
        expect(mayUseServer(admin, req, "900000000000000001")).toBe(true);
        expect(mayUseServer(orga, req, "900000000000000002")).toBe(true);
        expect(mayUseServer(orga, req, "900000000000000001")).toBe(false);
        expect(mayUseServer(orga, req, "")).toBe(false);
        mockActive = "";
        expect(mayUseServer(orga, req, "")).toBe(false);
        expect(mayUseServer(null, req, "900000000000000002")).toBe(false);
    });
});

describe("mayUseLink", () => {
    const FROM = "900000000000000001";
    const TO = "900000000000000002";
    const rank = { id: "7", isAdmin: false, isServerAdmin: true };
    const rankOn = (...guildIds) => userForGuild.mockImplementation((_req, guildId) => (guildIds.includes(guildId) ? { isServerAdmin: true } : { isServerAdmin: false }));
    afterEach(() => userForGuild.mockReset().mockReturnValue(null));

    it("lets a full admin use every link, without asking for the rank", () => {
        expect(mayUseLink(admin, req, FROM, TO)).toBe(true);
        expect(userForGuild).not.toHaveBeenCalled();
    });

    it("needs the rank on both servers", () => {
        rankOn(FROM, TO);
        expect(mayUseLink(rank, req, FROM, TO)).toBe(true);
        rankOn(FROM);
        expect(mayUseLink(rank, req, FROM, TO)).toBe(false);
        rankOn(TO);
        expect(mayUseLink(rank, req, FROM, TO)).toBe(false);
    });

    it("refuses without the rank, without a user and for an unknown member", () => {
        rankOn(FROM, TO);
        expect(mayUseLink(orga, req, FROM, TO)).toBe(false);
        expect(mayUseLink(null, req, FROM, TO)).toBe(false);
        userForGuild.mockImplementation(() => null);
        expect(mayUseLink(rank, req, FROM, TO)).toBe(false);
    });

    it("the flag of the server must be true itself", () => {
        userForGuild.mockImplementation(() => ({ isServerAdmin: "yes" }));
        expect(mayUseLink(rank, req, FROM, TO)).toBe(false);
    });
});

describe("mayWriteSharedData (#1105)", () => {
    const req = {};
    const write = { raids: { read: true, write: true } };
    const trust = (on) => { mockActive = on ? "900000000000000002" : "900000000000000001"; };
    beforeEach(() => {
        getUserWithoutRank.mockClear();
        getUserWithoutRank.mockReturnValue({ id: "1", isAdmin: false, access: {} });
    });
    afterEach(() => { mockActive = "900000000000000002"; });

    it("opens for a full admin everywhere, and for nobody without a session", () => {
        trust(false);
        expect(mayWriteSharedData({ id: "1", isAdmin: true }, req)).toBe(true);
        expect(mayWriteSharedData(null, req)).toBe(false);
    });

    it("opens on a server with the mark", () => {
        trust(true);
        expect(mayWriteSharedData({ id: "1", access: write }, req)).toBe(true);
    });

    it("counts no right on a server without the mark, an own grant neither", () => {
        trust(false);
        getUserWithoutRank.mockReturnValue({ id: "1", isAdmin: false, access: write });
        expect(mayWriteSharedData({ id: "1", isServerAdmin: true, access: write }, req)).toBe(false);
        expect(mayWriteSharedData({ id: "1", access: write }, req)).toBe(false);
        expect(getUserWithoutRank).not.toHaveBeenCalled();
    });
});

describe("onlyByRank (#1072)", () => {
    const rank = { id: "9", isAdmin: false, isServerAdmin: true };
    const roles = { id: "9", isAdmin: false };

    beforeEach(() => {
        getUserWithoutRank.mockClear();
        getUserWithoutRank.mockReturnValue(roles);
    });

    // #1073: an administrator gives themselves any role, so without the mark the roles do not vouch for anybody
    describe("on a server without the mark (#1073)", () => {
        const UNMARKED = "900000000000000001";
        afterEach(() => { mockActive = "900000000000000002"; });

        it("holds for somebody without the rank too, whatever the session's roles say", () => {
            mockActive = UNMARKED;
            expect(onlyByRank(orga, req, () => false)).toBe(true);
            expect(rolesCountForSharedData(req)).toBe(false);
        });

        it("asks what counts without the roles: an own grant or the base access still passes", () => {
            mockActive = UNMARKED;
            const rolesMay = jest.fn(() => true);
            expect(onlyByRank(orga, req, rolesMay)).toBe(false);
            expect(rolesMay).toHaveBeenCalledWith(roles);
        });

        it("never holds for a full admin", () => {
            mockActive = UNMARKED;
            expect(onlyByRank(admin, req, () => false)).toBe(false);
        });

        it("counts the roles on the marked server for the same person", () => {
            expect(rolesCountForSharedData(req)).toBe(true);
            expect(onlyByRank(orga, req, () => false)).toBe(false);
        });

        it("fails closed without an active server", () => {
            mockActive = "";
            expect(rolesCountForSharedData(req)).toBe(false);
        });
    });

    it("never holds on a trusted server for somebody without the rank, and does not look at the roles", () => {
        const rolesMay = jest.fn(() => false);
        expect(onlyByRank(orga, req, rolesMay)).toBe(false);
        expect(onlyByRank(admin, req, rolesMay)).toBe(false);
        expect(onlyByRank(null, req, rolesMay)).toBe(false);
        expect(getUserWithoutRank).not.toHaveBeenCalled();
        expect(rolesMay).not.toHaveBeenCalled();
    });

    it("holds for the rank unless the rights without it allow the same", () => {
        expect(onlyByRank(rank, req, () => false)).toBe(true);
        expect(onlyByRank(rank, req, () => true)).toBe(false);
        expect(getUserWithoutRank).toHaveBeenCalledWith(req);
    });

    it("hands the rights without the rank to the check, null when nothing is known of them", () => {
        const rolesMay = jest.fn(() => false);
        onlyByRank(rank, req, rolesMay);
        expect(rolesMay).toHaveBeenCalledWith(roles);
        getUserWithoutRank.mockReturnValue(null);
        onlyByRank(rank, req, rolesMay);
        expect(rolesMay).toHaveBeenLastCalledWith(null);
    });
});

describe("mayUseChannel / guildOfChannel (#925)", () => {
    const cache = new Map([
        ["c1", { id: "c1", guildId: "900000000000000001" }],
        ["c2", { id: "c2", guild: { id: "900000000000000002" } }],
    ]);

    it("reads the server of a channel from the bot's cache", () => {
        mockClient = { channels: { cache } };
        expect(guildOfChannel("c1")).toBe("900000000000000001");
        expect(guildOfChannel("c2")).toBe("900000000000000002");
        expect(guildOfChannel("c9")).toBe("");
        expect(guildOfChannel("")).toBe("");
    });

    it("lets everybody but a full admin use channels of the active server only (fail closed)", () => {
        mockClient = { channels: { cache } };
        expect(mayUseChannel(orga, req, "c2")).toBe(true);
        expect(mayUseChannel(orga, req, "c1")).toBe(false);
        expect(mayUseChannel(orga, req, "c9")).toBe(false);
        expect(mayUseChannel(admin, req, "c1")).toBe(true);
        mockClient = null; // bot offline: the server of no channel is known
        expect(mayUseChannel(orga, req, "c2")).toBe(false);
        expect(mayUseChannel(admin, req, "c9")).toBe(true);
    });

    it("keeps a category's message on its server, and does not guess while the bot cannot tell", () => {
        mockClient = { channels: { cache: new Map([...cache, ["cat1", { id: "cat1", guildId: "900000000000000001" }]]) } };
        expect(channelOnCategoryServer("cat1", "c1")).toBe(true);
        expect(channelOnCategoryServer("cat1", "c2")).toBe(false);
        expect(channelOnCategoryServer("cat1", "c9")).toBe(true);
        expect(channelOnCategoryServer("cat9", "c2")).toBe(true);
        mockClient = null;
        expect(channelOnCategoryServer("cat1", "c2")).toBe(true);
    });
});

describe("the raiders a caller reaches (#1077)", () => {
    const { raiderReachFor, visibleRaidersFor, outsideReach, takeInLimit, membersUnavailable, MEMBERS_UNAVAILABLE, OUTSIDE_SERVER } = require("../../../src/web/http/serverQuery");
    const { raiderVisibility } = require("../../../src/services/characters/profileVisibility");
    const { serverMemberIds } = require("../../../src/services/discord/members/serverMembers");
    const readable = (...ids) => ({ ids: new Set(ids), membersKnown: true });

    beforeEach(() => {
        raiderVisibility.mockReset();
        serverMemberIds.mockReset();
    });

    it("sets no limit for a full admin and reads no list for them", async () => {
        expect(await raiderReachFor(admin, req)).toEqual({ visible: null, membersKnown: true });
        expect(await raiderReachFor(admin, req, { membersOnly: true })).toEqual({ visible: null, membersKnown: true });
        expect(await visibleRaidersFor(admin, req)).toBeNull();
        expect(raiderVisibility).not.toHaveBeenCalled();
        expect(serverMemberIds).not.toHaveBeenCalled();
    });

    describe("takeInLimit, the bulk ways into a roster", () => {
        const rank = { id: "9", isAdmin: false, isServerAdmin: true };
        const rolesMay = (user) => !!user && user.mayBulk === true;

        afterEach(() => getUserWithoutRank.mockReset());

        it("sets no limit for a full admin, or for a rank whose role allows the way anyway", async () => {
            expect(await takeInLimit(admin, req, rolesMay)).toEqual({ mayTakeIn: null, unavailable: false });
            getUserWithoutRank.mockReturnValue({ id: "9", mayBulk: true });
            expect(await takeInLimit(rank, req, rolesMay)).toEqual({ mayTakeIn: null, unavailable: false });
            expect(serverMemberIds).not.toHaveBeenCalled();
        });

        it("limits the rank alone to the members of the active server, not even the caller on top", async () => {
            getUserWithoutRank.mockReturnValue({ id: "9", mayBulk: false });
            serverMemberIds.mockResolvedValue(new Set(["m1"]));
            const { mayTakeIn, unavailable } = await takeInLimit(rank, req, rolesMay);
            expect(serverMemberIds).toHaveBeenCalledWith(mockActive);
            expect(unavailable).toBe(false);
            expect(["m1", "9", "other"].map(mayTakeIn)).toEqual([true, false, false]);
        });

        it("says so when the member list cannot be read, and refuses everybody", async () => {
            getUserWithoutRank.mockReturnValue(null);
            serverMemberIds.mockResolvedValue(null);
            const { mayTakeIn, unavailable } = await takeInLimit(rank, req, rolesMay);
            expect(unavailable).toBe(true);
            expect(mayTakeIn("m1")).toBe(false);
        });
    });

    it("gives the active server's raiders and the caller", async () => {
        raiderVisibility.mockResolvedValue(readable("m1"));
        const reach = await raiderReachFor(orga, req);
        expect(raiderVisibility).toHaveBeenCalledWith(mockActive);
        expect([...reach.visible].sort()).toEqual(["7", "m1"]);
        expect(reach.membersKnown).toBe(true);
    });

    it("says when the member list could not be read, and only the signups count", async () => {
        raiderVisibility.mockResolvedValue({ ids: new Set(["signed"]), membersKnown: false });
        const reach = await raiderReachFor(orga, req);
        expect([...reach.visible].sort()).toEqual(["7", "signed"]);
        expect(reach.membersKnown).toBe(false);
    });

    it("adds nobody to the set for a caller without an id", async () => {
        for (const caller of [null, { isAdmin: false }]) {
            raiderVisibility.mockResolvedValue(readable("m1"));
            const reach = await raiderReachFor(caller, req);
            expect([...reach.visible]).toEqual(["m1"]);
        }
    });

    it("gives only the members with membersOnly, the caller not added", async () => {
        serverMemberIds.mockResolvedValue(new Set(["m1"]));
        const reach = await raiderReachFor(orga, req, { membersOnly: true });
        expect(serverMemberIds).toHaveBeenCalledWith(mockActive);
        expect([...reach.visible]).toEqual(["m1"]);
        expect(reach.membersKnown).toBe(true);
        expect(raiderVisibility).not.toHaveBeenCalled();

        serverMemberIds.mockResolvedValue(null);
        const unread = await raiderReachFor(orga, req, { membersOnly: true });
        expect([...unread.visible]).toEqual([]);
        expect(unread.membersKnown).toBe(false);
    });

    it("hands a list only the set, also a shortened one", async () => {
        raiderVisibility.mockResolvedValue({ ids: new Set(["signed"]), membersKnown: false });
        expect([...(await visibleRaidersFor(orga, req))].sort()).toEqual(["7", "signed"]);
    });

    it("tells an account out of reach from a member list that is missing", () => {
        const known = { visible: new Set(["m1"]), membersKnown: true };
        const unknown = { visible: new Set(["m1"]), membersKnown: false };
        expect(outsideReach({ visible: null, membersKnown: true }, "x")).toBe("");
        expect(outsideReach(known, "m1")).toBe("");
        expect(outsideReach(unknown, "m1")).toBe("");
        expect(outsideReach(known, "x")).toBe(OUTSIDE_SERVER);
        expect(outsideReach(unknown, "x")).toBe(MEMBERS_UNAVAILABLE);
        // no account named: nothing a member list could answer
        expect(outsideReach(unknown, "")).toBe(OUTSIDE_SERVER);
    });

    it("answers 503 for a missing member list", () => {
        const res = mockRes();
        membersUnavailable(res);
        expect(res.writeHead.mock.calls[0][0]).toBe(503);
        expect(JSON.parse(res.end.mock.calls[0][0]).error.code).toBe(MEMBERS_UNAVAILABLE);
    });
});
