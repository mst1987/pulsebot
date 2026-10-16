// GET /api/system/backup and POST /api/system/backup/snapshot through the real router (#696): full admins only,
// CSRF on the POST, the snapshot result passed on ("laeuft schon" included).
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser, fullAdmin: () => mockFull, csrf: () => mockCsrf }));
jest.mock("../../../src/web/http/auth", () => ({ getUser: () => mockUser }));
jest.mock("../../../src/services/backup/backupStatus", () => ({ readBackupStatus: jest.fn(() => ({ light: "ok", parts: [], snapshots: [] })) }));
jest.mock("../../../src/services/backup/snapshotJob", () => ({ runSnapshot: jest.fn() }));

let mockUser = null;
let mockFull = null;
let mockCsrf = true;

const backupStatus = require("../../../src/services/backup/backupStatus");
const { runSnapshot } = require("../../../src/services/backup/snapshotJob");
const route = require("../../../src/web/apiRoutes/system");
const { routerClient, status, body } = require("../../helpers/http");
const { emptyAccess, AREA_IDS } = require("../../../src/config/permissions");

const { get, post } = routerClient(route);
const admin = { id: "1", name: "Admin", isAdmin: true };
const everyArea = { id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), ...Object.fromEntries(AREA_IDS.map((a) => [a, { read: true, write: true }])) } };

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = admin;
    mockFull = admin;
    mockCsrf = true;
});

describe("GET /api/system/backup", () => {
    it("answers a full admin with the backup status", async () => {
        const res = await get("/api/system/backup");
        expect(status(res)).toBe(200);
        expect(body(res)).toEqual({ light: "ok", parts: [], snapshots: [] });
    });

    it("refuses a role holding every area (403) and an anonymous caller (401)", async () => {
        mockUser = everyArea;
        mockFull = null;
        expect(status(await get("/api/system/backup"))).toBe(403);
        mockUser = null;
        expect(status(await get("/api/system/backup"))).toBe(401);
        expect(backupStatus.readBackupStatus).not.toHaveBeenCalled();
    });
});

describe("POST /api/system/backup/snapshot", () => {
    it("takes a manual snapshot and answers duration and size", async () => {
        runSnapshot.mockResolvedValue({ ok: true, reason: "manual", name: "20261010-120000-manual", durationMs: 850, bytes: 12345 });
        const res = await post("/api/system/backup/snapshot", {});
        expect(status(res)).toBe(200);
        expect(runSnapshot).toHaveBeenCalledWith({ reason: "manual" });
        expect(body(res)).toEqual({ ok: true, skipped: "", name: "20261010-120000-manual", durationMs: 850, bytes: 12345, error: "" });
    });

    it("says when one is already running", async () => {
        runSnapshot.mockResolvedValue({ ok: false, reason: "manual", skipped: "locked", error: "Ein anderer Schnappschuss läuft gerade" });
        const res = await post("/api/system/backup/snapshot", {});
        expect(status(res)).toBe(200);
        expect(body(res)).toMatchObject({ ok: false, skipped: "locked", error: "Ein anderer Schnappschuss läuft gerade" });
    });

    it("passes a failure on with its message", async () => {
        runSnapshot.mockResolvedValue({ ok: false, reason: "manual", error: "Platte voll" });
        expect(body(await post("/api/system/backup/snapshot", {}))).toMatchObject({ ok: false, skipped: "", error: "Platte voll" });
    });

    it("refuses without a CSRF token (403) before taking anything", async () => {
        mockCsrf = false;
        expect(status(await post("/api/system/backup/snapshot", {}))).toBe(403);
        expect(runSnapshot).not.toHaveBeenCalled();
    });

    it("refuses a role holding every area (403) and an anonymous caller (401)", async () => {
        mockUser = everyArea;
        mockFull = null;
        expect(status(await post("/api/system/backup/snapshot", {}))).toBe(403);
        mockUser = null;
        expect(status(await post("/api/system/backup/snapshot", {}))).toBe(401);
        expect(runSnapshot).not.toHaveBeenCalled();
    });
});
