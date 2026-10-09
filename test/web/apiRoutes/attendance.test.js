// apiRoutes/attendance (#677): set one raid night of one account by hand, or back
// to automatic - through the real router, the override and roster stores on
// scratch files, the event lookup and Discord mocked.
const { json, routerClient } = require("../../helpers/http");
const { tempStoreFile, removeTempStores } = require("../../helpers/tempStore");

let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    getRealUser: jest.fn(() => mockUser),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    memberRoleIds: jest.fn(async () => []),
    isOnline: jest.fn(() => false),
    getGuild: jest.fn(() => null),
    listGuilds: jest.fn(() => []),
}));
const mockGetStoredEvent = jest.fn();
jest.mock("../../../src/services/events/eventSources", () => ({
    ...jest.requireActual("../../../src/services/events/eventSources"),
    getStoredEvent: (...a) => mockGetStoredEvent(...a),
}));

const auth = require("../../../src/web/http/auth");
const discord = require("../../../src/services/discord/discord");
const rosterStore = require("../../../src/stores/rosterStore");
const overridesStore = require("../../../src/stores/attendanceOverridesStore");
const routeModule = require("../../../src/web/apiRoutes/attendance");
const { post } = routerClient(routeModule);

const CAT = "300000000000000001";
const ADMIN = { id: "1", isAdmin: true, name: "Admin" };
const MANAGER = { id: "200001", isAdmin: false, name: "Marc", access: { roster: { read: true, write: true } } };
const MANAGER_BY_ROLE = { id: "200004", isAdmin: false, name: "Rollo", access: { roster: { read: true, write: true } } };
const ROSTER_WRITER = { id: "200003", isAdmin: false, name: "Wanda", access: { roster: { read: true, write: true } } };
const RAIDS = { id: "200005", isAdmin: false, name: "Orga", access: { raids: { read: true, write: true } } };
const READER = { id: "200002", isAdmin: false, name: "Rita", access: { roster: { read: true, write: false }, raids: { read: true, write: false } } };

const status = (res) => res.writeHead.mock.calls[0][0];
const data = (res) => json(res).data;
const code = (res) => (json(res).error || {}).code;

beforeAll(() => {
    rosterStore.useFile(tempStoreFile("rosters.json"));
    overridesStore.useFile(tempStoreFile("attendance-overrides.json"));
});
afterAll(() => {
    rosterStore.useFile(null);
    overridesStore.useFile(null);
    removeTempStores();
});
beforeEach(() => {
    jest.clearAllMocks();
    auth.checkCsrf.mockReturnValue(true);
    discord.memberRoleIds.mockResolvedValue([]);
    for (const r of rosterStore.listRosters("")) rosterStore.deleteRoster(r.id);
    for (const [eventId, users] of Object.entries(overridesStore.listOverrides())) {
        for (const userId of Object.keys(users)) overridesStore.clearOverride(eventId, userId);
    }
    rosterStore.createRoster({
        name: "Donnerstag", guildId: "g1", categoryId: CAT,
        managers: { userIds: [MANAGER.id], roleIds: ["900000000000000009"] },
    });
    mockGetStoredEvent.mockImplementation((id) => (id === "e1" ? { id: "e1", categoryId: CAT, startTime: 1 } : id === "e2" ? { id: "e2", categoryId: "other", startTime: 1 } : null));
    mockUser = MANAGER;
});

describe("apiRoutes/attendance routes", () => {
    it("are gated on the roster or the raids area", () => {
        expect(routeModule.routes.map((r) => [r.method, r.path, r.area])).toEqual([["POST", "/api/attendance/override", ["roster", "raids"]]]);
    });
});

describe("POST /api/attendance/override", () => {
    it("lets the roster's manager set a night by hand, with who, when and why", async () => {
        const res = await post("/api/attendance/override", { eventId: "e1", userId: "100001", status: "bench", reason: "hat gewartet" });
        expect(status(res)).toBe(200);
        expect(data(res)).toEqual({ eventId: "e1", userId: "100001", override: expect.objectContaining({ status: "bench", reason: "hat gewartet", by: MANAGER.id, byName: "Marc" }) });
        expect(overridesStore.getOverride("e1", "100001")).toMatchObject({ status: "bench", by: MANAGER.id });
    });

    it("goes back to automatic with status null (or 'auto')", async () => {
        overridesStore.setOverride("e1", "100001", { status: "noShow" });
        const res = await post("/api/attendance/override", { eventId: "e1", userId: "100001", status: null });
        expect(status(res)).toBe(200);
        expect(data(res).override).toBeNull();
        expect(overridesStore.getOverride("e1", "100001")).toBeNull();
        overridesStore.setOverride("e1", "100001", { status: "noShow" });
        await post("/api/attendance/override", { eventId: "e1", userId: "100001", status: "auto" });
        expect(overridesStore.getOverride("e1", "100001")).toBeNull();
    });

    it("lets a full admin and the orga with raids write edit any category", async () => {
        for (const user of [ADMIN, RAIDS]) {
            mockUser = user;
            const res = await post("/api/attendance/override", { eventId: "e2", userId: "100001", status: "vacation" });
            expect(status(res)).toBe(200);
        }
        expect(overridesStore.getOverride("e2", "100001")).toMatchObject({ status: "vacation", by: RAIDS.id });
    });

    it("lets a manager by Discord role through", async () => {
        mockUser = MANAGER_BY_ROLE;
        discord.memberRoleIds.mockResolvedValue(["900000000000000009"]);
        const res = await post("/api/attendance/override", { eventId: "e1", userId: "100001", status: "present" });
        expect(status(res)).toBe(200);
    });

    it("refuses with 403 whoever manages no roster of the event's category", async () => {
        mockUser = ROSTER_WRITER;
        const res = await post("/api/attendance/override", { eventId: "e1", userId: "100001", status: "bench" });
        expect(status(res)).toBe(403);
        expect(code(res)).toBe("not_manager");
        // the manager of Donnerstag has no say over another category
        mockUser = MANAGER;
        const other = await post("/api/attendance/override", { eventId: "e2", userId: "100001", status: "bench" });
        expect(status(other)).toBe(403);
        expect(overridesStore.listOverrides()).toEqual({});
    });

    it("refuses a reader at the area gate", async () => {
        mockUser = READER;
        const res = await post("/api/attendance/override", { eventId: "e1", userId: "100001", status: "bench" });
        expect(status(res)).toBe(403);
        expect(overridesStore.listOverrides()).toEqual({});
    });

    it("answers codes for bad input and an unknown event", async () => {
        const cases = [
            [{ userId: "100001", status: "bench" }, 400, "bad_request"],
            [{ eventId: "e1", status: "bench" }, 400, "bad_request"],
            [{ eventId: "e1", userId: "100001", status: "maybe" }, 400, "invalid_status"],
            [{ eventId: "e1", userId: "100001", status: "bench", reason: "x".repeat(201) }, 400, "reason_too_long"],
            [{ eventId: "nope", userId: "100001", status: "bench" }, 404, "not_found"],
        ];
        for (const [body, st, c] of cases) {
            const res = await post("/api/attendance/override", body);
            expect([status(res), code(res)]).toEqual([st, c]);
        }
    });

    it("needs the CSRF token", async () => {
        auth.checkCsrf.mockReturnValue(false);
        const res = await post("/api/attendance/override", { eventId: "e1", userId: "100001", status: "bench" });
        expect(status(res)).toBe(403);
    });
});
