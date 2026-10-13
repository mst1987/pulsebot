// POST /api/ingest/levelhelper through the real router: the token gate, the
// refusals, the merge behind it and the record post after the answer.
const { mockRes, status, json, jsonRequest } = require("../../helpers/http");

// The uploader is a machine: no session anywhere.
jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => null),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../src/stores/ingestTokenStore", () => ({
    verifyToken: jest.fn(),
    touchToken: jest.fn(),
    bearerFrom: jest.requireActual("../../../src/stores/ingestTokenStore").bearerFrom,
}));
jest.mock("../../../src/services/dungeons/dungeonRecords", () => ({ postNewRecords: jest.fn(async () => 0) }));

const { verifyToken, touchToken } = require("../../../src/stores/ingestTokenStore");
const { postNewRecords } = require("../../../src/services/dungeons/dungeonRecords");
const store = require("../../../src/stores/dungeonRunStore");
const { handle } = require("../../../src/web/http/apiRouter");
const { tempStoreFile } = require("../../helpers/tempStore");

const TOKEN = { id: "t1", name: "Devi-PC" };
const run = (over = {}) => ({
    id: "lh-1", dungeon: "The Deadmines", seconds: 1902, start: 1791700000, instance: 123, medal: "gold",
    members: [{ guid: "0A1", name: "Devira", class: "PALADIN" }, { guid: "0A2", name: "Thalor", class: "WARRIOR" }], at: 1791702000, ...over,
});
const payload = (over = {}) => ({
    format: "levelhelper-runs", v: 1, versionId: "forever", guild: "Pulse", uploader: { account: "405280973#1" },
    runs: [run()],
    characters: [{ guid: "0A1", name: "Devira", realm: null, class: "PALADIN", level: 18, points: 340, count: 34, golds: 2, at: 1791702000 }],
    ...over,
});

async function upload(body, authorization = "Bearer ehl_good") {
    const req = jsonRequest("POST", "/api/ingest/levelhelper", body, authorization ? { authorization } : {});
    const res = mockRes();
    await handle("/api/ingest/levelhelper", req, res);
    return res;
}

beforeAll(() => store.useFile(tempStoreFile("dungeon-runs.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    jest.clearAllMocks();
    verifyToken.mockReturnValue(TOKEN);
    store.update(() => ({ runs: [], characters: [] }));
});

describe("POST /api/ingest/levelhelper", () => {
    it("refuses a request without or with an unknown token, without a session", async () => {
        let res = await upload(payload(), "");
        expect(status(res)).toBe(401);
        expect(json(res).error.code).toBe("no_token");
        verifyToken.mockReturnValue(null);
        res = await upload(payload());
        expect(status(res)).toBe(401);
        expect(json(res).error.code).toBe("bad_token");
        expect(store.listRuns()).toEqual([]);
    });

    it("stores the runs and characters and answers the contract's counts", async () => {
        const res = await upload(payload());
        expect(status(res)).toBe(200);
        expect(json(res).data).toEqual({ ok: true, versionId: "forever", runs: { added: 1, merged: 0, skipped: 0 }, characters: { updated: 1 } });
        expect(touchToken).toHaveBeenCalledWith("t1");
        expect(store.listRuns("forever")[0]).toMatchObject({ uploadedBy: "Devi-PC", account: "405280973#1", guild: "Pulse" });
        expect(postNewRecords).toHaveBeenCalledWith({ versionId: "forever", touched: [store.listRuns()[0].id] });
    });

    it("merges the same run from another PC and skips a repeat", async () => {
        await upload(payload());
        let res = await upload(payload({ runs: [run({ id: "other-pc", start: 1791700060, seconds: 1899 })], characters: [] }));
        expect(json(res).data.runs).toEqual({ added: 0, merged: 1, skipped: 0 });
        res = await upload(payload({ characters: [] }));
        expect(json(res).data.runs).toEqual({ added: 0, merged: 0, skipped: 1 });
        expect(store.listRuns()).toHaveLength(1);
        expect(store.listRuns()[0].seconds).toBe(1899);
    });

    it("refuses garbage with 400, naming the field, and stores nothing", async () => {
        for (const bad of [
            payload({ format: "x" }),
            payload({ versionId: "nope" }),
            payload({ runs: [run({ seconds: 30 })] }),
            payload({ runs: [run({ medal: "wood" })] }),
            payload({ runs: [run({ members: [] })] }),
            payload({ runs: "all" }),
        ]) {
            const res = await upload(bad);
            expect(status(res)).toBe(400);
            expect(json(res).error.code).toBe("parse_failed");
        }
        expect(json(await upload(payload({ runs: [run({ seconds: 30 })] }))).error.message).toMatch(/^runs\[0\]\.seconds/);
        expect(store.listRuns()).toEqual([]);
        expect(touchToken).not.toHaveBeenCalled();
        expect(postNewRecords).not.toHaveBeenCalled();
    });

    it("refuses an empty body", async () => {
        expect(status(await upload(undefined))).toBe(400);
    });
});
