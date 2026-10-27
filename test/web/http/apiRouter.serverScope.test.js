// Rights hold per server (#925, docs/permissions.md): the orga of server B opens nothing of a raid
// of server A, through the real router (apiRouter.handle) and the real route modules - the setup
// editor, the raid plan, the raid detail and the "Event verwalten" dialogs. A full admin acts on
// every server. The server of a raid comes from services/events/eventServer.js (its own tests);
// here a fixed map stands in for it, so the routes stop at the server check or pass it.
const { json: sent, status, routerClient } = require("../../helpers/http");

let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    checkCsrf: jest.fn(() => true),
    getActiveGuild: jest.fn(() => "B"),
}));
let mockActive = "B";
jest.mock("../../../src/web/http/activeGuild", () => ({
    activeGuildFor: jest.fn(() => mockActive),
    pickActiveGuild: jest.fn(async () => mockActive),
}));
const mockServers = { evA: "A", evB: "B" };
jest.mock("../../../src/services/events/eventServer", () => {
    const serverOfEntry = jest.fn((e) => mockServers[e && typeof e === "object" ? e.id : e] || "");
    return {
        serverOfEntry,
        allOnServer: jest.fn((entries, guildId) => {
            const known = [].concat(entries).map(serverOfEntry).filter(Boolean);
            if (!known.length) return true;
            const active = typeof guildId === "function" ? guildId() : guildId;
            return !!active && known.every((g) => g === active);
        }),
    };
});

const { allOnServer } = require("../../../src/services/events/eventServer");
const { emptyAccess } = require("../../../src/config/permissions");

const { get, request, post } = routerClient();
const allAreas = () => Object.fromEntries(Object.keys(emptyAccess()).map((k) => [k, { read: true, write: true }]));
// the orga of server B: an orga role and every area at write level there
const orgaOfB = { id: "7", name: "Bob", isAdmin: false, isOrga: true, access: allAreas() };
const fullAdmin = { id: "1", name: "Admin", isAdmin: true, isOrga: true, access: allAreas() };

/** The requests naming a raid, one per area: [label, send(eventId)]. */
const CASES = [
    ["setup editor: read", (ev) => get("/api/raids/setup", { event: ev })],
    ["setup editor: save", (ev) => request("PUT", "/api/raids/setup", { event: ev, setup: {} })],
    ["raid plan: read", (ev) => get("/api/raidplan", { event: ev })],
    ["raid plan: save", (ev) => request("PUT", "/api/raidplan", { event: ev, plan: {} })],
    ["raid plan: progress of the editor", (ev) => get("/api/raidplan/progress", { event: ev })],
    ["raid detail: read", (ev) => get("/api/raids/detail", { event: ev })],
    ["Event verwalten: read", (ev) => get("/api/raids/manage", { event: ev })],
    ["Event verwalten: cancel", (ev) => post("/api/raids/manage/cancel", { event: ev, reason: "x" })],
];

const refusedByServer = (res) => status(res) === 404 && sent(res).error.code === "not_found";

beforeEach(() => {
    mockUser = orgaOfB;
    mockActive = "B";
    allOnServer.mockClear();
});

describe("the orga of server B and a raid of server A (#925)", () => {
    it.each(CASES)("%s answers 404", async (label, send) => {
        const res = await send("evA");
        expect(refusedByServer(res)).toBe(true);
        expect(allOnServer).toHaveBeenCalled();
        expect(allOnServer.mock.results.some((r) => r.value === false)).toBe(true);
    });

    it.each(CASES)("%s passes the server check for a raid of server B", async (label, send) => {
        await send("evB");
        expect(allOnServer).toHaveBeenCalled();
        expect(allOnServer.mock.results.every((r) => r.value === true)).toBe(true);
    });

    it("answers 404 for the raid of server B once the session switched to server A", async () => {
        mockActive = "A";
        expect(refusedByServer(await get("/api/raids/setup", { event: "evB" }))).toBe(true);
        expect(refusedByServer(await get("/api/raidplan", { event: "evB" }))).toBe(true);
    });
});

describe("a full admin (#925)", () => {
    it.each(CASES)("%s skips the server check on any server", async (label, send) => {
        mockUser = fullAdmin;
        await send("evA");
        expect(allOnServer).not.toHaveBeenCalled();
    });
});
