// GET /api/game-versions (src/web/apiRoutes/system/gameVersions.js): the rule sets as
// JSON, behind the menu login.
jest.mock("../../../../src/web/http/apiMiddleware", () => require("../../../helpers/http").apiMiddlewareMock());
let mockConfig = {};
jest.mock("../../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));

const { requireAdmin } = require("../../../../src/web/http/apiMiddleware");
const { getGameVersions } = require("../../../../src/web/apiRoutes/system/gameVersions");

const { mockRes, body: payload } = require("../../../helpers/http");

beforeEach(() => {
    mockConfig = {};
});

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

    it("names the versions a picker may offer: all, or only the main one while the others are hidden (#563), the rule sets stay complete", async () => {
        requireAdmin.mockReturnValue({ id: "1", isAdmin: true });
        const res = mockRes();
        await getGameVersions({}, res);
        expect(payload(res).visible).toEqual(["tbc", "classic", "forever"]);
        mockConfig = { mainVersion: "forever", hideOtherVersions: true };
        const hidden = mockRes();
        await getGameVersions({}, hidden);
        expect(payload(hidden).visible).toEqual(["forever"]);
        expect(payload(hidden).versions.map((v) => v.id)).toEqual(["tbc", "classic", "forever"]);
    });

    it("names the main version from the settings, the category's own when asked for one (#541)", async () => {
        requireAdmin.mockReturnValue({ id: "1", isAdmin: true });
        mockConfig = { mainVersion: "forever", categoryVersion: { c1: "tbc" } };
        const ask = async (query) => {
            const res = mockRes();
            await getGameVersions({}, res, new URL(`http://x/api/game-versions${query}`));
            return payload(res).defaultVersion;
        };
        expect(await ask("")).toBe("forever");
        expect(await ask("?categoryId=c1")).toBe("tbc");
        expect(await ask("?categoryId=c2")).toBe("forever");
    });

    it("answers nothing more when the caller is not logged in", () => {
        requireAdmin.mockReturnValue(null);
        const res = mockRes();
        getGameVersions({}, res);
        expect(res.end).not.toHaveBeenCalled();
    });
});
