// GET /api/version, called directly: the deploy state from deployStatus.js,
// with ?force=1 passed on as the cache bypass and the usual session gate.
jest.mock("../../../src/web/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
let mockUser = null;
jest.mock("../../../src/web/deployStatus", () => ({
    deployStatus: jest.fn(async ({ force }) => ({ commit: "abc1234", behind: 2, force })),
}));

const { deployStatus } = require("../../../src/web/deployStatus");
const { getVersion, routes } = require("../../../src/web/apiRoutes/version");
const { mockRes, status, body, json } = require("../../helpers/http");

const url = (query = "") => new URL(`http://localhost/api/version${query}`);

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: "1", name: "Admin", isAdmin: true };
});

describe("GET /api/version", () => {
    it("answers the deploy state from the cache by default", async () => {
        const res = mockRes();
        await getVersion({}, res, url());
        expect(deployStatus).toHaveBeenCalledWith({ force: false });
        expect(status(res)).toBe(200);
        expect(body(res)).toEqual({ commit: "abc1234", behind: 2, force: false });
    });

    it("skips the cache with ?force=1", async () => {
        const res = mockRes();
        await getVersion({}, res, url("?force=1"));
        expect(deployStatus).toHaveBeenCalledWith({ force: true });
        expect(body(res).force).toBe(true);
    });

    it("treats any other force value and a missing url as no force", async () => {
        const res = mockRes();
        await getVersion({}, res, url("?force=true"));
        expect(deployStatus).toHaveBeenLastCalledWith({ force: false });

        const res2 = mockRes();
        await getVersion({}, res2, undefined);
        expect(deployStatus).toHaveBeenLastCalledWith({ force: false });
        expect(status(res2)).toBe(200);
    });

    it("refuses a caller without a session and never asks for the deploy state", async () => {
        mockUser = null;
        const res = mockRes();
        await getVersion({}, res, url());
        expect(status(res)).toBe(401);
        expect(json(res)).toEqual({ error: { code: "unauthorized", message: "Nicht angemeldet." } });
        expect(deployStatus).not.toHaveBeenCalled();
    });

    it("registers one GET route in the settings area", () => {
        expect(routes).toEqual([{ method: "GET", path: "/api/version", handler: getVersion, area: "settings" }]);
    });
});
