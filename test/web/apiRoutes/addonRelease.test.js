// GET /api/addon-release through the real router: the cached release from
// classes/addonRelease.js, gated by the "history" area (read).
jest.mock("../../../src/web/http/auth", () => ({ getUser: () => mockUser }));
jest.mock("../../../src/classes/addonRelease", () => ({
    ...jest.requireActual("../../../src/classes/addonRelease"),
    latestRelease: jest.fn(),
}));

let mockUser = null;

const { latestRelease, RELEASES_URL } = require("../../../src/classes/addonRelease");
const route = require("../../../src/web/apiRoutes/addonRelease");
const { routerClient, status, body } = require("../../helpers/http");
const { emptyAccess } = require("../../../src/config/permissions");

const { get } = routerClient(route);
const RELEASE = { version: "1.14.0", tag: "v1.14.0", url: "u", publishedAt: "2026-10-10T12:00:00Z", exe: { name: "a.exe", url: "e", size: 1 }, zip: { name: "a.zip", url: "z", size: 2 } };
const withAccess = (area, level) => ({ id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), [area]: { read: true, write: level === "write" } } });

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: "1", name: "Admin", isAdmin: true };
    latestRelease.mockResolvedValue(RELEASE);
});

describe("GET /api/addon-release", () => {
    it("answers the release and the fallback link", async () => {
        const res = await get("/api/addon-release");
        expect(status(res)).toBe(200);
        expect(body(res)).toEqual({ release: RELEASE, fallbackUrl: RELEASES_URL });
    });

    it("answers release null when GitHub could not be reached", async () => {
        latestRelease.mockResolvedValue(null);
        const res = await get("/api/addon-release");
        expect(status(res)).toBe(200);
        expect(body(res)).toEqual({ release: null, fallbackUrl: RELEASES_URL });
    });

    it("opens for history read and nothing else", async () => {
        mockUser = withAccess("history", "read");
        expect(status(await get("/api/addon-release"))).toBe(200);
        mockUser = withAccess("loot", "read");
        expect(status(await get("/api/addon-release"))).toBe(403);
        mockUser = withAccess("raids", "write");
        expect(status(await get("/api/addon-release"))).toBe(403);
    });

    it("refuses an anonymous caller (401)", async () => {
        mockUser = null;
        expect(status(await get("/api/addon-release"))).toBe(401);
        expect(latestRelease).not.toHaveBeenCalled();
    });
});
