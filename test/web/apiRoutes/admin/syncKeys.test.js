// "Mein Profil › Sync-App" (src/web/apiRoutes/admin/syncKeys.js, #1000) through the real router: only the
// orga mints keys, everyone sees and revokes their own (a full admin any person's), the plaintext once.
let mockUser = null;
jest.mock("../../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    getRealUser: jest.fn(() => mockUser),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
    getActiveGuild: jest.fn(() => "g1"),
    sessionGuildAccess: jest.fn(() => null),
}));
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1"), pickActiveGuild: jest.fn(async () => "g1") }));
jest.mock("../../../../src/services/discord/ingestServers", () => ({
    orgaServersOf: jest.fn(async () => []),
    describeServers: jest.fn((servers) => servers.map((s) => ({ ...s, name: `Server ${s.guildId}`, label: "", versions: [] }))),
}));

const { tempStoreFile } = require("../../../helpers/tempStore");
const { routerClient, status, json } = require("../../../helpers/http");
const { emptyAccess } = require("../../../../src/config/permissions");
const tokens = require("../../../../src/stores/ingestTokenStore");
const { orgaServersOf } = require("../../../../src/services/discord/ingestServers");
const { sessionGuildAccess } = require("../../../../src/web/http/auth");
const route = require("../../../../src/web/apiRoutes/admin/syncKeys");

const api = routerClient(route);
const raiderAccess = () => ({ ...emptyAccess(), signup: { read: true, write: true } });
const ANNA = { id: "u1", name: "Anna", isAdmin: false, access: raiderAccess() };
const BERT = { id: "u2", name: "Bert", isAdmin: false, access: raiderAccess() };
const ADMIN = { id: "u9", name: "Admin", isAdmin: true, access: emptyAccess() };

beforeEach(() => {
    tokens.useFile(tempStoreFile("ingest-tokens-sync-keys.json"));
    orgaServersOf.mockReset().mockResolvedValue([]);
});
afterAll(() => tokens.useFile(null));

const orgaOf = (map) => orgaServersOf.mockImplementation(async (id) => map[id] || []);

describe("GET /api/profile/sync-keys", () => {
    it("hides the section from a raider without orga", async () => {
        mockUser = ANNA;
        const res = await api.get("/api/profile/sync-keys");
        expect(status(res)).toBe(200);
        expect(json(res).data).toEqual({ allowed: false, servers: [], keys: [], max: route.MAX_KEYS });
    });

    it("gives the orga its own keys only, with the servers they count for, never a secret", async () => {
        orgaOf({ u1: [{ guildId: "g1", role: "orga" }, { guildId: "g2", role: "category" }] });
        tokens.createPersonToken("Laptop", "u1");
        tokens.createPersonToken("PC Bert", "u2");
        tokens.createToken("Server-PC", "Admin", "g1");
        mockUser = ANNA;
        const data = json(await api.get("/api/profile/sync-keys")).data;
        expect(data.allowed).toBe(true);
        expect(data.servers).toEqual([
            { guildId: "g1", name: "Server g1", label: "", role: "orga" },
            { guildId: "g2", name: "Server g2", label: "", role: "category" },
        ]);
        expect(data.keys.map((k) => k.name)).toEqual(["Laptop"]);
        expect(Object.keys(data.keys[0]).sort()).toEqual(["createdAt", "hint", "id", "lastUsedAt", "name", "uses"]);
    });

    it("counts the viewed rights in \"Ansicht als Raider\"", async () => {
        orgaOf({ u9: [{ guildId: "g1", role: "admin" }] });
        tokens.createPersonToken("Admin-PC", "u9");
        mockUser = { ...ADMIN, isAdmin: false, access: raiderAccess(), viewAs: { roleIds: ["r"], at: Date.now() } };
        const data = json(await api.get("/api/profile/sync-keys")).data;
        expect(data).toEqual({ allowed: false, servers: [], keys: [], max: route.MAX_KEYS });
        expect(orgaServersOf).not.toHaveBeenCalled();
    });

    it("still lists and revokes one's own keys when orga nowhere any more", async () => {
        const { record } = tokens.createPersonToken("Laptop", "u1");
        mockUser = ANNA;
        const data = json(await api.get("/api/profile/sync-keys")).data;
        expect(data.allowed).toBe(false);
        expect(data.servers).toEqual([]);
        expect(data.keys.map((k) => k.name)).toEqual(["Laptop"]);
        const res = await api.post("/api/profile/sync-keys/delete", { id: record.id });
        expect(status(res)).toBe(200);
        expect(json(res).data.keys).toEqual([]);
        expect(tokens.getToken(record.id)).toBeNull();
    });

    it("reads the servers from the session's rights, no member lookup per page view", async () => {
        const access = { isAdmin: false, guilds: { g1: { access: raiderAccess(), isOrga: true } } };
        sessionGuildAccess.mockReturnValueOnce(access);
        mockUser = ANNA;
        await api.get("/api/profile/sync-keys");
        expect(orgaServersOf).toHaveBeenCalledWith("u1", { guildAccess: access });
    });

    it("falls back to the base access when the session has none yet", async () => {
        mockUser = ANNA;
        await api.get("/api/profile/sync-keys");
        expect(orgaServersOf).toHaveBeenCalledWith("u1", { guildAccess: { isAdmin: false, guilds: {} } });
    });
});

describe("POST /api/profile/sync-keys", () => {
    it("mints a personal key for the orga and shows the plaintext once", async () => {
        orgaOf({ u1: [{ guildId: "g1", role: "orga" }] });
        mockUser = ANNA;
        const res = await api.post("/api/profile/sync-keys", { name: "  Laptop  " });
        expect(status(res)).toBe(201);
        const data = json(res).data;
        expect(data.token).toMatch(/^ehl_/);
        expect(data.record.name).toBe("Laptop");
        expect(data.keys).toHaveLength(1);
        const stored = tokens.getToken(data.record.id);
        expect(stored).toMatchObject({ ownerId: "u1", guildId: "", createdBy: "Anna" });
        // the next read never carries it again
        expect(JSON.stringify(json(await api.get("/api/profile/sync-keys")).data)).not.toContain(data.token);
    });

    it("refuses a raider without orga (orga_only) and a key without a name", async () => {
        mockUser = ANNA;
        let res = await api.post("/api/profile/sync-keys", { name: "Laptop" });
        expect(status(res)).toBe(403);
        expect(json(res).error.code).toBe("orga_only");
        orgaOf({ u1: [{ guildId: "g1", role: "orga" }] });
        res = await api.post("/api/profile/sync-keys", { name: "   " });
        expect(status(res)).toBe(400);
        expect(tokens.listTokens()).toEqual([]);
    });

    it("stops at the cap", async () => {
        orgaOf({ u1: [{ guildId: "g1", role: "orga" }] });
        for (let i = 0; i < route.MAX_KEYS; i++) tokens.createPersonToken(`PC ${i}`, "u1");
        mockUser = ANNA;
        const res = await api.post("/api/profile/sync-keys", { name: "Noch einer" });
        expect(status(res)).toBe(400);
        expect(json(res).error.code).toBe("too_many");
    });
});

describe("POST /api/profile/sync-keys/delete", () => {
    it("revokes one's own key", async () => {
        orgaOf({ u1: [{ guildId: "g1", role: "orga" }] });
        const { record } = tokens.createPersonToken("Laptop", "u1");
        mockUser = ANNA;
        const res = await api.post("/api/profile/sync-keys/delete", { id: record.id });
        expect(status(res)).toBe(200);
        expect(tokens.getToken(record.id)).toBeNull();
    });

    it("never revokes someone else's key or a server key, but a full admin may revoke a person's key", async () => {
        const { record } = tokens.createPersonToken("PC Bert", "u2");
        const server = tokens.createToken("Server-PC", "Admin", "g1").record;
        mockUser = ANNA;
        let res = await api.post("/api/profile/sync-keys/delete", { id: record.id });
        expect(status(res)).toBe(404);
        expect(tokens.getToken(record.id)).not.toBeNull();
        mockUser = ADMIN;
        res = await api.post("/api/profile/sync-keys/delete", { id: server.id });
        expect(status(res)).toBe(404);
        expect(tokens.getToken(server.id)).not.toBeNull();
        res = await api.post("/api/profile/sync-keys/delete", { id: record.id });
        expect(status(res)).toBe(200);
        expect(tokens.getToken(record.id)).toBeNull();
        mockUser = BERT;
        expect(status(await api.post("/api/profile/sync-keys/delete", { id: "nope" }))).toBe(404);
    });
});
