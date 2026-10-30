// Einstellungen → Spielversion → "Neue Version starten" (#745): the route reads
// the checklist of a target version and marks the manual items.
jest.mock("../../../../src/web/http/apiMiddleware", () => require("../../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../../src/web/http/apiBody", () => require("../../../helpers/http").apiBodyMock());
jest.mock("../../../../src/services/events/versionLaunch", () => ({
    loadChecklist: jest.fn((versionId) => ({ versionId: versionId || "forever", items: [] })),
    setManualMark: jest.fn(() => ({ config: { versionLaunch: {} } })),
}));

let mockUser;

const { readJsonBody } = require("../../../../src/web/http/apiBody");
const versionLaunch = require("../../../../src/services/events/versionLaunch");
const { getVersionLaunch, postVersionLaunch } = require("../../../../src/web/apiRoutes/admin/versionLaunch");
const { AREA_BY_PATH } = require("../../../../src/web/http/apiAccess");
const { mockRes, status, body } = require("../../../helpers/http");

const url = (query = "") => new URL(`http://localhost/api/settings/version-launch${query}`);
const ADMIN = { id: "1", name: "Orga", isAdmin: true };
const WRITER = { id: "2", name: "Lead", isAdmin: false, permissions: { settings: { read: true, write: true } } };

describe("apiRoutes/versionLaunch (#745)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUser = ADMIN;
    });

    it("is gated as a settings path", () => {
        expect(AREA_BY_PATH["/api/settings/version-launch"]).toBe("settings");
    });

    it("GET answers the checklist of the asked version, with the backup for a full admin", async () => {
        const res = mockRes();
        await getVersionLaunch({}, res, url("?version=forever"));
        expect(versionLaunch.loadChecklist).toHaveBeenCalledWith("forever", { withBackup: true });
        expect(body(res)).toEqual({ checklist: { versionId: "forever", items: [] } });
    });

    it("GET leaves the backup out for someone who is no full admin", async () => {
        mockUser = WRITER;
        await getVersionLaunch({}, mockRes(), url());
        expect(versionLaunch.loadChecklist).toHaveBeenCalledWith("", { withBackup: false });
    });

    it("POST marks a manual item with the caller's name and answers the fresh list", async () => {
        readJsonBody.mockResolvedValueOnce({ version: "forever", item: "talk", done: true });
        const res = mockRes();
        await postVersionLaunch({}, res, url());
        expect(versionLaunch.setManualMark).toHaveBeenCalledWith("forever", "talk", true, { byName: "Orga" });
        expect(versionLaunch.loadChecklist).toHaveBeenCalledWith("forever", { config: { versionLaunch: {} }, withBackup: true });
        expect(status(res)).toBe(200);
    });

    it("POST answers 400 for a computed item", async () => {
        versionLaunch.setManualMark.mockReturnValueOnce({ code: "invalid", error: "Dieser Punkt wird aus den Daten berechnet." });
        readJsonBody.mockResolvedValueOnce({ version: "forever", item: "rosters", done: true });
        const res = mockRes();
        await postVersionLaunch({}, res, url());
        expect(status(res)).toBe(400);
        expect(versionLaunch.loadChecklist).not.toHaveBeenCalled();
    });

    it("POST needs write rights on the settings", async () => {
        mockUser = { id: "3", name: "Leser", isAdmin: false, permissions: { settings: { read: true, write: false } } };
        readJsonBody.mockResolvedValueOnce({ version: "forever", item: "talk", done: true });
        const res = mockRes();
        await postVersionLaunch({}, res, url());
        expect(status(res)).toBe(403);
        expect(versionLaunch.setManualMark).not.toHaveBeenCalled();
    });
});
