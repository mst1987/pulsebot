// apiRoutes/rosterMembers (#655): take members in, change them, take them out,
// and the member search - through the real router, with the real stores on
// scratch files and the Discord side mocked.
const { json, routerClient } = require("../../helpers/http");
const { tempStoreFile } = require("../../helpers/tempStore");

let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    getRealUser: jest.fn(() => mockUser),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../src/services/roster/rosterRoleSync", () => ({
    applyMemberAdded: jest.fn(async () => ({ ok: true, results: [{ roleId: "900000000000000001", give: true, ok: true, code: "done", changed: true }] })),
    applyMemberRemoved: jest.fn(async () => ({ ok: true, results: [] })),
    applyStatusChange: jest.fn(async () => ({ ok: true, skipped: "no_roles", results: [] })),
    applyRoleChange: jest.fn(),
    takeFailedPending: jest.fn(() => false),
}));
jest.mock("../../../src/services/roster/rosterMemberSearch", () => ({ searchMembers: jest.fn() }));
jest.mock("../../../src/services/discord/discord", () => ({
    memberRoleIds: jest.fn(async () => []),
    isOnline: jest.fn(() => false),
    getGuild: jest.fn(() => null),
    listGuilds: jest.fn(() => []),
}));

const auth = require("../../../src/web/http/auth");
const rosterStore = require("../../../src/stores/rosterStore");
const raiderProfileStore = require("../../../src/stores/raiderProfileStore");
const discord = require("../../../src/services/discord/discord");
const rosterRoleSync = require("../../../src/services/roster/rosterRoleSync");
const { searchMembers } = require("../../../src/services/roster/rosterMemberSearch");
const routeModule = require("../../../src/web/apiRoutes/rosterMembers");
const { get, post } = routerClient(routeModule);

const ADMIN = { id: "1", isAdmin: true };
const MANAGER = { id: "200001", isAdmin: false, access: { roster: { read: true, write: true } } };
const READER = { id: "200002", isAdmin: false, access: { roster: { read: true, write: false } } };
const WRITER = { id: "200003", isAdmin: false, access: { roster: { read: true, write: true } } };

const status = (res) => res.writeHead.mock.calls[0][0];
const data = (res) => json(res).data;
const code = (res) => (json(res).error || {}).code;

let roster;
beforeAll(() => {
    rosterStore.useFile(tempStoreFile("rosters.json"));
    raiderProfileStore.useFile(tempStoreFile("profiles.json"));
});
afterAll(() => {
    rosterStore.useFile(null);
    raiderProfileStore.useFile(null);
});
beforeEach(() => {
    jest.clearAllMocks();
    auth.checkCsrf.mockReturnValue(true);
    for (const r of rosterStore.listRosters("")) rosterStore.deleteRoster(r.id);
    raiderProfileStore.reset();
    roster = rosterStore.createRoster({ name: "Donnerstag", guildId: "g1", roleIds: ["900000000000000001"], managers: { userIds: [MANAGER.id], roleIds: [] } });
    raiderProfileStore.addCharacter("100001", { name: "Devi", className: "Priest", specs: ["Priest-Holy"] });
    raiderProfileStore.addCharacter("100001", { name: "Keslight", className: "Mage", specs: ["Mage-Frost"] });
    mockUser = MANAGER;
});

describe("apiRoutes/rosterMembers routes", () => {
    it("are gated on the roster area", () => {
        expect(routeModule.routes.map((r) => `${r.method} ${r.path} ${r.area}`)).toEqual([
            "POST /api/rosters/members roster",
            "POST /api/rosters/members/remove roster",
            "GET /api/rosters/member-search roster",
        ]);
    });
});

describe("POST /api/rosters/members", () => {
    it("takes someone in as the manager: profile's first character, the role given, the caller in the history", async () => {
        const res = await post("/api/rosters/members", { rosterId: roster.id, userId: "100001", status: "trial", trialUntil: "2026-11-01" });
        expect(status(res)).toBe(200);
        expect(data(res)).toEqual(expect.objectContaining({ userId: "100001", created: true }));
        expect(data(res).member).toEqual(expect.objectContaining({ status: "trial", chars: ["devi"], trialUntil: "2026-11-01T00:00:00.000Z" }));
        expect(data(res).roles.results[0]).toEqual(expect.objectContaining({ ok: true, code: "done" }));
        expect(rosterRoleSync.applyMemberAdded).toHaveBeenCalledWith(roster.id, "100001", { actor: MANAGER.id });
        expect(rosterStore.getRoster(roster.id).history.slice(-1)[0]).toEqual(expect.objectContaining({ what: "member-added", by: MANAGER.id, userId: "100001" }));
    });

    it("updates an existing member: status, character, note", async () => {
        await post("/api/rosters/members", { rosterId: roster.id, userId: "100001" });
        const res = await post("/api/rosters/members", { rosterId: roster.id, userId: "100001", status: "bench", chars: ["keslight"], note: "Kommt später" });
        expect(status(res)).toBe(200);
        expect(data(res).created).toBe(false);
        expect(data(res).member).toEqual(expect.objectContaining({ status: "bench", chars: ["keslight"], note: "Kommt später" }));
        expect(rosterRoleSync.applyStatusChange).toHaveBeenCalledWith(roster.id, "100001", "core", "bench", { actor: MANAGER.id });
    });

    it("refuses a second character without allowMultipleChars with single_char_only", async () => {
        const res = await post("/api/rosters/members", { rosterId: roster.id, userId: "100001", chars: ["devi", "keslight"] });
        expect(status(res)).toBe(400);
        expect(code(res)).toBe("single_char_only");
        expect(rosterStore.getRoster(roster.id).members["100001"]).toBeUndefined();
    });

    it("keeps the order of several characters with allowMultipleChars", async () => {
        rosterStore.updateRoster(roster.id, { allowMultipleChars: true });
        const res = await post("/api/rosters/members", { rosterId: roster.id, userId: "100001", chars: ["keslight", "devi"] });
        expect(data(res).member.chars).toEqual(["keslight", "devi"]);
    });

    it("honours mode: add on a member is already_member, update on a stranger not_member", async () => {
        await post("/api/rosters/members", { rosterId: roster.id, userId: "100001" });
        let res = await post("/api/rosters/members", { rosterId: roster.id, userId: "100001", mode: "add" });
        expect([status(res), code(res)]).toEqual([409, "already_member"]);
        res = await post("/api/rosters/members", { rosterId: roster.id, userId: "100002", mode: "update", status: "core" });
        expect([status(res), code(res)]).toEqual([404, "not_member"]);
        res = await post("/api/rosters/members", { rosterId: roster.id, userId: "100002", mode: "replace" });
        expect([status(res), code(res)]).toEqual([400, "bad_request"]);
    });

    it("validates the input", async () => {
        const cases = [
            [{ rosterId: "nope", userId: "100001" }, 404, "not_found"],
            [{ rosterId: roster.id, userId: "abc" }, 400, "bad_request"],
            [{ rosterId: roster.id, userId: "100001", status: "boss" }, 400, "invalid_status"],
            [{ rosterId: roster.id, userId: "100001", note: "x".repeat(501) }, 400, "note_too_long"],
            [{ rosterId: roster.id, userId: "100001", trialUntil: "bald" }, 400, "invalid_date"],
            [{ rosterId: roster.id, userId: "100001", chars: "devi" }, 400, "invalid_chars"],
        ];
        for (const [payload, st, c] of cases) {
            const res = await post("/api/rosters/members", payload);
            expect({ payload, st: status(res), c: code(res) }).toEqual({ payload, st, c });
        }
    });

    it("answers 403 not_manager to a roster writer who is no manager, 401 without session, 403 without write", async () => {
        mockUser = WRITER;
        let res = await post("/api/rosters/members", { rosterId: roster.id, userId: "100001" });
        expect([status(res), code(res)]).toEqual([403, "not_manager"]);
        mockUser = READER;
        res = await post("/api/rosters/members", { rosterId: roster.id, userId: "100001" });
        expect([status(res), code(res)]).toEqual([403, "forbidden"]);
        mockUser = null;
        res = await post("/api/rosters/members", { rosterId: roster.id, userId: "100001" });
        expect(status(res)).toBe(401);
        expect(rosterRoleSync.applyMemberAdded).not.toHaveBeenCalled();
    });

    it("lets a manager by Discord role in, and a full admin always", async () => {
        rosterStore.updateRoster(roster.id, { managers: { roleIds: ["800000000000000001"], userIds: [] } });
        discord.memberRoleIds.mockResolvedValueOnce(["800000000000000001"]);
        mockUser = WRITER;
        expect(status(await post("/api/rosters/members", { rosterId: roster.id, userId: "100001" }))).toBe(200);
        mockUser = ADMIN;
        expect(status(await post("/api/rosters/members", { rosterId: roster.id, userId: "100002" }))).toBe(200);
    });

    it("needs the CSRF token", async () => {
        auth.checkCsrf.mockReturnValue(false);
        const res = await post("/api/rosters/members", { rosterId: roster.id, userId: "100001" });
        expect(status(res)).toBe(403);
        expect(rosterStore.getRoster(roster.id).members["100001"]).toBeUndefined();
    });
});

describe("POST /api/rosters/members/remove", () => {
    it("takes a member out and every role of the roster with them", async () => {
        await post("/api/rosters/members", { rosterId: roster.id, userId: "100001" });
        const res = await post("/api/rosters/members/remove", { rosterId: roster.id, userId: "100001" });
        expect(status(res)).toBe(200);
        expect(data(res)).toEqual({ userId: "100001", removed: true, roles: { ok: true, results: [] } });
        expect(rosterRoleSync.applyMemberRemoved).toHaveBeenCalledWith(roster.id, "100001", { actor: MANAGER.id });
        expect(rosterStore.getRoster(roster.id).history.slice(-1)[0]).toEqual(expect.objectContaining({ what: "member-removed", by: MANAGER.id }));
    });

    it("answers not_member, not_found and not_manager", async () => {
        expect(code(await post("/api/rosters/members/remove", { rosterId: roster.id, userId: "100001" }))).toBe("not_member");
        expect(code(await post("/api/rosters/members/remove", { rosterId: "nope", userId: "100001" }))).toBe("not_found");
        mockUser = WRITER;
        expect(code(await post("/api/rosters/members/remove", { rosterId: roster.id, userId: "100001" }))).toBe("not_manager");
    });
});

describe("GET /api/rosters/member-search", () => {
    it("searches the roster's server and version, readable with roster read", async () => {
        mockUser = READER;
        searchMembers.mockResolvedValueOnce({ results: [{ userId: "100001", displayName: "Anna", inRoster: false, chars: [] }] });
        const res = await get("/api/rosters/member-search", { id: roster.id, q: "an" });
        expect(status(res)).toBe(200);
        expect(data(res).results).toHaveLength(1);
        expect(searchMembers).toHaveBeenCalledWith({ guildId: "g1", versionId: "tbc", members: {}, query: "an" });
    });

    it("searches the active server without a roster", async () => {
        searchMembers.mockResolvedValueOnce({ results: [] });
        await get("/api/rosters/member-search", { q: "x", version: "forever" });
        expect(searchMembers).toHaveBeenCalledWith({ guildId: "g1", versionId: "forever", members: {}, query: "x" });
    });

    it("answers 503 offline when the member list cannot be read, 404 for an unknown roster", async () => {
        searchMembers.mockResolvedValueOnce({ error: "offline" });
        const res = await get("/api/rosters/member-search", { id: roster.id });
        expect([status(res), code(res)]).toEqual([503, "offline"]);
        expect(status(await get("/api/rosters/member-search", { id: "nope" }))).toBe(404);
    });
});
