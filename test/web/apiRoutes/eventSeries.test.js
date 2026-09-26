// The API of the recurring events (src/web/apiRoutes/eventSeries.js, #289):
// every path is area `raids`, reading needs read, saving/deleting/running write,
// and each handler hands the request to the service as it should.
let mockUser = null;
jest.mock("../../../src/web/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/web/activeGuild", () => ({ activeGuildFor: () => "g1" }));
jest.mock("../../../src/web/settingsStore", () => ({
    listRaidTemplates: jest.fn(() => [{ id: "tpl", name: "SSC + TK 25er", instanceIds: ["ssc"], size: 25, extra: "x" }]),
}));
jest.mock("../../../src/web/eventSeriesStore", () => ({
    deleteSeries: jest.fn(() => true),
    getRuns: jest.fn(() => ({})),
    clearRun: jest.fn(),
}));
jest.mock("../../../src/web/eventSeries", () => ({
    MIN_DAYS_BEFORE: 1,
    MAX_DAYS_BEFORE: 28,
    STALE_CREATING_MS: 15 * 60 * 1000,
    seriesOverview: jest.fn(async () => ({ categories: [], lastRun: null })),
    previewSeries: jest.fn(async () => ({ error: "", summary: "Mi 19:30", upcoming: [] })),
    saveSeriesFor: jest.fn(() => ({ series: { categoryId: "cat1", enabled: true } })),
    runSeries: jest.fn(async () => ({ created: 1, failed: 0, existing: 0, ignored: 0, error: null, results: [] })),
}));

const { readJsonBody } = require("../../../src/web/apiBody");
const store = require("../../../src/web/eventSeriesStore");
const service = require("../../../src/web/eventSeries");
const route = require("../../../src/web/apiRoutes/eventSeries");
const { checkAccess } = require("../../../src/web/apiAccess");
const apiRouter = require("../../../src/web/apiRouter");

const ORGA = { id: "orga", name: "Orga", isAdmin: false, access: { raids: { read: true, write: true } } };
const READER = { id: "reader", isAdmin: false, access: { raids: { read: true, write: false } } };
const PATHS = ["/api/raids/series", "/api/raids/series/preview", "/api/raids/series/run"];

const { mockRes, status, body } = require("../../helpers/http");

async function call(handler, user, payload, query) {
    mockUser = user;
    readJsonBody.mockResolvedValue(payload || {});
    const r = mockRes();
    await handler({ headers: {} }, r, new URL(`http://x/api/raids/series${query ? `?${query}` : ""}`));
    return r;
}

beforeEach(() => jest.clearAllMocks());

describe("access", () => {
    it("puts every path under raids: a reader reads, only write saves, others get nothing", () => {
        for (const p of PATHS) {
            expect({ p, gate: checkAccess(p, "GET", READER) }).toEqual({ p, gate: null });
            expect({ p, gate: checkAccess(p, "PUT", READER) }).toEqual({ p, gate: expect.objectContaining({ status: 403 }) });
            expect({ p, gate: checkAccess(p, "POST", ORGA) }).toEqual({ p, gate: null });
        }
        const member = { id: "m", isAdmin: false, access: { signup: { read: true, write: true } } };
        expect(checkAccess("/api/raids/series", "GET", member)).toMatchObject({ status: 403 });
    });
});

describe("handlers", () => {
    it("lists the series with the templates and whether the caller may write", async () => {
        const r = await call(route.getSeries, READER);
        expect(status(r)).toBe(200);
        expect(body(r)).toMatchObject({ categories: [], canWrite: false, templates: [{ id: "tpl", name: "SSC + TK 25er", instanceIds: ["ssc"], size: 25 }] });
        expect(body(r).templates[0].extra).toBeUndefined();
        expect(service.seriesOverview).toHaveBeenCalledWith({ guildId: "g1" });
    });

    it("previews from the query string", async () => {
        await call(route.getPreview, READER, null, "category=cat1&weekdays=3,6&time=19:30&daysBefore=6&template=tpl&skip=2026-09-23&enabled=0");
        expect(service.previewSeries).toHaveBeenCalledWith({
            guildId: "g1",
            input: { categoryId: "cat1", weekdays: [3, 6], time: "19:30", daysBefore: "6", raidTemplateId: "tpl", skipDates: ["2026-09-23"], enabled: false, title: "" },
        });
    });

    it("saves with the caller and passes a refusal through", async () => {
        const ok = await call(route.putSeries, ORGA, { categoryId: "cat1" });
        expect(status(ok)).toBe(200);
        expect(service.saveSeriesFor).toHaveBeenCalledWith({ guildId: "g1", input: { categoryId: "cat1" }, user: ORGA });
        service.saveSeriesFor.mockReturnValueOnce({ error: { status: 409, code: "raidhelper_category", message: "Raid-Helper" } });
        const refused = await call(route.putSeries, ORGA, { categoryId: "cat2" });
        expect(status(refused)).toBe(409);
    });

    it("deletes, or answers 404", async () => {
        expect(status(await call(route.deleteSeries, ORGA, { categoryId: "cat1" }))).toBe(200);
        store.deleteSeries.mockReturnValueOnce(false);
        expect(status(await call(route.deleteSeries, ORGA, { categoryId: "nope" }))).toBe(404);
    });

    it("runs the sweep for one category, clearing a failed date first when asked", async () => {
        const r = await call(route.postRun, ORGA, { categoryId: "cat1" });
        expect(body(r).message).toBe("1 Event angelegt");
        expect(service.runSeries).toHaveBeenCalledWith({ onlyCategoryId: "cat1" });

        store.getRuns.mockReturnValueOnce({ "2026-09-16": { status: "created" } });
        expect(status(await call(route.postRun, ORGA, { categoryId: "cat1", retryDate: "2026-09-16" }))).toBe(409);
        expect(store.clearRun).not.toHaveBeenCalled();

        store.getRuns.mockReturnValueOnce({ "2026-09-16": { status: "failed", attempts: 3 } });
        expect(status(await call(route.postRun, ORGA, { categoryId: "cat1", retryDate: "2026-09-16" }))).toBe(200);
        expect(store.clearRun).toHaveBeenCalledWith("cat1", "2026-09-16");
    });

    it("is reachable through the router", () => {
        expect(typeof apiRouter.handle).toBe("function");
    });
});
