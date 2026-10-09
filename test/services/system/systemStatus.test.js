// The answer of GET /api/system/status (docs/system-status.md), put together from fake parts: what goes in, the
// top processes only when asked and kept for five minutes, and the runtime it reports.
const { createSystemStatus, runtimeInfo, PROC_KEEP_MS } = require("../../../src/services/system/systemStatus");

function parts(over = {}) {
    let t = 1_000_000;
    const d = {
        now: () => t,
        tick: (ms) => { t += ms; },
        monitor: {
            latest: () => ({ t, hostCpu: 12 }),
            history: () => ({ fields: ["t"], hour: { step: 15000, points: [[t]] }, day: { step: 60000, points: [] } }),
            recentSamples: () => [],
            running: () => true,
            SAMPLE_MS: 15000,
        },
        requestStats: { snapshot: () => ({ since: 5, routes: [{ route: "/api/raids", total: {}, hour: { count: 1, p95: 10 } }], slow: [] }) },
        diskUsage: {
            get: jest.fn(async () => ({ at: t, total: 1000, free: 50, known: true, entries: [], files: [], truncated: false })),
            history: () => [[t, 5]],
        },
        hostProcesses: { topProcesses: jest.fn(async () => ({ source: "proc", list: [{ pid: 9, name: "mysqld", cpu: 80, self: false }] })) },
        os: { cpus: () => [{ model: " Fake CPU " }, { model: "Fake CPU" }], uptime: () => 3600.4 },
        platform: "linux",
        nodeVersion: "v22.1.0",
        processUptime: () => 61.6,
        env: { pm_id: "0" },
        exists: () => false,
        slowThresholdMs: () => 1000,
        ...over,
    };
    return d;
}

describe("runtimeInfo", () => {
    it("tells pm2, Docker and a plain node apart", () => {
        expect(runtimeInfo({ pm_id: 3 })).toEqual({ kind: "pm2", pmId: "3" });
        expect(runtimeInfo({}, (p) => p === "/.dockerenv")).toEqual({ kind: "docker" });
        expect(runtimeInfo({})).toEqual({ kind: "node" });
    });
});

describe("createSystemStatus", () => {
    it("puts the parts together", async () => {
        const d = parts();
        const res = await createSystemStatus(d).build();
        expect(res.info).toEqual({
            platform: "linux", cores: 2, cpuModel: "Fake CPU", nodeVersion: "v22.1.0", hostUptime: 3600, processUptime: 62,
            runtime: { kind: "pm2", pmId: "0" }, loadSupported: true, sampleMs: 15000, monitoring: true,
        });
        expect(res.current).toEqual({ t: res.now, hostCpu: 12 });
        expect(res.history.hour.points).toEqual([[res.now]]);
        expect(res.requests).toEqual({ threshold: 1000, since: 5, routes: [expect.objectContaining({ route: "/api/raids" })], slow: [] });
        expect(res.disk).toMatchObject({ total: 1000, free: 50, history: [[res.now, 5]] });
        expect(res.processes).toBeNull();
        expect(res.assessment).toEqual({ level: "warn", warmingUp: true, findings: [expect.objectContaining({ id: "diskLow" })] });
        expect(d.hostProcesses.topProcesses).not.toHaveBeenCalled();
        expect(d.diskUsage.get).toHaveBeenCalledWith({ force: false });
    });

    it("measures the processes only when asked, keeps them five minutes, and walks the disk again on request", async () => {
        const d = parts();
        const status = createSystemStatus(d);
        const first = await status.build({ processes: true, forceDisk: true });
        expect(first.processes).toEqual({ at: first.now, source: "proc", list: [expect.objectContaining({ name: "mysqld" })] });
        expect(d.diskUsage.get).toHaveBeenCalledWith({ force: true });
        d.tick(60 * 1000);
        expect((await status.build()).processes).toEqual(first.processes);
        expect(d.hostProcesses.topProcesses).toHaveBeenCalledTimes(1);
        d.tick(PROC_KEEP_MS);
        expect((await status.build()).processes).toBeNull();
    });

    it("says where there is no load average, and copes with no CPU list and no disk", async () => {
        const d = parts({ platform: "win32", os: { cpus: () => [], uptime: () => 1 }, diskUsage: { get: async () => null, history: () => [] } });
        const res = await createSystemStatus(d).build();
        expect(res.info).toMatchObject({ loadSupported: false, cores: 1, cpuModel: "" });
        expect(res.disk).toBeNull();
    });

    it("builds with the real parts", async () => {
        const { build } = require("../../../src/services/system/systemStatus");
        const res = await build();
        expect(res.info.cores).toBeGreaterThan(0);
        expect(res.history.fields[0]).toBe("t");
        expect(res.assessment.level).toMatch(/^(ok|warn|bad)$/);
    });
});
