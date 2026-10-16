// The system monitor (docs/system-status.md) with a fake os, a fake /proc/meminfo, a fake event-loop histogram and
// a fake clock: one sample, the ring buffer with its minute points, and start/stop without a real timer.
const {
    createMonitor, cpuTimes, cpuPercent, parseMeminfo, foldMinute, FIELDS, SAMPLE_MS,
} = require("../../../src/services/system/systemMonitor");

const MEMINFO = [
    "MemTotal:        4000000 kB",
    "MemFree:          200000 kB",
    "MemAvailable:    1000000 kB",
    "SwapTotal:       2000000 kB",
    "SwapFree:        1500000 kB",
].join("\n");

/** A fake world the monitor reads: every value a test may move. */
function fakeWorld() {
    const w = {
        t: 1_000_000,
        wall: 0,
        cpuUser: 0,
        cpuSys: 0,
        cores: [{ user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }, { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }],
        meminfo: MEMINFO,
        load: [0.5, 0.75, 1],
        eluUsed: 0,
        // what the histogram records includes its 20-ms resolution: 22 ms read = 2 ms delay
        hist: { p50: 22e6, p99: 60e6, max: 140e6, count: 10 },
        intervals: [],
    };
    const histogram = {
        enabled: false,
        resets: 0,
        enable() { this.enabled = true; },
        disable() { this.enabled = false; },
        reset() { this.resets += 1; },
        percentile: (p) => (p === 50 ? w.hist.p50 : w.hist.p99),
        get max() { return w.hist.max; },
        get count() { return w.hist.count; },
    };
    w.histogram = histogram;
    w.deps = {
        os: {
            cpus: () => w.cores.map((times) => ({ model: "Fake CPU", times: { ...times } })),
            totalmem: () => 8 * 1024 ** 3,
            freemem: () => 2 * 1024 ** 3,
            loadavg: () => w.load,
        },
        now: () => w.t,
        hrtimeMs: () => w.wall,
        cpuUsage: (prev) => (prev
            ? { user: w.cpuUser - prev.user, system: w.cpuSys - prev.system }
            : { user: w.cpuUser, system: w.cpuSys }),
        memoryUsage: () => ({ rss: 300e6, heapUsed: 100e6, heapTotal: 150e6, external: 5e6 }),
        readMeminfo: () => {
            if (w.meminfo === null) throw new Error("ENOENT");
            return w.meminfo;
        },
        createLoopHistogram: () => histogram,
        eventLoopUtilization: (a, b) => (a && b ? { utilization: (a.used - b.used) / (a.wall - b.wall) } : { used: w.eluUsed, wall: w.wall }),
        setInterval: (fn, ms) => {
            const timer = { fn, ms, unref: jest.fn(), cleared: false };
            w.intervals.push(timer);
            return timer;
        },
        clearInterval: (timer) => { timer.cleared = true; },
    };
    /** Moves the world on by `ms`: both cores half busy, the bot at a quarter core, the loop 30 % busy. */
    w.advance = (ms = SAMPLE_MS, { busy = 0.5, proc = 0.25, elu = 0.3 } = {}) => {
        w.t += ms;
        w.wall += ms;
        for (const c of w.cores) {
            c.user += ms * busy;
            c.idle += ms * (1 - busy);
        }
        w.cpuUser += ms * 1000 * proc; // micros
        w.eluUsed += ms * elu;
    };
    return w;
}

describe("pure helpers", () => {
    it("sums the cores and turns two readings into a busy share", () => {
        const a = cpuTimes([{ times: { user: 10, nice: 0, sys: 10, idle: 80, irq: 0 } }, { times: {} }]);
        expect(a).toEqual({ idle: 80, total: 100 });
        expect(cpuPercent(a, { idle: 130, total: 200 })).toBe(50);
        expect(cpuPercent(a, a)).toBe(0);
        expect(cpuTimes(undefined)).toEqual({ idle: 0, total: 0 });
    });

    it("parses /proc/meminfo into bytes", () => {
        expect(parseMeminfo(MEMINFO)).toEqual({
            total: 4000000 * 1024, available: 1000000 * 1024, swapTotal: 2000000 * 1024, swapFree: 1500000 * 1024,
        });
        expect(parseMeminfo("")).toEqual({ total: undefined, available: undefined, swapTotal: undefined, swapFree: undefined });
    });

    it("folds a minute to the mean, and to the maximum for the event loop", () => {
        const p = foldMinute([{ hostCpu: 10, loopP99: 5, loopMax: 9, elu: 20 }, { hostCpu: 30, loopP99: 50, loopMax: 70, elu: 40 }], 60000);
        expect(p).toMatchObject({ t: 60000, hostCpu: 20, loopP99: 50, loopMax: 70, elu: 30, rss: 0 });
    });
});

describe("createMonitor", () => {
    it("takes no sample on the first call: that only sets the baseline", () => {
        const w = fakeWorld();
        const m = createMonitor(w.deps);
        expect(m.sampleNow()).toBeNull();
        expect(m.latest()).toBeNull();
    });

    it("measures host, process, memory and event loop from the deltas", () => {
        const w = fakeWorld();
        const m = createMonitor(w.deps);
        m.start();
        w.advance();
        const s = m.sampleNow();
        expect(s).toEqual({
            t: w.t,
            hostCpu: 50,
            procCpu: 25,
            cores: 2,
            load1: 0.5, load5: 0.75, load15: 1,
            memTotal: 8 * 1024 ** 3,
            memAvail: 1000000 * 1024,
            memAvailPct: 11.9,
            swapTotal: 2000000 * 1024,
            swapUsed: 500000 * 1024,
            swapKnown: true,
            swapUsedPct: 25,
            rss: 300e6, heapUsed: 100e6, heapTotal: 150e6, external: 5e6,
            loopP50: 2, loopP99: 40, loopMax: 120,
            elu: 30,
        });
        expect(w.histogram.resets).toBe(1);
        expect(m.latest()).toEqual(s);
        m.stop();
    });

    it("falls back to os.freemem without /proc and reports swap as unknown", () => {
        const w = fakeWorld();
        w.meminfo = null;
        const m = createMonitor(w.deps);
        m.sampleNow();
        w.advance();
        const s = m.sampleNow();
        expect(s).toMatchObject({ memAvail: 2 * 1024 ** 3, memAvailPct: 25, swapKnown: false, swapTotal: 0, swapUsedPct: 0 });
    });

    it("reads an empty histogram as 0 instead of its sentinels", () => {
        const w = fakeWorld();
        w.hist = { p50: 0, p99: 0, max: 9223372036854776000, count: 0 };
        const m = createMonitor(w.deps);
        m.start();
        w.advance();
        expect(m.sampleNow()).toMatchObject({ loopP50: 0, loopP99: 0, loopMax: 0 });
        // a histogram without `count` (older Node) is read anyway: sentinels and values under the resolution are 0
        w.hist = { p50: 15e6, p99: 21e6, max: 9223372036854776000, count: undefined };
        w.advance();
        expect(m.sampleNow()).toMatchObject({ loopP50: 0, loopP99: 1, loopMax: 0 });
        m.stop();
    });

    it("keeps the last hour in 15-s steps and 24 hours in minute points", () => {
        const w = fakeWorld();
        const m = createMonitor(w.deps);
        m.sampleNow();
        // 90 minutes of samples: the first 45 min idle, then busy
        for (let i = 0; i < 360; i++) {
            w.advance(SAMPLE_MS, { busy: i < 180 ? 0.1 : 0.9 });
            m.sampleNow();
        }
        const h = m.history();
        expect(h.fields).toEqual(FIELDS);
        expect(h.hour.step).toBe(SAMPLE_MS);
        expect(h.hour.points).toHaveLength(240);
        expect(h.hour.points.every((p) => p[0] > w.t - 60 * 60 * 1000)).toBe(true);
        expect(h.day.step).toBe(60000);
        // 90 minutes span 91 minute buckets at most (the running minute included)
        expect(h.day.points.length).toBeGreaterThanOrEqual(90);
        expect(h.day.points.length).toBeLessThanOrEqual(91);
        const hostIdx = FIELDS.indexOf("hostCpu");
        expect(h.day.points[1][hostIdx]).toBe(10);
        expect(h.day.points[h.day.points.length - 2][hostIdx]).toBe(90);
        expect(m.recentSamples()).toHaveLength(240);
    });

    it("drops minute points older than 24 hours", () => {
        const w = fakeWorld();
        const m = createMonitor(w.deps);
        m.sampleNow();
        for (let i = 0; i < 25 * 60; i++) {
            w.advance(60000);
            m.sampleNow();
        }
        const { day } = m.history();
        expect(day.points.length).toBeLessThanOrEqual(24 * 60 + 1);
        expect(day.points[0][0]).toBeGreaterThan(w.t - 24 * 60 * 60 * 1000);
    });

    it("starts one unref'd timer, samples on it, and stops it and the histogram again", () => {
        const w = fakeWorld();
        const m = createMonitor(w.deps);
        m.start();
        m.start();
        expect(w.intervals).toHaveLength(1);
        expect(w.intervals[0].ms).toBe(SAMPLE_MS);
        expect(w.intervals[0].unref).toHaveBeenCalled();
        expect(w.histogram.enabled).toBe(true);
        expect(m.running()).toBe(true);
        w.advance();
        w.intervals[0].fn();
        expect(m.latest()).toMatchObject({ hostCpu: 50 });
        m.stop();
        m.stop();
        expect(w.intervals[0].cleared).toBe(true);
        expect(w.histogram.enabled).toBe(false);
        expect(m.running()).toBe(false);
    });

    it("skips a sample that throws instead of stopping", () => {
        const w = fakeWorld();
        const m = createMonitor({ ...w.deps, memoryUsage: () => { throw new Error("boom"); } });
        m.start();
        w.advance();
        expect(() => w.intervals[0].fn()).not.toThrow();
        expect(m.latest()).toBeNull();
        m.stop();
    });

    it("runs without a histogram when perf_hooks refuses one", () => {
        const w = fakeWorld();
        const m = createMonitor({ ...w.deps, createLoopHistogram: () => { throw new Error("no"); } });
        m.start();
        w.advance();
        expect(m.sampleNow()).toMatchObject({ loopP99: 0, hostCpu: 50 });
        m.stop();
    });

    it("works with the real modules too", () => {
        const m = createMonitor();
        m.start();
        const s = m.sampleNow();
        expect(s.cores).toBeGreaterThan(0);
        expect(s.memTotal).toBeGreaterThan(0);
        expect(s.rss).toBeGreaterThan(0);
        m.stop();
    });
});
