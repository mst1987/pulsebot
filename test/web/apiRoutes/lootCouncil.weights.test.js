// The loot council's weighting endpoints (#668): GET/POST /api/lootcouncil/weights,
// on the real councilWeightsStore pointed at a scratch file. The permission check
// (config/permissions userCan) stays real: reading takes `lootcouncil` read,
// storing and resetting `lootcouncil` write.
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock({ body: () => mockBody }));

let mockUser = null;
let mockBody = {};

const councilWeights = require("../../../src/stores/councilWeightsStore");
const { getWeights, postWeights } = require("../../../src/web/apiRoutes/lootCouncil");
const { mockRes, status, body, json } = require("../../helpers/http");
const { tempStoreFile } = require("../../helpers/tempStore");

const ADMIN = { id: "1", name: "Admin", isAdmin: true };
const READER = { id: "2", name: "Reader", isAdmin: false, access: { lootcouncil: { read: true, write: false } } };
const WRITER = { id: "3", name: "Schreiber", isAdmin: false, access: { lootcouncil: { read: true, write: true } } };
const OUTSIDER = { id: "4", name: "Outsider", isAdmin: false, access: { raids: { read: true, write: true } } };

async function call(handler, query = "") {
    const res = mockRes();
    await handler({ headers: {} }, res, new URL(`http://localhost/api/lootcouncil/weights${query}`));
    return res;
}

beforeAll(() => councilWeights.useFile(tempStoreFile("council-weights.json")));
afterAll(() => councilWeights.useFile(null));
beforeEach(() => {
    mockUser = ADMIN;
    mockBody = {};
    councilWeights.resetWeights("");
    councilWeights.resetWeights("c1");
});

describe("GET /api/lootcouncil/weights", () => {
    it("answers the defaults for a fresh install, readable for a reader", async () => {
        mockUser = READER;
        const res = await call(getWeights);
        expect(status(res)).toBe(200);
        const data = body(res);
        expect(data.scope).toBe("global");
        expect(data.global).toMatchObject({
            classes: { trinket: 2, bisWeapon: 2, weapon: 1.5, set: 1, normal: 1, frequent: 0.5 },
            need: { drought: 45, share: 30, need: 10, tenure: 15 },
            tenureDays: 90,
            items: {},
            stored: false,
        });
        expect(data.defaults).toMatchObject({ tenureDays: 90 });
        expect(data.own).toBeNull();
        expect(data.classIds).toEqual(["trinket", "bisWeapon", "weapon", "set", "normal", "frequent"]);
        expect(data.needIds).toEqual(["drought", "share", "need", "tenure"]);
    });

    it("says whether a category has its own weighting", async () => {
        councilWeights.setWeights("c1", { tenureDays: 30 });
        const own = body(await call(getWeights, "?category=c1"));
        expect(own.scope).toBe("category");
        expect(own.own).toMatchObject({ tenureDays: 30 });
        const other = body(await call(getWeights, "?category=c2"));
        expect(other.scope).toBe("global");
        expect(other.own).toBeNull();
    });

    it("refuses a caller without the area", async () => {
        mockUser = OUTSIDER;
        const res = await call(getWeights);
        expect(status(res)).toBe(403);
        expect(json(res).error.code).toBe("forbidden");
    });
});

describe("POST /api/lootcouncil/weights", () => {
    it("stores the server's weighting, cleaned, with who set it", async () => {
        mockUser = WRITER;
        mockBody = { weights: { classes: { trinket: 2.55, frequent: -1 }, items: { 32483: { weight: 3, name: "Skull" }, abc: 2 }, need: { drought: 50 }, tenureDays: 1000 } };
        const res = await call(postWeights);
        expect(status(res)).toBe(200);
        const data = body(res);
        expect(data.global).toMatchObject({
            classes: { trinket: 2.6, frequent: 0, weapon: 1.5 },
            items: { 32483: { weight: 3, name: "Skull" } },
            need: { drought: 50, share: 30, need: 10, tenure: 15 },
            tenureDays: 365,
            by: "Schreiber",
            stored: true,
        });
        expect(councilWeights.weightsFor("").classes.trinket).toBe(2.6);
        // what the page shows next to the exception: the item and the class it replaces
        expect(data.itemInfo["32483"]).toMatchObject({ name: "The Skull of Gul'dan", autoClass: "trinket" });
        expect(data.itemInfo["32483"].iconUrl).toMatch(/zamimg/);
    });

    it("stores a category's own weighting without touching the server's", async () => {
        mockBody = { category: "c1", weights: { tenureDays: 60 } };
        const data = body(await call(postWeights));
        expect(data.scope).toBe("category");
        expect(councilWeights.weightsFor("c1")).toMatchObject({ tenureDays: 60, scope: "category" });
        expect(councilWeights.weightsFor("")).toMatchObject({ tenureDays: 90, scope: "global" });
    });

    it("resets: the server to the defaults, a category to the server's", async () => {
        councilWeights.setWeights("", { tenureDays: 120 });
        councilWeights.setWeights("c1", { tenureDays: 30 });
        mockBody = { category: "c1", reset: true };
        expect(body(await call(postWeights)).scope).toBe("global");
        expect(councilWeights.weightsFor("c1").tenureDays).toBe(120);
        mockBody = { reset: true };
        expect(body(await call(postWeights)).global).toMatchObject({ tenureDays: 90, stored: false });
    });

    it("needs a weighting", async () => {
        mockBody = { weights: [1, 2] };
        const res = await call(postWeights);
        expect(status(res)).toBe(400);
        expect(json(res).error).toEqual({ code: "bad_request", message: "Keine Gewichtung angegeben." });
    });

    it("takes write access", async () => {
        mockUser = READER;
        mockBody = { weights: { tenureDays: 30 } };
        const res = await call(postWeights);
        expect(status(res)).toBe(403);
        expect(councilWeights.weightsFor("").tenureDays).toBe(90);
    });
});
