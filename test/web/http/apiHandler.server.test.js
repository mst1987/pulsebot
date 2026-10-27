// withUser() and the server of a raid (#925): rights hold per server - the orga of
// server B gets 404 for a raid of server A, a full admin acts on every server.
const { mockRes, status, json: sent, jsonRequest } = require("../../helpers/http");

let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    checkCsrf: jest.fn(() => true),
}));
let mockActive = "B";
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => mockActive) }));
const mockServers = { evA: "A", evB: "B", evUnknown: "" };
jest.mock("../../../src/services/events/eventServer", () => ({
    allOnServer: jest.fn((entries, guildId) => {
        const list = [].concat(entries).map((e) => (e && typeof e === "object" ? e.id : e));
        const known = list.map((id) => mockServers[id] || "").filter(Boolean);
        if (!known.length) return true;
        const active = typeof guildId === "function" ? guildId() : guildId;
        return known.every((g) => g === active);
    }),
}));
jest.mock("../../../src/services/events/eventArchive", () => ({ archivedRefusal: jest.fn(() => null) }));
jest.mock("../../../src/services/roster/categoryOrga", () => {
    const caches = new WeakMap();
    return {
        requestCache: jest.fn((req) => {
            if (!caches.has(req)) caches.set(req, { roles: new Map() });
            return caches.get(req);
        }),
        isAnyCategoryManager: jest.fn(async () => false),
        canOrgaEvent: jest.fn(async () => false),
    };
});

const { withUser } = require("../../../src/web/http/apiHandler");
const { emptyAccess } = require("../../../src/config/permissions");

const fullAdmin = { id: "1", name: "Admin", isAdmin: true };
// the orga of server B: every area at write level and an orga role there
const allAreas = () => Object.fromEntries(Object.keys(emptyAccess()).map((k) => [k, { read: true, write: true }]));
const orgaOfB = { id: "7", name: "Bob", isAdmin: false, isOrga: true, orga: true, access: allAreas() };

async function call(handler, { json, url } = {}) {
    const req = jsonRequest("POST", "/", json, { "x-csrf-token": "tok" });
    const res = mockRes();
    await handler(req, res, url || new URL("http://x/api/thing"));
    return res;
}

describe("withUser and the server of a raid (#925)", () => {
    beforeEach(() => {
        mockActive = "B";
        mockUser = orgaOfB;
    });

    const routes = {
        orgaRead: () => withUser({ orgaRead: (b, q) => q.get("event") }, ({ res }) => res.end("{}")),
        archived: () => withUser({ csrf: true, body: true, archived: (b) => b.eventId }, ({ res }) => res.end("{}")),
    };

    it("answers 404 for a raid of another server (read by query)", async () => {
        const fn = jest.fn();
        const res = await call(withUser({ orgaRead: (b, q) => q.get("event") }, fn), { url: new URL("http://x/a?event=evA") });
        expect(status(res)).toBe(404);
        expect(sent(res).error.code).toBe("not_found");
        expect(fn).not.toHaveBeenCalled();
    });

    it("answers 404 for a write naming a raid of another server in the body", async () => {
        const res = await call(routes.archived(), { json: { eventId: "evA" } });
        expect(status(res)).toBe(404);
    });

    it("answers 404 when one raid of a list belongs to another server", async () => {
        const fn = jest.fn();
        const handler = withUser({ csrf: true, body: true, archived: (b) => b.ids }, fn);
        const res = await call(handler, { json: { ids: ["evB", "evA"] } });
        expect(status(res)).toBe(404);
        expect(fn).not.toHaveBeenCalled();
    });

    it("lets a raid of the active server through", async () => {
        const res = await call(routes.archived(), { json: { eventId: "evB" } });
        expect(res.end).toHaveBeenCalledWith("{}");
    });

    it("lets a raid of no known server through to the usual checks", async () => {
        const res = await call(routes.archived(), { json: { eventId: "evUnknown" } });
        expect(res.end).toHaveBeenCalledWith("{}");
    });

    it("lets a full admin act on a raid of any server", async () => {
        mockUser = fullAdmin;
        const res = await call(routes.archived(), { json: { eventId: "evA" } });
        expect(res.end).toHaveBeenCalledWith("{}");
    });

    it("answers 404 after switching the session to another server", async () => {
        mockActive = "A";
        const res = await call(routes.archived(), { json: { eventId: "evB" } });
        expect(status(res)).toBe(404);
    });
});
