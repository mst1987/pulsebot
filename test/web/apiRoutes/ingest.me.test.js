// GET /api/ingest/me and the 403 `no_server` (#1000) through the real router: who the sync app is
// connected as, for a personal, a server and an old key, and a personal key whose owner is orga nowhere.
const { status, json, routerClient, mockRes } = require("../../helpers/http");

jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => null),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../src/stores/ingestTokenStore", () => ({
    verifyToken: jest.fn(),
    touchToken: jest.fn(),
    bearerFrom: (req) => {
        const h = (req.headers && req.headers.authorization) || "";
        return h.startsWith("Bearer ") ? h.slice(7) : "";
    },
}));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/services/discord/guildRoles", () => ({
    ...jest.requireActual("../../../src/services/discord/guildRoles"),
    serverIds: jest.fn(() => ["gA", "gB"]),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    resolveUserNames: jest.fn(async () => ({ u1: "Anna" })),
}));
jest.mock("../../../src/services/discord/ingestServers", () => ({
    ...jest.requireActual("../../../src/services/discord/ingestServers"),
    orgaServersOf: jest.fn(async () => []),
    serversOfToken: jest.fn(async () => []),
    describeServers: jest.fn((servers) => servers.map((s) => ({
        guildId: s.guildId, name: `Server ${s.guildId}`, label: "", role: s.role || "",
        versions: [{ id: "tbc", short: "TBC", realm: "Thunderstrike" }],
    }))),
}));

const { verifyToken, touchToken } = require("../../../src/stores/ingestTokenStore");
const { orgaServersOf, serversOfToken } = require("../../../src/services/discord/ingestServers");
const { resolveUserNames } = require("../../../src/services/discord/discord");
const ingest = require("../../../src/web/apiRoutes/ingest");

const { handle, urlFor, post } = routerClient(ingest);
const AUTH = { authorization: "Bearer ehl_good" };

async function call(method, path, body) {
    if (method === "POST") return post(path, body, AUTH);
    const res = mockRes();
    await handle(path, { method, headers: AUTH }, res, urlFor(path));
    return res;
}

beforeEach(() => {
    jest.clearAllMocks();
    orgaServersOf.mockResolvedValue([]);
    serversOfToken.mockResolvedValue([]);
});

const VERSIONS = [{ id: "tbc", short: "TBC", realm: "Thunderstrike" }];

describe("GET /api/ingest/me", () => {
    it("names the owner of a personal key and lists the servers they are orga of", async () => {
        verifyToken.mockReturnValue({ id: "t1", name: "Laptop", ownerId: "u1", guildId: "" });
        orgaServersOf.mockResolvedValue([{ guildId: "gA", role: "orga" }, { guildId: "gB", role: "category" }]);
        const res = await call("GET", "/api/ingest/me");
        expect(status(res)).toBe(200);
        expect(json(res).data).toEqual({
            owner: { name: "Anna" },
            servers: [
                { guildId: "gA", name: "Server gA", label: "", role: "orga", versions: VERSIONS },
                { guildId: "gB", name: "Server gB", label: "", role: "category", versions: VERSIONS },
            ],
            legacy: null,
        });
        expect(orgaServersOf).toHaveBeenCalledWith("u1", expect.any(Object));
        expect(touchToken).toHaveBeenCalledWith("t1");
    });

    it("answers a personal key whose owner is orga nowhere with an empty list, not a 403", async () => {
        verifyToken.mockReturnValue({ id: "t1", name: "Laptop", ownerId: "u1" });
        const res = await call("GET", "/api/ingest/me");
        expect(status(res)).toBe(200);
        expect(json(res).data).toEqual({ owner: { name: "Laptop" }, servers: [], legacy: null });
        expect(resolveUserNames).not.toHaveBeenCalled();
    });

    it("gives a server key its one server and legacy", async () => {
        verifyToken.mockReturnValue({ id: "t2", name: "Server-PC", guildId: "gA" });
        const data = json(await call("GET", "/api/ingest/me")).data;
        expect(data).toEqual({
            owner: { name: "Server-PC" },
            servers: [{ guildId: "gA", name: "Server gA", label: "", role: "", versions: VERSIONS }],
            legacy: { guildId: "gA" },
        });
        expect(orgaServersOf).not.toHaveBeenCalled();
    });

    it("lists every server for an old key, legacy null", async () => {
        verifyToken.mockReturnValue({ id: "t3", name: "Alt" });
        const data = json(await call("GET", "/api/ingest/me")).data;
        expect(data.owner).toEqual({ name: "Alt" });
        expect(data.servers.map((s) => s.guildId)).toEqual(["gA", "gB"]);
        expect(data.legacy).toBeNull();
    });

    it("refuses an unknown key", async () => {
        verifyToken.mockReturnValue(null);
        expect(status(await call("GET", "/api/ingest/me"))).toBe(401);
    });
});

describe("a personal key without an orga server", () => {
    it("gets the 403 no_server on an upload", async () => {
        verifyToken.mockReturnValue({ id: "t1", name: "Laptop", ownerId: "u1" });
        serversOfToken.mockResolvedValue([]);
        const res = await call("POST", "/api/ingest/raids", { raids: [] });
        expect(status(res)).toBe(403);
        expect(json(res).error.code).toBe("no_server");
    });
});
