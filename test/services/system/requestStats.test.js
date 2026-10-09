// The route statistics of the "Systemstatus" page (docs/system-status.md): path patterns without ids or tokens,
// count/avg/p95/max/slow since start and for the last hour, and the last slow requests.
const {
    createRequestStats, normalizePath, isIdSegment, percentile, slowThresholdMs,
    MAX_ROUTES, SLOW_KEEP, RECENT_CAP,
} = require("../../../src/services/system/requestStats");

const MIN = 60 * 1000;

describe("normalizePath", () => {
    it.each([
        ["/api/raids/detail", "/api/raids/detail"],
        ["/api/raids/detail?event=123", "/api/raids/detail"],
        ["/r/aBcD1234eFgH5678", "/r/:id"],
        ["/r/aBcD1234eFgH5678/p/2", "/r/:id/p/:id"],
        ["/p/Xy7_kLm9-QwErTy12", "/p/:id"],
        ["/api/x/1139509316387344395", "/api/x/:id"],
        ["/api/x/0f3a9c2e-1b2c-4d5e-8f90-123456789abc", "/api/x/:id"],
        ["/api/x/deadbeef12", "/api/x/:id"],
        ["/api/settings/raidhelper-history-import", "/api/settings/raidhelper-history-import"],
        ["/api/raids/", "/api/raids"],
        ["", "/"],
        ["/", "/"],
        ["/r/a%ZZ", "/r/a%ZZ"],
    ])("%s -> %s", (input, expected) => {
        expect(normalizePath(input)).toBe(expected);
    });

    it("keeps route words, even long ones, and replaces long opaque strings", () => {
        expect(isIdSegment("plan-templates")).toBe(false);
        expect(isIdSegment("guildbank")).toBe(false);
        expect(isIdSegment("abcdefghijklmnopqrstuvwxyzABCD")).toBe(true);
        expect(isIdSegment("")).toBe(false);
    });
});

describe("percentile", () => {
    it("takes the nearest rank and is 0 for nothing", () => {
        expect(percentile([], 95)).toBe(0);
        expect(percentile([5], 95)).toBe(5);
        const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
        expect(percentile(hundred, 95)).toBe(95);
        expect(percentile(hundred, 50)).toBe(50);
        expect(percentile([3, 1, 2], 100)).toBe(3);
    });
});

describe("slowThresholdMs", () => {
    it("reads SLOW_REQUEST_MS, 1000 without a valid value", () => {
        expect(slowThresholdMs({})).toBe(1000);
        expect(slowThresholdMs({ SLOW_REQUEST_MS: "" })).toBe(1000);
        expect(slowThresholdMs({ SLOW_REQUEST_MS: "-5" })).toBe(1000);
        expect(slowThresholdMs({ SLOW_REQUEST_MS: "300" })).toBe(300);
    });
});

describe("createRequestStats", () => {
    let t;
    let stats;
    beforeEach(() => {
        t = 10 * 60 * MIN;
        stats = createRequestStats({ now: () => t, random: () => 0.999 });
    });

    it("sums one route since start and for the last hour", () => {
        stats.record("GET", "/api/raids", 200, 100);
        stats.record("GET", "/api/raids", 200, 300);
        stats.record("GET", "/api/raids?x=1", 200, 1200, true);
        const [row] = stats.snapshot().routes;
        expect(row).toEqual({
            route: "/api/raids",
            total: { count: 3, avg: 533.3, p95: 1200, max: 1200, slow: 1 },
            hour: { count: 3, avg: 533.3, p95: 1200, max: 1200, slow: 1 },
        });
    });

    it("lets requests older than an hour drop out of the hour figures, not out of the total", () => {
        stats.record("GET", "/api/a", 200, 900, true);
        t += 61 * MIN;
        stats.record("GET", "/api/a", 200, 50);
        const [row] = stats.snapshot().routes;
        expect(row.total).toEqual({ count: 2, avg: 475, p95: 900, max: 900, slow: 1 });
        expect(row.hour).toEqual({ count: 1, avg: 50, p95: 50, max: 50, slow: 0 });
    });

    it("orders the routes busiest first and keeps them apart", () => {
        stats.record("GET", "/api/b", 200, 1);
        stats.record("GET", "/api/a", 200, 1);
        stats.record("GET", "/api/a", 200, 1);
        expect(stats.snapshot().routes.map((r) => r.route)).toEqual(["/api/a", "/api/b"]);
    });

    it("keeps the last slow requests newest first, normalised, at most SLOW_KEEP", () => {
        for (let i = 0; i < SLOW_KEEP + 5; i++) {
            t += 1000;
            stats.record("POST", `/api/x/${1000 + i}`, 500, 2000 + i, true);
        }
        const { slow } = stats.snapshot();
        expect(slow).toHaveLength(SLOW_KEEP);
        expect(slow[0]).toEqual({ t, method: "POST", path: "/api/x/:id", status: 500, ms: 2000 + SLOW_KEEP + 4 });
    });

    it("folds patterns beyond MAX_ROUTES into one row 'other'", () => {
        for (let i = 0; i < MAX_ROUTES + 10; i++) stats.record("GET", `/api/route${String.fromCharCode(97 + (i % 26))}${"z".repeat(Math.floor(i / 26))}`, 200, 1);
        const routes = stats.snapshot().routes;
        expect(routes).toHaveLength(MAX_ROUTES + 1);
        expect(routes.find((r) => r.route === "other").total.count).toBe(10);
    });

    it("keeps the reservoir and the recent list bounded", () => {
        for (let i = 0; i < RECENT_CAP + 400; i++) stats.record("GET", "/api/a", 200, i % 100);
        const [row] = stats.snapshot().routes;
        expect(row.total.count).toBe(RECENT_CAP + 400);
        expect(row.total.max).toBe(99);
        expect(row.hour.count).toBe(RECENT_CAP + 400);
    });

    it("starts over on reset and treats nonsense durations as 0", () => {
        stats.record("GET", "/api/a", 200, "nope");
        expect(stats.snapshot().routes[0].total.avg).toBe(0);
        t += 5;
        stats.reset();
        expect(stats.snapshot()).toEqual({ since: t, routes: [], slow: [] });
    });
});
