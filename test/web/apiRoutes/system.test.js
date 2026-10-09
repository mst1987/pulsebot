// GET /api/system/status through the real router (docs/system-status.md): full admins only, the query flags passed
// on, the status from services/system/systemStatus.js sent as it is.
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser, fullAdmin: () => mockFull }));
jest.mock("../../../src/web/http/auth", () => ({ getUser: () => mockUser }));
jest.mock("../../../src/services/system/systemStatus", () => ({ build: jest.fn(async () => ({ assessment: { level: "ok" } })) }));

let mockUser = null;
let mockFull = null;

const systemStatus = require("../../../src/services/system/systemStatus");
const route = require("../../../src/web/apiRoutes/system");
const { routerClient, status, body } = require("../../helpers/http");
const { emptyAccess, AREA_IDS } = require("../../../src/config/permissions");

const { get } = routerClient(route);
const admin = { id: "1", name: "Admin", isAdmin: true };

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = admin;
    mockFull = admin;
});

describe("GET /api/system/status", () => {
    it("answers a full admin with the status", async () => {
        const res = await get("/api/system/status");
        expect(status(res)).toBe(200);
        expect(body(res)).toEqual({ assessment: { level: "ok" } });
        expect(systemStatus.build).toHaveBeenCalledWith({ processes: false, forceDisk: false });
    });

    it("passes ?processes=1 and ?disk=1 on", async () => {
        await get("/api/system/status", { processes: "1", disk: "1" });
        expect(systemStatus.build).toHaveBeenCalledWith({ processes: true, forceDisk: true });
    });

    it("refuses a role holding every area (403) and never builds the status", async () => {
        mockUser = { id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), ...Object.fromEntries(AREA_IDS.map((a) => [a, { read: true, write: true }])) } };
        mockFull = null;
        const res = await get("/api/system/status");
        expect(status(res)).toBe(403);
        expect(systemStatus.build).not.toHaveBeenCalled();
    });

    it("refuses an anonymous caller (401)", async () => {
        mockUser = null;
        mockFull = null;
        const res = await get("/api/system/status");
        expect(status(res)).toBe(401);
        expect(systemStatus.build).not.toHaveBeenCalled();
    });

    it("registers one adminOnly GET route", () => {
        expect(route.routes).toEqual([{ method: "GET", path: "/api/system/status", handler: route.getStatus, adminOnly: true }]);
    });
});
