// apiRoutes/rosterAdmin (#657): create, update, delete, options, composition -
// through the real router, with the real stores on scratch files and the
// Discord side mocked.
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
    applyMemberAdded: jest.fn(async () => ({ ok: true, results: [] })),
    applyMemberRemoved: jest.fn(async () => ({ ok: true, results: [] })),
    applyStatusChange: jest.fn(async () => ({ ok: true, results: [] })),
    applyRoleChange: jest.fn(),
    takeFailedPending: jest.fn(() => false),
}));
jest.mock("../../../src/services/discord/categoryNames", () => ({
    listKnownCategories: jest.fn(() => [{ id: "700000000000000001", name: "Donnerstag Raid" }]),
    rememberCategories: jest.fn(),
}));
jest.mock("../../../src/services/characters/rosterAttendance", () => ({ buildAttendanceContext: jest.fn() }));
jest.mock("../../../src/services/discord/discord", () => ({
    memberRoleIds: jest.fn(async () => []),
    isOnline: jest.fn(() => true),
    getGuild: jest.fn(),
    listGuilds: jest.fn(() => []),
    listMembersWithRoles: jest.fn(async () => ({ members: [], error: null })),
}));
jest.mock("../../../src/services/discord/roleSync", () => ({ canManageRoles: jest.fn(() => true) }));

const auth = require("../../../src/web/http/auth");
const { activeGuildFor } = require("../../../src/web/http/activeGuild");
const rosterStore = require("../../../src/stores/rosterStore");
const raiderProfileStore = require("../../../src/stores/raiderProfileStore");
const kaderStore = require("../../../src/stores/kaderStore");
const configStore = require("../../../src/stores/configStore");
const discord = require("../../../src/services/discord/discord");
const { buildAttendanceContext } = require("../../../src/services/characters/rosterAttendance");
const routeModule = require("../../../src/web/apiRoutes/rosterAdmin");
const { get, post } = routerClient(routeModule);

const CAT = "700000000000000001";
const ROLE = "900000000000000001";
const ROLE2 = "900000000000000002";
const U = { a: "111111111111111111", b: "222222222222222222", c: "333333333333333333" };
const ADMIN = { id: "1", isAdmin: true };
const MANAGER = { id: "200001", isAdmin: false, access: { roster: { read: true, write: true } } };
const WRITER = { id: "200003", isAdmin: false, access: { roster: { read: true, write: true } } };
const READER = { id: "200002", isAdmin: false, access: { roster: { read: true, write: false } } };
const SECRET = "GEHEIM";

const role = (id, name, rawPosition) => ({ id, name, rawPosition, position: rawPosition, color: 0, hexColor: "#000000", managed: false });
const GUILD = {
    id: "g1",
    members: { me: { roles: { highest: { position: 50 } } } },
    roles: { cache: new Map([["g1", role("g1", "@everyone", 0)], [ROLE, role(ROLE, "Raider", 5)], [ROLE2, role(ROLE2, "Probe", 4)]]) },
};

const status = (res) => res.writeHead.mock.calls[0][0];
const data = (res) => json(res).data;
const code = (res) => (json(res).error || {}).code;

beforeAll(() => {
    rosterStore.useFile(tempStoreFile("rosters.json"));
    raiderProfileStore.useFile(tempStoreFile("profiles.json"));
    kaderStore.useFile(tempStoreFile("kader.json"));
    configStore.useFile(tempStoreFile("config.json"));
});
afterAll(() => {
    rosterStore.useFile(null);
    raiderProfileStore.useFile(null);
    kaderStore.useFile(null);
    configStore.useFile(null);
});
beforeEach(() => {
    jest.clearAllMocks();
    auth.checkCsrf.mockReturnValue(true);
    activeGuildFor.mockReturnValue("g1");
    discord.isOnline.mockReturnValue(true);
    discord.getGuild.mockImplementation((id) => (id === "g1" ? GUILD : null));
    for (const r of rosterStore.listRosters("")) rosterStore.deleteRoster(r.id);
    raiderProfileStore.reset();
    raiderProfileStore.addCharacter(U.a, { name: "Devi", className: "Priest", specs: ["Priest-Holy"] });
    kaderStore.writePlanner("g1", {
        v: 2, accounts: [], assignments: {},
        kaders: [{
            id: "k1", name: "Forever-Kader", leads: [U.c],
            questions: [{ id: "q1", text: "?", type: "text", options: [] }],
            players: {
                [U.a]: { state: "roster", wishes: [{ className: "Mage", spec: "Mage-Frost" }], interview: { answers: { q1: SECRET }, note: SECRET }, comments: [{ id: "c", by: U.c, at: "x", text: SECRET }] },
                [U.b]: { state: "pool", interview: { note: SECRET } },
            },
        }],
    });
    mockUser = ADMIN;
});

describe("apiRoutes/rosterAdmin routes", () => {
    it("are gated on the roster area", () => {
        expect(routeModule.routes.map((r) => `${r.method} ${r.path} ${r.area}`)).toEqual([
            "GET /api/rosters/options roster",
            "POST /api/rosters/create roster",
            "POST /api/rosters/update roster",
            "POST /api/rosters/delete roster",
            "GET /api/rosters/composition roster",
        ]);
    });
});

describe("POST /api/rosters/create", () => {
    it("creates a roster for the active server as a full admin", async () => {
        const res = await post("/api/rosters/create", {
            categoryId: CAT, roleIds: [ROLE], trialRoleId: ROLE2, managers: { userIds: [MANAGER.id] },
            slots: { total: 25, tank: 3, healer: 6, bench: 3 }, allowMultipleChars: false, signupOnly: true,
        });
        expect(status(res)).toBe(200);
        expect(data(res).roster).toEqual(expect.objectContaining({
            name: "Donnerstag Raid", guildId: "g1", categoryId: CAT, versionId: "tbc", roleIds: [ROLE], trialRoleId: ROLE2,
            managers: { roleIds: [], userIds: [MANAGER.id] }, slots: { total: 25, tank: 3, healer: 6, bench: 3 }, signupOnly: true, createdBy: "1",
        }));
        expect(data(res).initial).toEqual({ source: "none", added: 0, skipped: 0, roleFailures: [], error: null });
    });

    it("answers 409 category_taken for a second roster of a category", async () => {
        await post("/api/rosters/create", { categoryId: CAT });
        const res = await post("/api/rosters/create", { categoryId: CAT, name: "Noch eins" });
        expect([status(res), code(res)]).toEqual([409, "category_taken"]);
    });

    it("validates: name, roles the server does not have, slots, source", async () => {
        const cases = [
            [{}, 400, "invalid_name"],
            [{ name: "x".repeat(41) }, 400, "name_too_long"],
            [{ name: "X", roleIds: ["900000000000000099"] }, 400, "unknown_role"],
            [{ name: "X", slots: { total: 5, tank: 4, healer: 4 } }, 400, "invalid_slots"],
            [{ name: "X", source: "kader", kaderId: "nope" }, 404, "kader_not_found"],
            [{ name: "X", source: "other" }, 400, "invalid_source"],
        ];
        for (const [payload, st, c] of cases) {
            const res = await post("/api/rosters/create", payload);
            expect({ payload, st: status(res), c: code(res) }).toEqual({ payload, st, c });
        }
    });

    it("is for full admins only: 403 admin_only for a roster writer, 403 forbidden for a reader", async () => {
        mockUser = WRITER;
        expect([status(await post("/api/rosters/create", { name: "X" })), code(await post("/api/rosters/create", { name: "X" }))]).toEqual([403, "admin_only"]);
        mockUser = READER;
        expect(code(await post("/api/rosters/create", { name: "X" }))).toBe("forbidden");
        mockUser = null;
        expect(status(await post("/api/rosters/create", { name: "X" }))).toBe(401);
        expect(rosterStore.listRosters("")).toEqual([]);
    });

    it("fills from the role holders without giving roles", async () => {
        discord.listMembersWithRoles.mockResolvedValueOnce({ members: [{ id: U.a, displayName: "A" }], error: null });
        const res = await post("/api/rosters/create", { name: "Rolle", roleIds: [ROLE], source: "role" });
        expect(data(res).initial).toEqual(expect.objectContaining({ source: "role", added: 1 }));
        expect(data(res).roster.members[U.a]).toEqual(expect.objectContaining({ status: "core", chars: ["devi"] }));
    });

    it("fills from a Kader and copies nothing private", async () => {
        const res = await post("/api/rosters/create", { source: "kader", kaderId: "k1" });
        expect(status(res)).toBe(200);
        expect(data(res).roster).toEqual(expect.objectContaining({ name: "Forever-Kader", source: { kind: "kader", kaderId: "k1" } }));
        expect(Object.keys(data(res).roster.members)).toEqual([U.a]);
        const text = JSON.stringify(data(res));
        expect(text).not.toContain(SECRET);
        expect(text).not.toContain("Mage-Frost");
    });

    it("fills from the last raids", async () => {
        buildAttendanceContext.mockReturnValueOnce({ allRaidsByCategory: new Map([[CAT, [{ id: "e1", startTime: 1, signUps: [{ userId: U.b, status: "signed" }], logs: [] }]]]) });
        const res = await post("/api/rosters/create", { categoryId: CAT, source: "raids" });
        expect(data(res).initial).toEqual(expect.objectContaining({ source: "raids", added: 1 }));
        expect(Object.keys(data(res).roster.members)).toEqual([U.b]);
    });

    it("creates an empty roster with source none", async () => {
        const res = await post("/api/rosters/create", { name: "Leer", source: "none" });
        expect(data(res).roster.members).toEqual({});
    });
});

describe("POST /api/rosters/update", () => {
    let roster;
    beforeEach(() => {
        roster = rosterStore.createRoster({ name: "Raid", guildId: "g1", roleIds: [ROLE], managers: { userIds: [MANAGER.id] }, slots: { total: 25 } });
    });

    it("lets a full admin change everything", async () => {
        const res = await post("/api/rosters/update", { rosterId: roster.id, name: "Neu", roleIds: [ROLE2], managers: { roleIds: [ROLE] }, categoryId: CAT });
        expect(status(res)).toBe(200);
        expect(data(res).roster).toEqual(expect.objectContaining({ name: "Neu", roleIds: [ROLE2], categoryId: CAT, managers: { roleIds: [ROLE], userIds: [MANAGER.id] } }));
        expect(data(res).trimmedChars).toBe(0);
    });

    it("lets a manager change name and slots, but not roles or managers (403 admin_only)", async () => {
        mockUser = MANAGER;
        let res = await post("/api/rosters/update", { rosterId: roster.id, name: "Manager-Name", slots: { tank: 2 }, roleIds: [ROLE] });
        expect(status(res)).toBe(200);
        expect(data(res).roster).toEqual(expect.objectContaining({ name: "Manager-Name", slots: expect.objectContaining({ tank: 2 }) }));
        res = await post("/api/rosters/update", { rosterId: roster.id, roleIds: [ROLE2] });
        expect([status(res), code(res)]).toEqual([403, "admin_only"]);
        res = await post("/api/rosters/update", { rosterId: roster.id, managers: { userIds: [WRITER.id] } });
        expect([status(res), code(res)]).toEqual([403, "admin_only"]);
    });

    it("answers 403 not_manager to a writer who is no manager, 404 for an unknown roster", async () => {
        mockUser = WRITER;
        const res = await post("/api/rosters/update", { rosterId: roster.id, name: "X" });
        expect([status(res), code(res)]).toEqual([403, "not_manager"]);
        mockUser = ADMIN;
        expect(status(await post("/api/rosters/update", { rosterId: "nope", name: "X" }))).toBe(404);
    });

    it("answers 409 category_taken when moving onto a category with a roster", async () => {
        rosterStore.createRoster({ name: "Other", categoryId: CAT });
        const res = await post("/api/rosters/update", { rosterId: roster.id, categoryId: CAT });
        expect([status(res), code(res)]).toEqual([409, "category_taken"]);
    });

    it("links the Kader of the Kaderplaner: admins only, a known Kader, one roster per Kader", async () => {
        let res = await post("/api/rosters/update", { rosterId: roster.id, kaderId: "nope" });
        expect([status(res), code(res)]).toEqual([404, "kader_not_found"]);
        mockUser = MANAGER;
        res = await post("/api/rosters/update", { rosterId: roster.id, kaderId: "k1" });
        expect([status(res), code(res)]).toEqual([403, "admin_only"]);
        mockUser = ADMIN;
        res = await post("/api/rosters/update", { rosterId: roster.id, kaderId: "k1" });
        expect(status(res)).toBe(200);
        expect(data(res).roster.kaderId).toBe("k1");
        expect(data(await get("/api/rosters/options")).kaders[0]).toMatchObject({ id: "k1", rosterId: roster.id, rosterName: "Raid" });
        const other = rosterStore.createRoster({ name: "Other", guildId: "g1" });
        res = await post("/api/rosters/update", { rosterId: other.id, kaderId: "k1" });
        expect([status(res), code(res)]).toEqual([409, "kader_taken"]);
        res = await post("/api/rosters/update", { rosterId: roster.id, kaderId: null });
        expect(data(res).roster.kaderId).toBeNull();
    });
});

describe("POST /api/rosters/delete", () => {
    it("deletes as a full admin, refuses everyone else", async () => {
        const roster = rosterStore.createRoster({ name: "Weg", guildId: "g1", managers: { userIds: [MANAGER.id] } });
        mockUser = MANAGER;
        expect([status(await post("/api/rosters/delete", { rosterId: roster.id })), rosterStore.getRoster(roster.id) !== null]).toEqual([403, true]);
        mockUser = ADMIN;
        const res = await post("/api/rosters/delete", { rosterId: roster.id });
        expect(data(res)).toEqual({ rosterId: roster.id, deleted: true });
        expect(rosterStore.getRoster(roster.id)).toBeNull();
        expect(status(await post("/api/rosters/delete", { rosterId: roster.id }))).toBe(404);
    });
});

describe("GET /api/rosters/options", () => {
    it("answers categories, roles, versions and the Kader for an admin", async () => {
        configStore.saveConfig({ categoryIds: [CAT] });
        const res = await get("/api/rosters/options");
        expect(status(res)).toBe(200);
        const d = data(res);
        expect(d.categories).toEqual([{ id: CAT, name: "Donnerstag Raid", versionId: "tbc", rosterId: null, rosterName: "" }]);
        expect(d.roles.map((r) => r.id)).toEqual([ROLE, ROLE2]);
        expect(d.kaders).toEqual([{ id: "k1", name: "Forever-Kader", inRoster: 1, candidates: 1, attendanceCategories: [], rosterId: null, rosterName: "" }]);
        expect(d.isAdmin).toBe(true);
    });

    it("leaves the Kader out for a roster reader without the Kaderplaner", async () => {
        mockUser = READER;
        const d = data(await get("/api/rosters/options"));
        expect(d.kaders).toEqual([]);
        expect(d.isAdmin).toBe(false);
    });
});

describe("GET /api/rosters/composition", () => {
    it("answers the composition and whether the caller manages the roster", async () => {
        const roster = rosterStore.createRoster({ name: "Raid", guildId: "g1", slots: { total: 10, tank: 2, healer: 3 } });
        rosterStore.upsertMember(roster.id, U.a, { status: "core", chars: ["devi"] });
        mockUser = READER;
        const res = await get("/api/rosters/composition", { id: roster.id });
        expect(status(res)).toBe(200);
        expect(data(res)).toEqual(expect.objectContaining({ rosterId: roster.id, canManage: false, open: 9 }));
        expect(data(res).roles[1]).toEqual({ role: "healer", target: 3, actual: 1 });
        expect(status(await get("/api/rosters/composition", { id: "nope" }))).toBe(404);
    });
});

describe("a roster of another server than the active one", () => {
    it("is 404 not_found for update, delete and composition, and nothing changes", async () => {
        const roster = rosterStore.createRoster({ name: "Fremd", guildId: "g1", slots: { total: 10 } });
        activeGuildFor.mockReturnValue("g2");
        let res = await post("/api/rosters/update", { rosterId: roster.id, name: "Gekapert" });
        expect([status(res), code(res)]).toEqual([404, "not_found"]);
        res = await post("/api/rosters/delete", { rosterId: roster.id });
        expect([status(res), code(res)]).toEqual([404, "not_found"]);
        res = await get("/api/rosters/composition", { id: roster.id });
        expect([status(res), code(res)]).toEqual([404, "not_found"]);
        expect(rosterStore.getRoster(roster.id)).toEqual(expect.objectContaining({ name: "Fremd" }));
    });
});