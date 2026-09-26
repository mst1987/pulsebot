// GET /api/game-versions (src/web/apiRoutes/gameVersions.js): the rule sets as
// JSON, behind the menu login.
jest.mock("../../../src/web/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock());

const { requireAdmin } = require("../../../src/web/apiMiddleware");
const { getGameVersions } = require("../../../src/web/apiRoutes/gameVersions");

const { mockRes, body: payload } = require("../../helpers/http");

describe("GET /api/game-versions", () => {
    it("serves every version with classes, instances and buffs", () => {
        requireAdmin.mockReturnValue({ id: "1", isAdmin: true });
        const res = mockRes();
        getGameVersions({}, res);
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        const body = payload(res);
        expect(body.defaultVersion).toBe("tbc");
        expect(body.versions.map((v) => v.id)).toEqual(["tbc", "classic", "forever"]);
        const classic = body.versions[1];
        expect(classic.instances.find((i) => i.id === "mc")).toMatchObject({ defaultSize: 40, finalBoss: "Ragnaros", status: "complete" });
        expect(classic.classes.length).toBe(9);
        expect(classic.raidBuffs.length).toBeGreaterThan(0);
    });

    it("answers nothing more when the caller is not logged in", () => {
        requireAdmin.mockReturnValue(null);
        const res = mockRes();
        getGameVersions({}, res);
        expect(res.end).not.toHaveBeenCalled();
    });
});
