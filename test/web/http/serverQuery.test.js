// The server of a Discord page's request (#895): guildId of the list, the first
// server by default (an old side=talk too, #897), and 400 unknown_guild for anything else.
// Rights hold per server (#925): only a full admin picks any server; everybody else
// reaches the server active in their session - another guildId answers 403 other_server.
jest.mock("../../../src/stores/settings/configStore", () => ({
    getConfig: () => ({ discordServers: { servers: [{ guildId: "900000000000000001" }, { guildId: "900000000000000002" }], links: [] } }),
}));
let mockActive = "900000000000000002";
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => mockActive) }));

let mockClient = null;
jest.mock("../../../src/services/discord/discord", () => ({ getClient: () => mockClient }));

jest.mock("../../../src/web/http/auth", () => ({ getUserWithoutRank: jest.fn(() => null) }));

const { getUserWithoutRank } = require("../../../src/web/http/auth");
const { serverFromQuery, mayUseServer, onlyByRank, mayUseChannel, channelOnCategoryServer, guildOfChannel } = require("../../../src/web/http/serverQuery");
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

describe("onlyByRank (#1072)", () => {
    const rank = { id: "9", isAdmin: false, isServerAdmin: true };
    const roles = { id: "9", isAdmin: false };

    beforeEach(() => {
        getUserWithoutRank.mockClear();
        getUserWithoutRank.mockReturnValue(roles);
    });

    it("never holds for somebody without the rank, and does not look at the roles", () => {
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
    const { raiderReachFor, visibleRaidersFor, outsideReach, membersUnavailable, MEMBERS_UNAVAILABLE, OUTSIDE_SERVER } = require("../../../src/web/http/serverQuery");
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
