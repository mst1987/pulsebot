// The API of the recurring events (src/web/apiRoutes/events/eventSeries.js, #289):
// every path is area `raids`, reading needs read, saving/deleting/running write,
// and each handler hands the request to the service as it should.
let mockUser = null;
jest.mock("../../../../src/web/http/apiMiddleware", () => require("../../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../../src/web/http/apiBody", () => require("../../../helpers/http").apiBodyMock());
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: () => "g1" }));
let mockConfig = {};
jest.mock("../../../../src/stores/settingsStore", () => ({
    listRaidTemplates: jest.fn(() => [{ id: "tpl", name: "SSC + TK 25er", instanceIds: ["ssc"], size: 25, extra: "x" }]),
    getConfig: jest.fn(() => mockConfig),
}));
// the stored series (by category) and the bot's live channel cache decide a category's server (#925)
let mockSeries = {};
let mockLive = {};
jest.mock("../../../../src/stores/eventSeriesStore", () => ({
    getSeries: jest.fn((id) => mockSeries[id] || null),
    deleteSeries: jest.fn(() => true),
    getRuns: jest.fn(() => ({})),
    clearRun: jest.fn(),
}));
jest.mock("../../../../src/web/events/eventSeries", () => ({
    MIN_DAYS_BEFORE: 1,
    MAX_DAYS_BEFORE: 28,
    STALE_CREATING_MS: 15 * 60 * 1000,
    seriesOverview: jest.fn(async () => ({ categories: [], lastRun: null })),
    previewSeries: jest.fn(async () => ({ error: "", summary: "Mi 19:30", upcoming: [] })),
    saveSeriesFor: jest.fn(() => ({ series: { categoryId: "cat1", enabled: true } })),
    runSeries: jest.fn(async () => ({ created: 1, failed: 0, existing: 0, ignored: 0, error: null, results: [] })),
}));
jest.mock("../../../../src/services/discord/discord", () => ({
    getClient: () => ({ channels: { cache: { get: (id) => (mockLive[id] ? { id, guildId: mockLive[id] } : null) } } }),
}));
jest.mock("../../../../src/services/discord/servers/serverOf", () => ({
    ...jest.requireActual("../../../../src/services/discord/servers/serverOf"),
    storedCategoryGuilds: () => new Map(),
}));
// the categories whose current roster the caller manages (#728) - the rule has its own tests
jest.mock("../../../../src/services/roster/categoryOrga", () => ({
    ...jest.requireActual("../../../../src/services/roster/categoryOrga"),
    orgaCategoryIds: jest.fn(async () => []),
}));

const { readJsonBody } = require("../../../../src/web/http/apiBody");
const store = require("../../../../src/stores/eventSeriesStore");
const service = require("../../../../src/web/events/eventSeries");
const route = require("../../../../src/web/apiRoutes/events/eventSeries");
const { checkAccess } = require("../../../../src/web/http/apiAccess");
const apiRouter = require("../../../../src/web/http/apiRouter");

const ORGA = { id: "orga", name: "Orga", isAdmin: false, isOrga: true, access: { raids: { read: true, write: true } } };
// the global orga reading only
const READER = { id: "reader", isAdmin: false, isOrga: true, access: { raids: { read: true, write: false } } };
// a raider role with `raids` read (and write), no orga rank and no roster
const RAIDER = { id: "raider", isAdmin: false, access: { raids: { read: true, write: true } } };
const PATHS = ["/api/raids/series", "/api/raids/series/preview", "/api/raids/series/run"];

const { mockRes, status, body } = require("../../../helpers/http");

async function call(handler, user, payload, query) {
    mockUser = user;
    readJsonBody.mockResolvedValue(payload || {});
    const r = mockRes();
    await handler({ headers: {} }, r, new URL(`http://x/api/raids/series${query ? `?${query}` : ""}`));
    return r;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockSeries = { cat1: { categoryId: "cat1", guildId: "g1" } };
    mockLive = { cat2: "g1" };
});

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
        expect(service.seriesOverview).toHaveBeenCalledWith({ guildId: "g1", config: {} });
    });

    it("lists only the series and templates of the shown game version (#741)", async () => {
        const settings = require("../../../../src/stores/settingsStore");
        mockConfig = { mainVersion: "tbc", categoryVersion: { "cat-forever": "forever" } };
        settings.listRaidTemplates.mockReturnValueOnce([
            { id: "kara", name: "Kara", versionId: "tbc" }, { id: "bd", name: "Barrow Deeps", versionId: "forever" },
        ]).mockReturnValueOnce([
            { id: "kara", name: "Kara", versionId: "tbc" }, { id: "bd", name: "Barrow Deeps", versionId: "forever" },
        ]);
        service.seriesOverview.mockResolvedValue({ categories: [{ id: "cat-tbc" }, { id: "cat-forever" }], lastRun: null });
        try {
            const forever = body(await call(route.getSeries, ORGA, null, "version=forever"));
            expect(forever.categories.map((c) => c.id)).toEqual(["cat-forever"]);
            expect(forever.templates.map((t) => t.id)).toEqual(["bd"]);
            const tbc = body(await call(route.getSeries, ORGA));
            expect(tbc.categories.map((c) => c.id)).toEqual(["cat-tbc"]);
            expect(tbc.templates.map((t) => t.id)).toEqual(["kara"]);
        } finally {
            mockConfig = {};
            service.seriesOverview.mockResolvedValue({ categories: [], lastRun: null });
        }
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
        mockLive.nope = "g1";
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

// #728 review: a global orga reading only sees every series, as before, and writes - as at the gate - only
// the rows of the categories whose roster they manage (writableCategoryIds)
// #925: a category of another server - or of no known one - is not reachable, only a full admin's
describe("rights per server", () => {
    it("refuses to delete the series of a category of another server, even one not in the snapshot yet", async () => {
        mockLive = { catA: "gA" };
        mockSeries.catA = { categoryId: "catA", guildId: "gA" };
        const r = await call(route.deleteSeries, ORGA, { categoryId: "catA" });
        expect(status(r)).toBe(404);
        expect(store.deleteSeries).not.toHaveBeenCalled();
    });

    it("takes the live server before the stored series' one", async () => {
        mockLive = { cat1: "gA" };
        expect(status(await call(route.deleteSeries, ORGA, { categoryId: "cat1" }))).toBe(404);
        expect(store.deleteSeries).not.toHaveBeenCalled();
    });

    it("refuses a category no source knows, for every write", async () => {
        for (const handler of [route.putSeries, route.deleteSeries, route.postRun]) {
            expect(status(await call(handler, ORGA, { categoryId: "ghost" }))).toBe(404);
        }
        expect(store.deleteSeries).not.toHaveBeenCalled();
        expect(service.saveSeriesFor).not.toHaveBeenCalled();
        expect(service.runSeries).not.toHaveBeenCalled();
    });

    it("lets a full admin reach every server", async () => {
        mockLive = { catA: "gA" };
        const admin = { id: "admin", isAdmin: true, access: {} };
        expect(status(await call(route.deleteSeries, admin, { categoryId: "catA" }))).toBe(200);
        expect(store.deleteSeries).toHaveBeenCalledWith("catA");
    });
});

describe("the global orga without `raids` write", () => {
    it("sees every category; managing cat1 writes cat1 only", async () => {
        const categoryOrga = require("../../../../src/services/roster/categoryOrga");
        categoryOrga.orgaCategoryIds.mockResolvedValueOnce(["cat1"]);
        service.seriesOverview.mockResolvedValueOnce({ categories: [{ id: "cat1" }, { id: "cat2" }], lastRun: null });
        const r = body(await call(route.getSeries, READER));
        expect(r.categories.map((c) => c.id)).toEqual(["cat1", "cat2"]);
        expect([r.canWrite, r.writableCategoryIds, r.canRunAll]).toEqual([true, ["cat1"], false]);
        expect(categoryOrga.orgaCategoryIds).toHaveBeenCalledWith(READER, expect.objectContaining({ managerOnly: true }));
        // managing nothing: everything to see, nothing to write
        service.seriesOverview.mockResolvedValueOnce({ categories: [{ id: "cat1" }], lastRun: null });
        const none = body(await call(route.getSeries, READER));
        expect([none.categories.map((c) => c.id), none.canWrite, none.writableCategoryIds]).toEqual([["cat1"], false, []]);
    });

    it("leaves the global orga with `raids` write every row writable (writableCategoryIds null)", async () => {
        service.seriesOverview.mockResolvedValueOnce({ categories: [{ id: "cat1" }, { id: "cat2" }], lastRun: null });
        const r = body(await call(route.getSeries, ORGA));
        expect([r.categories.length, r.canWrite, r.writableCategoryIds, r.canRunAll]).toEqual([2, true, null, true]);
    });
});

// #728: a series is the orga's planning - the category orga's path is covered in events.categoryOrga.test.js
describe("who is no orga", () => {
    it("sees no series and may write none, `raids` write or not", async () => {
        service.seriesOverview.mockResolvedValueOnce({ categories: [{ id: "cat1" }], lastRun: null });
        const r = body(await call(route.getSeries, RAIDER));
        expect(r.categories).toEqual([]);
        expect(r.canWrite).toBe(false);
        for (const handler of [route.putSeries, route.deleteSeries, route.postRun]) {
            expect(status(await call(handler, RAIDER, { categoryId: "cat1" }))).toBe(403);
        }
        expect(status(await call(route.getPreview, RAIDER, null, "category=cat1"))).toBe(403);
        expect(service.saveSeriesFor).not.toHaveBeenCalled();
        expect(store.deleteSeries).not.toHaveBeenCalled();
        expect(service.runSeries).not.toHaveBeenCalled();
        expect(service.previewSeries).not.toHaveBeenCalled();
    });

    it("leaves the global orga every category, writing with `raids` write", async () => {
        service.seriesOverview.mockResolvedValueOnce({ categories: [{ id: "cat1" }], lastRun: null });
        const r = body(await call(route.getSeries, ORGA));
        expect(r.categories.map((c) => c.id)).toEqual(["cat1"]);
        expect(r.canWrite).toBe(true);
        // a sweep of every series at once (no category) is the global orga's
        expect(status(await call(route.postRun, ORGA, {}))).toBe(200);
        expect(service.runSeries).toHaveBeenCalledWith({ onlyCategoryId: "" });
    });
});
