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

const { serverFromQuery, mayUseServer, mayUseChannel, guildOfChannel } = require("../../../src/web/http/serverQuery");
const { mockRes, status, json } = require("../../helpers/http");

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
});
