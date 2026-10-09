// The roster routes (src/web/apiRoutes/rosters.js, #654) through the real
// router: the area gate (roster read), the parameters and what reaches the
// view builder. The views themselves: test/web/roster/rosterView.test.js.
const { status, body, routerClient } = require("../../helpers/http");

jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => null),
    getRealUser: jest.fn(() => null),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
    getActiveGuild: jest.fn(() => "g1"),
}));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({ categoryIds: ["cat1"] })) }));
jest.mock("../../../src/web/roster/rosterView", () => ({
    buildRosterOverview: jest.fn(async () => ({ rosters: [{ id: "r1", name: "Raid Mo / Do" }], categoriesWithoutRoster: [], canCreate: true })),
    buildRosterDetail: jest.fn(async ({ id }) => (id === "r1" ? { roster: { id: "r1" }, members: [], canManage: false } : null)),
}));

jest.mock("../../../src/web/roster/activeRoster", () => ({ activeRoster: jest.fn((req, id) => (id === "r1" ? { id: "r1", guildId: "g1", history: [] } : null)) }));
jest.mock("../../../src/web/roster/rosterHistoryView", () => ({
    buildRosterHistory: jest.fn(async () => ({ entries: [{ what: "created" }], total: 1, offset: 0, limit: 50 })),
}));

const auth = require("../../../src/web/http/auth");
const { buildRosterHistory } = require("../../../src/web/roster/rosterHistoryView");
const view = require("../../../src/web/roster/rosterView");
const { emptyAccess } = require("../../../src/config/permissions");
const { get } = routerClient(require("../../../src/web/apiRoutes/rosters"));

const ADMIN = { id: "1", name: "Admin", isAdmin: true, access: emptyAccess() };
const READER = { id: "2", name: "Orga", isAdmin: false, access: { ...emptyAccess(), roster: { read: true, write: false } } };
const MEMBER = { id: "3", name: "Raider", isAdmin: false, access: { ...emptyAccess(), signup: { read: true, write: true } } };

beforeEach(() => {
    jest.clearAllMocks();
    auth.getUser.mockReturnValue(ADMIN);
});

describe("GET /api/rosters", () => {
    it("answers the overview of the active server", async () => {
        const res = await get("/api/rosters");
        expect(status(res)).toBe(200);
        expect(body(res)).toEqual({ rosters: [{ id: "r1", name: "Raid Mo / Do" }], categoriesWithoutRoster: [], canCreate: true });
        expect(view.buildRosterOverview).toHaveBeenCalledWith({ guildId: "g1", user: ADMIN, config: { categoryIds: ["cat1"] } });
    });

    it("opens for roster readers and stays shut for everybody else", async () => {
        auth.getUser.mockReturnValue(READER);
        expect(status(await get("/api/rosters"))).toBe(200);
        auth.getUser.mockReturnValue(MEMBER);
        expect(status(await get("/api/rosters"))).toBe(403);
        auth.getUser.mockReturnValue(null);
        expect(status(await get("/api/rosters"))).toBe(401);
        expect(view.buildRosterOverview).toHaveBeenCalledTimes(1);
    });
});

describe("GET /api/rosters/roster", () => {
    it("answers one roster", async () => {
        auth.getUser.mockReturnValue(READER);
        const res = await get("/api/rosters/roster", { id: "r1" });
        expect(status(res)).toBe(200);
        expect(body(res)).toEqual({ roster: { id: "r1" }, members: [], canManage: false });
        expect(view.buildRosterDetail).toHaveBeenCalledWith({ guildId: "g1", id: "r1", user: READER, config: { categoryIds: ["cat1"] } });
    });

    it("asks for an id and says when the roster does not exist", async () => {
        const missing = await get("/api/rosters/roster");
        expect(status(missing)).toBe(400);
        expect(view.buildRosterDetail).not.toHaveBeenCalled();
        const unknown = await get("/api/rosters/roster", { id: "nope" });
        expect(status(unknown)).toBe(404);
    });

    it("is closed to accounts without the roster area", async () => {
        auth.getUser.mockReturnValue(MEMBER);
        expect(status(await get("/api/rosters/roster", { id: "r1" }))).toBe(403);
        expect(view.buildRosterDetail).not.toHaveBeenCalled();
    });
});

describe("GET /api/rosters/history", () => {
    it("answers a page of the history of a roster of the active server, for roster readers", async () => {
        auth.getUser.mockReturnValue(READER);
        const res = await get("/api/rosters/history", { id: "r1", userId: "100001", offset: "50", limit: "20" });
        expect(status(res)).toBe(200);
        expect(body(res)).toEqual({ entries: [{ what: "created" }], total: 1, offset: 0, limit: 50 });
        expect(buildRosterHistory).toHaveBeenCalledWith({ id: "r1", guildId: "g1", history: [] }, { userId: "100001", offset: "50", limit: "20" });
    });

    it("asks for an id, answers 404 for an unknown roster (or another server's) and stays shut without the area", async () => {
        expect(status(await get("/api/rosters/history"))).toBe(400);
        expect(status(await get("/api/rosters/history", { id: "nope" }))).toBe(404);
        auth.getUser.mockReturnValue(MEMBER);
        expect(status(await get("/api/rosters/history", { id: "r1" }))).toBe(403);
        expect(buildRosterHistory).not.toHaveBeenCalled();
    });
});