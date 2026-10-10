// apiRoutes/rosterRoles (#656): one roster role given/taken by an admin or a
// manager of that roster, and the Abgleich lists.
let mockUser = { id: "200001", isAdmin: false, access: { roster: { read: true, write: true } } };
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/stores/rosterStore", () => ({ getRoster: jest.fn() }));
jest.mock("../../../src/services/roster/rosterAccess", () => ({ canManageRosterLive: jest.fn(async () => true), isRosterOrga: jest.fn(async () => true) }));
jest.mock("../../../src/services/roster/rosterRoleSync", () => ({
    applyRoleChange: jest.fn(async (roster, userId, roleId, give) => ({ roleId, roleName: "Raider", give, ok: true, code: "done", changed: true })),
}));
jest.mock("../../../src/services/roster/rosterSyncView", () => ({
    rosterSyncView: jest.fn(async (roster) => ({ rosterId: roster.id, inRosterWithoutRole: [], roleWithoutRoster: [], withoutChar: [], logCharsWithoutPerson: [], mirrored: [] })),
}));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({ roleSync: [] })) }));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));

const { readJsonBody } = require("../../../src/web/http/apiBody");
const { activeGuildFor } = require("../../../src/web/http/activeGuild");
const { requireCsrf } = require("../../../src/web/http/apiMiddleware");
const rosterStore = require("../../../src/stores/rosterStore");
const { canManageRosterLive, isRosterOrga } = require("../../../src/services/roster/rosterAccess");
const { applyRoleChange } = require("../../../src/services/roster/rosterRoleSync");
const { rosterSyncView } = require("../../../src/services/roster/rosterSyncView");
const { postRosterRole, getRosterSync, routes } = require("../../../src/web/apiRoutes/rosterRoles");
const { AREA_BY_PATH } = require("../../../src/web/http/apiAccess");
const { mockRes, status, body } = require("../../helpers/http");

const ROSTER = { id: "r1", guildId: "g1", roleIds: ["main", "alt"], trialRoleId: "trial", members: {} };

async function post(payload) {
    readJsonBody.mockImplementation(async () => payload);
    const res = mockRes();
    await postRosterRole({}, res);
    return res;
}
async function get(id) {
    const res = mockRes();
    await getRosterSync({}, res, new URL(`http://x/api/rosters/sync${id === undefined ? "" : `?id=${id}`}`));
    return res;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: "200001", isAdmin: false, access: { roster: { read: true, write: true } } };
    rosterStore.getRoster.mockImplementation((id) => (id === "r1" ? ROSTER : null));
    canManageRosterLive.mockResolvedValue(true);
    isRosterOrga.mockResolvedValue(true);
    activeGuildFor.mockReturnValue("g1");
});

describe("apiRoutes/rosterRoles - a roster of another server", () => {
    it("answers 404 for both routes while another server is active, and touches nothing", async () => {
        activeGuildFor.mockReturnValue("g2");
        const res = await post({ rosterId: "r1", userId: "100001", give: true });
        expect(status(res)).toBe(404);
        expect(body(res).error.code).toBe("not_found");
        expect(status(await get("r1"))).toBe(404);
        expect(applyRoleChange).not.toHaveBeenCalled();
        expect(rosterSyncView).not.toHaveBeenCalled();
    });
});

describe("apiRoutes/rosterRoles routes", () => {
    it("are gated on the roster area, POST at write and GET at read", () => {
        expect(AREA_BY_PATH["/api/rosters/roles"]).toBe("roster");
        expect(AREA_BY_PATH["/api/rosters/sync"]).toBe("roster");
        expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /api/rosters/roles", "GET /api/rosters/sync"]);
    });
});

describe("apiRoutes/rosterRoles POST /api/rosters/roles", () => {
    it("gives the main role by default, as the caller", async () => {
        const res = await post({ rosterId: "r1", userId: "100001", give: true });
        expect(status(res)).toBe(200);
        expect(applyRoleChange).toHaveBeenCalledWith(ROSTER, "100001", "main", true, { actor: "200001" });
        expect(body(res).result).toEqual(expect.objectContaining({ ok: true, code: "done" }));
    });

    it("takes a named role of the roster, the trial role included", async () => {
        await post({ rosterId: "r1", userId: "100001", give: false, roleId: "trial" });
        expect(applyRoleChange).toHaveBeenCalledWith(ROSTER, "100001", "trial", false, { actor: "200001" });
    });

    it("answers 403 not_manager for someone who may not manage this roster", async () => {
        canManageRosterLive.mockResolvedValueOnce(false);
        const res = await post({ rosterId: "r1", userId: "100001", give: true });
        expect(status(res)).toBe(403);
        expect(body(res).error.code).toBe("not_manager");
        expect(canManageRosterLive).toHaveBeenCalledWith(mockUser, ROSTER);
        expect(applyRoleChange).not.toHaveBeenCalled();
    });

    it("answers 403 without write right on the roster area, and needs the CSRF token", async () => {
        mockUser = { id: "200001", isAdmin: false, access: { roster: { read: true, write: false } } };
        expect(status(await post({ rosterId: "r1", userId: "100001", give: true }))).toBe(403);
        mockUser = { id: "200001", isAdmin: true };
        requireCsrf.mockReturnValueOnce(false);
        await post({ rosterId: "r1", userId: "100001", give: true });
        expect(applyRoleChange).not.toHaveBeenCalled();
    });

    it("validates roster, user, give and the role", async () => {
        const cases = [
            [{ rosterId: "nope", userId: "100001", give: true }, 404, "not_found"],
            [{ rosterId: "r1", userId: "abc", give: true }, 400, "bad_request"],
            [{ rosterId: "r1", userId: "100001" }, 400, "bad_request"],
            [{ rosterId: "r1", userId: "100001", give: "yes" }, 400, "bad_request"],
            [{ rosterId: "r1", userId: "100001", give: true, roleId: "admin" }, 400, "not_roster_role"],
        ];
        for (const [payload, code, errorCode] of cases) {
            const res = await post(payload);
            expect({ payload, status: status(res), code: body(res).error.code }).toEqual({ payload, status: code, code: errorCode });
        }
        expect(applyRoleChange).not.toHaveBeenCalled();
    });

    it("refuses a roster without roles or without server", async () => {
        rosterStore.getRoster.mockReturnValueOnce({ ...ROSTER, roleIds: [], trialRoleId: null });
        expect(body(await post({ rosterId: "r1", userId: "100001", give: true })).error.code).toBe("no_role");
        rosterStore.getRoster.mockReturnValueOnce({ ...ROSTER, guildId: "" });
        expect(body(await post({ rosterId: "r1", userId: "100001", give: true })).error.code).toBe("no_guild");
    });

    it("passes a refused role write on as its code", async () => {
        applyRoleChange.mockResolvedValueOnce({ roleId: "main", give: true, ok: false, code: "role_too_high", changed: false });
        let res = await post({ rosterId: "r1", userId: "100001", give: true });
        expect(status(res)).toBe(409);
        expect(body(res).error.code).toBe("role_too_high");
        applyRoleChange.mockResolvedValueOnce({ roleId: "main", give: true, ok: false, code: "offline", changed: false });
        res = await post({ rosterId: "r1", userId: "100001", give: true });
        expect(status(res)).toBe(503);
    });
});

describe("apiRoutes/rosterRoles GET /api/rosters/sync", () => {
    it("answers the view plus whether the caller may act", async () => {
        canManageRosterLive.mockResolvedValueOnce(false);
        const res = await get("r1");
        expect(status(res)).toBe(200);
        expect(body(res)).toEqual(expect.objectContaining({ rosterId: "r1", canManage: false, inRosterWithoutRole: [] }));
        expect(rosterSyncView).toHaveBeenCalledWith(ROSTER, { config: { roleSync: [] } });
    });

    it("answers 403 orga_only for somebody who is not the roster's orga (epic #723)", async () => {
        isRosterOrga.mockResolvedValueOnce(false);
        const res = await get("r1");
        expect(status(res)).toBe(403);
        expect(body(res).error.code).toBe("orga_only");
        expect(rosterSyncView).not.toHaveBeenCalled();
    });

    it("answers 404 for an unknown roster", async () => {
        expect(status(await get("nope"))).toBe(404);
        expect(status(await get())).toBe(404);
        expect(rosterSyncView).not.toHaveBeenCalled();
    });
});
